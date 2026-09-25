"use client";

export interface SpeechQueueItem {
  index: number;
  text: string;
  lang?: string;
  profile?: string;
  sig?: string;
  exp?: number;
  turnId?: string;
  sessionId?: string;
}

export interface AudioPlayer {
  play: (url: string) => Promise<void>;
  pause: () => void;
  stop: () => void;
  onEnded: (callback: () => void) => void;
  onError: (callback: (err: Error) => void) => void;
}

export type TtsQueueEventType = "playing" | "ended" | "failover" | "sentenceChange" | "stopped";

export type EventCallback = (...args: unknown[]) => void;

/**
 * Creates a default browser HTMLAudioElement player.
 */
export function createDefaultAudioPlayer(): AudioPlayer {
  let audio: HTMLAudioElement | null = null;
  let endedCb: (() => void) | null = null;
  let errorCb: ((err: Error) => void) | null = null;

  return {
    play(url: string): Promise<void> {
      if (!audio) {
        audio = new Audio();
      }
      audio.src = url;

      audio.onended = () => {
        endedCb?.();
      };
      audio.onerror = () => {
        errorCb?.(new Error(audio?.error?.message || "Audio playback error"));
      };

      return audio.play().catch((err) => {
        // Handle autoplay policy rejection or abort
        if (err.name !== "AbortError") {
          errorCb?.(err);
        }
      });
    },
    pause() {
      if (audio) {
        audio.pause();
      }
    },
    stop() {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    },
    onEnded(cb: () => void) {
      endedCb = cb;
    },
    onError(cb: (err: Error) => void) {
      errorCb = cb;
    },
  };
}

export interface TtsQueueOptions {
  maxInFlight?: number;
  player?: AudioPlayer;
  fetchAudio?: (item: SpeechQueueItem, signal: AbortSignal) => Promise<string>;
  /**
   * Speaks a sentence the server could not voice (a system voice), calling onEnd when done.
   * Returns null when there is no voice for the language; the sentence is then skipped.
   */
  speakFallback?: (item: SpeechQueueItem, onEnd: () => void) => { cancel: () => void } | null;
}

/** Stored in place of an audio url: this sentence is spoken by speakFallback in its turn. */
const FALLBACK = "fallback:";

/**
 * Manages ordered sentence playback, prefetching with up to 2 requests in flight,
 * sentence tracking for captions, and immediate abort on barge-in.
 */
export class TtsQueue {
  private queue: SpeechQueueItem[] = [];
  private inFlight = new Set<number>();
  private audioUrls = new Map<number, string>();
  private abortControllers = new Map<number, AbortController>();
  private listeners = new Map<TtsQueueEventType, Set<EventCallback>>();

  private maxInFlight: number;
  private player: AudioPlayer;
  private fetchAudioFn: (item: SpeechQueueItem, signal: AbortSignal) => Promise<string>;
  private speakFallback: TtsQueueOptions["speakFallback"];
  private fallbackHandle: { cancel: () => void } | null = null;

  private currentPlayingIndex: number | null = null;
  private nextPlayIndex = 0;
  private highestPlayedIndex = -1;
  private isProcessing = false;
  private isUnlocked = false;

  constructor(options: TtsQueueOptions = {}) {
    this.maxInFlight = options.maxInFlight ?? 2;
    this.player = options.player ?? createDefaultAudioPlayer();
    this.fetchAudioFn = options.fetchAudio ?? this.defaultFetchAudio.bind(this);
    this.speakFallback = options.speakFallback;

    this.player.onEnded(() => {
      this.handleAudioEnded();
    });

    this.player.onError((err) => {
      const item = this.queue.find((i) => i.index === this.currentPlayingIndex);
      this.emit("failover", {
        reason: err.message,
        index: this.currentPlayingIndex,
        item,
      });
      // Re-speak this sentence another way before moving on, never alongside the next one.
      if (!item) return this.handleAudioEnded();
      this.currentPlayingIndex = null;
      this.playFallback(item);
      if (this.currentPlayingIndex === null) this.processQueue();
    });
  }

  /**
   * Unlock audio playback upon first user gesture (e.g. clicking start mission).
   */
  public async unlock(): Promise<void> {
    if (this.isUnlocked) return;
    try {
      if (typeof window !== "undefined") {
        // Play and immediately pause an empty or silent buffer to satisfy browser autoplay
        const silentAudio = new Audio(
          "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA",
        );
        await silentAudio.play();
        silentAudio.pause();
        this.isUnlocked = true;
      }
    } catch {
      // Autoplay unlock will re-attempt on next gesture
    }
  }

  /**
   * Enqueue a new speech item from the TurnStream.
   */
  public enqueue(item: SpeechQueueItem): void {
    // Insert item keeping array sorted by sentence index
    const exists = this.queue.some((i) => i.index === item.index);
    if (!exists) {
      this.queue.push(item);
      this.queue.sort((a, b) => a.index - b.index);
    }
    this.processQueue();
  }

  /**
   * Stop all audio playback within 150ms, abort all in-flight fetch requests,
   * clear the queue, and return the highest sentence index heard.
   */
  public stop(): number {
    const heard = this.getHeardUntilSentence();

    // 1. Immediately stop audio, whichever voice is speaking
    this.player.stop();
    this.fallbackHandle?.cancel();
    this.fallbackHandle = null;

    // 2. Abort all in-flight fetches
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    this.inFlight.clear();

    // 3. Clean up object URLs
    if (typeof URL !== "undefined" && URL.revokeObjectURL) {
      for (const url of this.audioUrls.values()) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
    }
    this.audioUrls.clear();

    // 4. Clear pending queue
    this.queue = [];
    this.currentPlayingIndex = null;
    this.isProcessing = false;

    this.emit("stopped", { heardUntilSentence: heard });
    return heard;
  }

  public isPlaying(): boolean {
    return this.currentPlayingIndex !== null;
  }

  /**
   * True while there is audio to interrupt: playing, queued, or still being fetched.
   * Barge-in has to cover the gap between two sentences, or the next one starts playing
   * into an open microphone.
   */
  public hasPendingAudio(): boolean {
    return this.currentPlayingIndex !== null || this.queue.length > 0 || this.inFlight.size > 0;
  }

  public getCurrentPlayingIndex(): number | null {
    return this.currentPlayingIndex;
  }

  public getHeardUntilSentence(): number {
    return this.highestPlayedIndex;
  }

  public resetTurn(startSentenceIndex = 0): void {
    this.stop();
    this.nextPlayIndex = startSentenceIndex;
    this.highestPlayedIndex = startSentenceIndex - 1;
  }

  /**
   * Subscribe to queue events (playing, ended, failover, sentenceChange, stopped).
   */
  public on(event: TtsQueueEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: TtsQueueEventType, data?: unknown): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch {
          // Prevent listener errors from breaking queue loop
        }
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Start prefetching up to maxInFlight
      for (const item of this.queue) {
        if (this.inFlight.size >= this.maxInFlight) break;
        if (!this.audioUrls.has(item.index) && !this.inFlight.has(item.index)) {
          this.startFetch(item);
        }
      }

      // 2. If not currently playing, play the next ready sentence. A sentence whose fetch
      // failed is stored as an empty url; step past it here rather than stalling the turn.
      while (this.currentPlayingIndex === null && this.audioUrls.has(this.nextPlayIndex)) {
        const index = this.nextPlayIndex;
        const item = this.queue.find((i) => i.index === index);
        if (!item) break;
        const url = this.audioUrls.get(index)!;
        if (!url) {
          this.nextPlayIndex = index + 1;
          continue;
        }
        if (url === FALLBACK) {
          this.playFallback(item);
          continue;
        }
        this.playItem(item, url);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private startFetch(item: SpeechQueueItem): void {
    this.inFlight.add(item.index);
    const controller = new AbortController();
    this.abortControllers.set(item.index, controller);

    this.fetchAudioFn(item, controller.signal)
      .then((url) => {
        this.inFlight.delete(item.index);
        this.abortControllers.delete(item.index);
        this.audioUrls.set(item.index, url);
        this.processQueue();
      })
      .catch((err) => {
        this.inFlight.delete(item.index);
        this.abortControllers.delete(item.index);
        if (err.name !== "AbortError") {
          this.emit("failover", {
            provider: "server_proxy",
            reason: err.message || String(err),
            item,
          });
          // Spoken another way in its turn, so the queue neither hangs nor talks over itself.
          this.audioUrls.set(item.index, FALLBACK);
          this.processQueue();
        }
      });
  }

  private playItem(item: SpeechQueueItem, url: string): void {
    this.currentPlayingIndex = item.index;
    this.highestPlayedIndex = Math.max(this.highestPlayedIndex, item.index);

    this.emit("sentenceChange", item.index);
    this.emit("playing", item);

    this.player.play(url).catch(() => {
      this.handleAudioEnded();
    });
  }

  /**
   * Speaks a sentence the server could not voice, as the current sentence, so the next one
   * waits for it. The page used to speak these the moment the fetch failed, while the queue
   * went on playing later sentences: two voices at once, and the fallback out of order.
   */
  private playFallback(item: SpeechQueueItem): void {
    const handle = this.speakFallback?.(item, () => {
      // Ignore a late end from a sentence that was stopped or already moved past.
      if (this.currentPlayingIndex !== item.index) return;
      this.fallbackHandle = null;
      this.handleAudioEnded();
    });
    if (!handle) {
      this.nextPlayIndex = item.index + 1;
      return;
    }
    this.fallbackHandle = handle;
    this.currentPlayingIndex = item.index;
    this.highestPlayedIndex = Math.max(this.highestPlayedIndex, item.index);
    this.emit("sentenceChange", item.index);
    this.emit("playing", item);
  }

  private handleAudioEnded(): void {
    if (this.currentPlayingIndex !== null) {
      const finishedItem = this.queue.find((i) => i.index === this.currentPlayingIndex);
      if (finishedItem) {
        this.emit("ended", finishedItem);
      }
      this.nextPlayIndex = this.currentPlayingIndex + 1;
      this.currentPlayingIndex = null;
    }
    this.processQueue();
  }

  private async defaultFetchAudio(item: SpeechQueueItem, signal: AbortSignal): Promise<string> {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: item.text,
        lang: item.lang || "en",
        profile: item.profile,
        sig: item.sig,
        exp: item.exp,
        turnId: item.turnId,
        sessionId: item.sessionId,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`TTS request failed with status ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data.fallback) {
        this.emit("failover", { reason: data.reason || "fallback", item });
        return FALLBACK;
      }
    }

    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
}
