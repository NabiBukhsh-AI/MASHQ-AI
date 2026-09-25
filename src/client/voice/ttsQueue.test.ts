import { describe, it, expect, vi, beforeEach } from "vitest";
import { TtsQueue, type SpeechQueueItem, type AudioPlayer } from "./ttsQueue";

describe("TtsQueue playback queue and prefetch", () => {
  let mockPlayer: AudioPlayer;
  let playedUrls: string[] = [];
  let triggerEnded: () => void = () => {};
  let triggerError: (err: Error) => void = () => {};

  beforeEach(() => {
    playedUrls = [];
    mockPlayer = {
      play: vi.fn((url: string) => {
        playedUrls.push(url);
        return Promise.resolve();
      }),
      pause: vi.fn(),
      stop: vi.fn(),
      onEnded: (cb) => {
        triggerEnded = cb;
      },
      onError: (cb) => {
        triggerError = cb;
      },
    };
  });

  it("plays sentences in ascending order even when responses arrive out of order", async () => {
    const fetchResolvers = new Map<number, (url: string) => void>();

    const mockFetchAudio = vi.fn((item: SpeechQueueItem) => {
      return new Promise<string>((resolve) => {
        fetchResolvers.set(item.index, resolve);
      });
    });

    const queue = new TtsQueue({
      player: mockPlayer,
      fetchAudio: mockFetchAudio,
      maxInFlight: 2,
    });

    const sentenceChangeEvents: number[] = [];
    queue.on("sentenceChange", (idx) => {
      sentenceChangeEvents.push(idx as number);
    });

    // Enqueue sentence 0 and sentence 1
    queue.enqueue({ index: 0, text: "First sentence." });
    queue.enqueue({ index: 1, text: "Second sentence." });

    expect(mockFetchAudio).toHaveBeenCalledTimes(2);

    // Resolve sentence 1 FIRST (out-of-order network response)
    const resolve1 = fetchResolvers.get(1);
    expect(resolve1).toBeDefined();
    resolve1!("blob:http://localhost/audio-1");

    // Allow promise microtasks to run
    await Promise.resolve();
    await Promise.resolve();

    // Player should NOT play sentence 1 yet because sentence 0 must play first
    expect(playedUrls).toHaveLength(0);
    expect(queue.isPlaying()).toBe(false);

    // Now resolve sentence 0
    const resolve0 = fetchResolvers.get(0);
    expect(resolve0).toBeDefined();
    resolve0!("blob:http://localhost/audio-0");

    await Promise.resolve();
    await Promise.resolve();

    // Sentence 0 should now play!
    expect(playedUrls).toEqual(["blob:http://localhost/audio-0"]);
    expect(sentenceChangeEvents).toEqual([0]);
    expect(queue.getCurrentPlayingIndex()).toBe(0);

    // Now simulate audio 0 ended
    triggerEnded();
    await Promise.resolve();
    await Promise.resolve();

    // Sentence 1 should immediately play next!
    expect(playedUrls).toEqual(["blob:http://localhost/audio-0", "blob:http://localhost/audio-1"]);
    expect(sentenceChangeEvents).toEqual([0, 1]);
    expect(queue.getCurrentPlayingIndex()).toBe(1);
    expect(queue.getHeardUntilSentence()).toBe(1);
  });

  it("limits concurrent fetches to maxInFlight (2 in flight)", async () => {
    const activeFetches: number[] = [];
    const fetchResolvers = new Map<number, (url: string) => void>();

    const mockFetchAudio = vi.fn((item: SpeechQueueItem) => {
      activeFetches.push(item.index);
      return new Promise<string>((resolve) => {
        fetchResolvers.set(item.index, resolve);
      });
    });

    const queue = new TtsQueue({
      player: mockPlayer,
      fetchAudio: mockFetchAudio,
      maxInFlight: 2,
    });

    // Enqueue 4 sentences
    queue.enqueue({ index: 0, text: "Sentence 0" });
    queue.enqueue({ index: 1, text: "Sentence 1" });
    queue.enqueue({ index: 2, text: "Sentence 2" });
    queue.enqueue({ index: 3, text: "Sentence 3" });

    // Only sentences 0 and 1 should have initiated fetch
    expect(activeFetches).toEqual([0, 1]);
    expect(mockFetchAudio).toHaveBeenCalledTimes(2);

    // Complete fetch for sentence 0
    fetchResolvers.get(0)!("blob:http://localhost/audio-0");
    await Promise.resolve();
    await Promise.resolve();

    // Fetch for sentence 2 should now start to maintain 2 in flight
    expect(activeFetches).toEqual([0, 1, 2]);
    expect(mockFetchAudio).toHaveBeenCalledTimes(3);
  });

  it("stop() stops player immediately and aborts in-flight fetch requests", async () => {
    let aborted = false;

    const mockFetchAudio = vi.fn((_item: SpeechQueueItem, signal: AbortSignal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise<string>(() => {});
    });

    const queue = new TtsQueue({
      player: mockPlayer,
      fetchAudio: mockFetchAudio,
    });

    queue.enqueue({ index: 0, text: "Pending sentence" });

    const start = performance.now();
    const heard = queue.stop();
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(150);
    expect(mockPlayer.stop).toHaveBeenCalledTimes(1);
    expect(aborted).toBe(true);
    expect(heard).toBe(-1);
    expect(queue.isPlaying()).toBe(false);
  });

  it("emits failover event when audio player triggers an error", async () => {
    const mockFetchAudio = vi.fn().mockResolvedValue("blob:http://localhost/error-audio");

    const queue = new TtsQueue({
      player: mockPlayer,
      fetchAudio: mockFetchAudio,
    });

    const failoverEvents: unknown[] = [];
    queue.on("failover", (data) => {
      failoverEvents.push(data);
    });

    queue.enqueue({ index: 0, text: "Faulty audio sentence" });
    await Promise.resolve();
    await Promise.resolve();

    // Simulate audio playback failure
    triggerError(new Error("DECODE_ERROR"));

    expect(failoverEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps playing later sentences when one sentence fails to synthesize", async () => {
    const fetchResolvers = new Map<number, (url: string) => void>();
    const fetchRejecters = new Map<number, (err: Error) => void>();

    const mockFetchAudio = vi.fn((item: SpeechQueueItem) => {
      return new Promise<string>((resolve, reject) => {
        fetchResolvers.set(item.index, resolve);
        fetchRejecters.set(item.index, reject);
      });
    });

    const queue = new TtsQueue({
      player: mockPlayer,
      fetchAudio: mockFetchAudio,
      maxInFlight: 3,
    });

    queue.enqueue({ index: 0, text: "First." });
    queue.enqueue({ index: 1, text: "Second." });
    queue.enqueue({ index: 2, text: "Third." });

    // Sentence 0 fails; 1 and 2 succeed.
    fetchRejecters.get(0)!(new Error("tts 500"));
    await Promise.resolve();
    await Promise.resolve();
    fetchResolvers.get(1)!("blob:http://localhost/audio-1");
    fetchResolvers.get(2)!("blob:http://localhost/audio-2");
    await Promise.resolve();
    await Promise.resolve();

    // The failed sentence must not stall the rest of the turn.
    expect(playedUrls).toEqual(["blob:http://localhost/audio-1"]);
    expect(queue.getCurrentPlayingIndex()).toBe(1);

    triggerEnded();
    await Promise.resolve();
    expect(playedUrls).toEqual(["blob:http://localhost/audio-1", "blob:http://localhost/audio-2"]);
    expect(queue.getHeardUntilSentence()).toBe(2);
  });

  it("speaks a fallback sentence in its turn, never over another sentence", async () => {
    // Nabi heard two voices at once (22 Sep): a sentence the server could not voice was
    // spoken by the browser the moment its fetch failed, while the queue went on playing.
    const fetchResolvers = new Map<number, (url: string) => void>();
    const fetchRejecters = new Map<number, (err: Error) => void>();
    const mockFetchAudio = vi.fn(
      (item: SpeechQueueItem) =>
        new Promise<string>((resolve, reject) => {
          fetchResolvers.set(item.index, resolve);
          fetchRejecters.set(item.index, reject);
        }),
    );
    const spoken: string[] = [];
    let endFallback: () => void = () => {};
    const queue = new TtsQueue({
      player: mockPlayer,
      fetchAudio: mockFetchAudio,
      maxInFlight: 3,
      speakFallback: (item, onEnd) => {
        spoken.push(item.text);
        endFallback = onEnd;
        return { cancel: vi.fn() };
      },
    });
    const flush = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    queue.enqueue({ index: 0, text: "First." });
    queue.enqueue({ index: 1, text: "Second." });
    queue.enqueue({ index: 2, text: "Third." });
    fetchResolvers.get(0)!("blob:http://localhost/audio-0");
    fetchRejecters.get(1)!(new Error("tts timed out"));
    fetchResolvers.get(2)!("blob:http://localhost/audio-2");
    await flush();

    // Sentence 0 is playing; the fallback for 1 waits for it.
    expect(playedUrls).toEqual(["blob:http://localhost/audio-0"]);
    expect(spoken).toEqual([]);

    triggerEnded();
    await flush();
    expect(spoken).toEqual(["Second."]);
    // Sentence 2 waits for the fallback to finish.
    expect(playedUrls).toEqual(["blob:http://localhost/audio-0"]);

    endFallback();
    await flush();
    expect(playedUrls).toEqual(["blob:http://localhost/audio-0", "blob:http://localhost/audio-2"]);
  });
});
