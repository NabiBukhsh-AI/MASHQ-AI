"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BargeInController, type BargeInEvent } from "./bargeIn";
import { TtsQueue, type SpeechQueueItem, type TtsQueueOptions } from "./ttsQueue";
import { chooseBrowserFallback, type SpeechOutputMode } from "./capabilities";
import { speakWithBrowser } from "./webSpeech";

export interface Interruption {
  interrupted?: boolean;
  heardUntilSentence?: number;
}

export interface VoicePlayback {
  /** Call when a turn starts, so sentence numbering restarts from zero. */
  startTurn: () => void;
  /** Feed one speech.item from the turn stream. */
  enqueue: (item: SpeechQueueItem) => void;
  /** Talk pressed, or speech detected while the tutor is speaking. */
  bargeIn: (reason?: BargeInEvent["reason"]) => void;
  /** Reads and clears the pending interruption, to attach to the next turn request. */
  takeInterruption: () => Interruption;
  /** Unlock audio on a user gesture; browsers refuse playback before one. */
  unlock: () => void;
  /** Sentence being spoken right now, so captions can highlight it. */
  spokenIndex: number | null;
  /** Set when speech fell back to browser voice or captions only. */
  notice: string | null;
  /** Where speech is coming from right now. */
  outputMode: SpeechOutputMode;
}

/**
 * Owns the sentence playback queue and barge-in for one session.
 * The server only emits speech items for a voice session, so in a text session this
 * hook simply never receives anything.
 */
export function useVoicePlayback(
  opts: { abortStream?: () => void; queueOptions?: TtsQueueOptions; lang?: string } = {},
): VoicePlayback {
  const queueRef = useRef<TtsQueue | null>(null);
  const bargeRef = useRef<BargeInController | null>(null);
  const pendingRef = useRef<Interruption>({});
  const abortRef = useRef(opts.abortStream);
  const optionsRef = useRef(opts.queueOptions);

  const langRef = useRef(opts.lang ?? "en");
  const [spokenIndex, setSpokenIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outputMode, setOutputMode] = useState<SpeechOutputMode>("server");

  const getQueue = useCallback((): TtsQueue | null => {
    if (typeof window === "undefined") return null;
    if (!queueRef.current) {
      // Server synthesis failed for a sentence (provider down, slow, or the daily cap). The
      // queue speaks it with a system voice in its turn, if one exists for the language, and
      // waits for it; otherwise the sentence stays on captions. Speaking it from the failover
      // event instead played it at once, over the sentences the queue went on playing.
      const queue = new TtsQueue({
        ...optionsRef.current,
        speakFallback:
          optionsRef.current?.speakFallback ??
          ((item, onEnd) => {
            const lang = item.lang ?? langRef.current;
            return chooseBrowserFallback(lang).outputMode === "browser"
              ? speakWithBrowser(item.text, lang, onEnd)
              : null;
          }),
      });
      queue.on("sentenceChange", (index) => setSpokenIndex(index as number));
      queue.on("stopped", () => setSpokenIndex(null));
      // Say why the voice changed.
      queue.on("failover", (payload) => {
        const item = (payload as { item?: SpeechQueueItem } | undefined)?.item;
        const fallback = chooseBrowserFallback(item?.lang ?? langRef.current);
        setOutputMode(fallback.outputMode);
        setNotice(fallback.notice);
      });
      queueRef.current = queue;
      bargeRef.current = new BargeInController({
        queue,
        abortStream: () => abortRef.current?.(),
        onBargeIn: (event) => {
          pendingRef.current = {
            interrupted: true,
            heardUntilSentence:
              event.heardUntilSentence >= 0 ? event.heardUntilSentence : undefined,
          };
        },
      });
    }
    return queueRef.current;
  }, []);

  // Kept current in an effect, not during render, so barge-in always aborts the live stream.
  useEffect(() => {
    abortRef.current = opts.abortStream;
  }, [opts.abortStream]);

  useEffect(() => {
    langRef.current = opts.lang ?? "en";
  }, [opts.lang]);

  useEffect(
    () => () => {
      queueRef.current?.stop();
    },
    [],
  );

  const startTurn = useCallback(() => {
    // stop() deliberately keeps the heard index for the request that is about to go out,
    // so a new turn has to reset the counters itself or it skips its own first sentence.
    getQueue()?.resetTurn(0);
    setSpokenIndex(null);
    setNotice(null);
  }, [getQueue]);

  const enqueue = useCallback(
    (item: SpeechQueueItem) => {
      getQueue()?.enqueue(item);
    },
    [getQueue],
  );

  const bargeIn = useCallback(
    (reason: BargeInEvent["reason"] = "talk_button_pressed") => {
      // Covers the gap between sentences: queued and in-flight audio counts, not just
      // what is audible right now.
      if (!queueRef.current?.hasPendingAudio()) return;
      bargeRef.current?.triggerBargeIn(reason);
    },
    [getQueue],
  );

  const takeInterruption = useCallback((): Interruption => {
    const pending = pendingRef.current;
    pendingRef.current = {};
    return pending;
  }, []);

  const unlock = useCallback(() => {
    void getQueue()?.unlock();
  }, [getQueue]);

  return {
    startTurn,
    enqueue,
    bargeIn,
    takeInterruption,
    unlock,
    spokenIndex,
    notice,
    outputMode,
  };
}
