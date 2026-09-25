// @vitest-environment jsdom
// The hook only builds its queue in a browser, so this file needs a DOM.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useVoicePlayback, type VoicePlayback } from "./useVoicePlayback";
import type { AudioPlayer, SpeechQueueItem } from "./ttsQueue";

function harness(abortStream?: () => void) {
  const played: string[] = [];
  let endedCb: () => void = () => {};

  const player: AudioPlayer = {
    play: vi.fn((url: string) => {
      played.push(url);
      return Promise.resolve();
    }),
    pause: vi.fn(),
    stop: vi.fn(),
    onEnded: (cb) => {
      endedCb = cb;
    },
    onError: () => {},
  };

  const fetchAudio = vi.fn((item: SpeechQueueItem) => Promise.resolve(`blob:audio-${item.index}`));

  let hook: VoicePlayback | null = null;
  function TestComponent() {
    hook = useVoicePlayback({ abortStream, queueOptions: { player, fetchAudio } });
    return React.createElement("div", null, String(hook.spokenIndex));
  }
  renderToStaticMarkup(React.createElement(TestComponent));

  return { hook: hook!, played, triggerEnded: () => endedCb() };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("useVoicePlayback", () => {
  it("plays the speech items of a turn in order", async () => {
    const h = harness();
    h.hook.startTurn();
    h.hook.enqueue({ index: 0, text: "Pehla jumla." });
    h.hook.enqueue({ index: 1, text: "Doosra jumla." });
    await flush();

    expect(h.played).toEqual(["blob:audio-0"]);
    h.triggerEnded();
    await flush();
    expect(h.played).toEqual(["blob:audio-0", "blob:audio-1"]);
  });

  it("reports what was heard on barge-in and aborts the tutor stream", async () => {
    const abortStream = vi.fn();
    const h = harness(abortStream);
    h.hook.startTurn();
    h.hook.enqueue({ index: 0, text: "Pehla jumla." });
    h.hook.enqueue({ index: 1, text: "Doosra jumla." });
    await flush();
    h.triggerEnded();
    await flush();

    // The learner talks over sentence 1.
    h.hook.bargeIn("talk_button_pressed");

    expect(abortStream).toHaveBeenCalled();
    expect(h.hook.takeInterruption()).toEqual({ interrupted: true, heardUntilSentence: 1 });
    // Reading it clears it, so the turn after next is not marked interrupted too.
    expect(h.hook.takeInterruption()).toEqual({});
  });

  it("starts the next turn at its own first sentence after a barge-in", async () => {
    const h = harness();
    h.hook.startTurn();
    h.hook.enqueue({ index: 0, text: "Turn one, one." });
    h.hook.enqueue({ index: 1, text: "Turn one, two." });
    await flush();
    h.triggerEnded();
    await flush();
    expect(h.played).toEqual(["blob:audio-0", "blob:audio-1"]);

    h.hook.bargeIn("talk_button_pressed");
    h.hook.takeInterruption();

    // stop() keeps the heard index for the request in flight, so the new turn has to reset
    // the counters or sentence 0 of turn two is skipped.
    h.hook.startTurn();
    h.hook.enqueue({ index: 0, text: "Turn two, one." });
    await flush();

    expect(h.played).toEqual(["blob:audio-0", "blob:audio-1", "blob:audio-0"]);
  });

  it("barges in while the next sentence is still being fetched", async () => {
    const abortStream = vi.fn();
    const played: string[] = [];
    let endedCb: () => void = () => {};
    const pending = new Map<number, (url: string) => void>();

    const player: AudioPlayer = {
      play: vi.fn((url: string) => {
        played.push(url);
        return Promise.resolve();
      }),
      pause: vi.fn(),
      stop: vi.fn(),
      onEnded: (cb) => {
        endedCb = cb;
      },
      onError: () => {},
    };
    const fetchAudio = vi.fn(
      (item: SpeechQueueItem) => new Promise<string>((resolve) => pending.set(item.index, resolve)),
    );

    let hook: VoicePlayback | null = null;
    function TestComponent() {
      hook = useVoicePlayback({ abortStream, queueOptions: { player, fetchAudio } });
      return React.createElement("div", null, "x");
    }
    renderToStaticMarkup(React.createElement(TestComponent));

    hook!.startTurn();
    hook!.enqueue({ index: 0, text: "One." });
    hook!.enqueue({ index: 1, text: "Two." });
    pending.get(0)!("blob:audio-0");
    await flush();
    expect(played).toEqual(["blob:audio-0"]);

    // Sentence 0 finished, sentence 1 is still in flight: the gap between sentences.
    endedCb();
    await flush();
    expect(played).toEqual(["blob:audio-0"]);

    hook!.bargeIn("talk_button_pressed");

    // Without this, sentence 1 lands a moment later and plays into an open microphone.
    expect(abortStream).toHaveBeenCalled();
    expect(hook!.takeInterruption()).toEqual({ interrupted: true, heardUntilSentence: 0 });
  });

  it("ignores a barge-in when there is no audio at all", () => {
    const abortStream = vi.fn();
    const h = harness(abortStream);
    h.hook.bargeIn("talk_button_pressed");
    expect(abortStream).not.toHaveBeenCalled();
    expect(h.hook.takeInterruption()).toEqual({});
  });
});
