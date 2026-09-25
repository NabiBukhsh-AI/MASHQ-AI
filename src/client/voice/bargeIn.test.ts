import { describe, it, expect, vi, beforeEach } from "vitest";
import { BargeInController } from "./bargeIn";
import type { TtsQueue } from "./ttsQueue";

describe("BargeInController", () => {
  let mockQueue: TtsQueue;
  let mockAbortStream = vi.fn(() => {});
  let isPlayingAudio = false;

  beforeEach(() => {
    isPlayingAudio = false;
    mockAbortStream = vi.fn(() => {});
    mockQueue = {
      stop: vi.fn(() => 1), // Heard sentence 1
      isPlaying: vi.fn(() => isPlayingAudio),
    } as unknown as TtsQueue;
  });

  it("stops audio within 150 ms and aborts tutor stream when talk button is pressed", () => {
    const controller = new BargeInController({
      queue: mockQueue,
      abortStream: mockAbortStream,
    });

    const start = performance.now();
    const event = controller.handleTalkPress();
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(150);
    expect(mockAbortStream).toHaveBeenCalledTimes(1);
    expect(mockQueue.stop).toHaveBeenCalledTimes(1);
    expect(event.interrupted).toBe(true);
    expect(event.heardUntilSentence).toBe(1);
    expect(event.reason).toBe("talk_button_pressed");
  });

  it("triggers barge-in in hands-free mode after 2 non-final tokens while audio plays", () => {
    isPlayingAudio = true;
    const bargeInEvents: unknown[] = [];

    const controller = new BargeInController({
      queue: mockQueue,
      abortStream: mockAbortStream,
      onBargeIn: (e) => bargeInEvents.push(e),
    });

    // First non-final token: counter reaches 1, no barge-in yet
    const res1 = controller.handleSttToken({ is_final: false });
    expect(res1).toBeNull();
    expect(mockQueue.stop).not.toHaveBeenCalled();

    // Second non-final token: counter reaches 2, triggers barge-in!
    const res2 = controller.handleSttToken({ is_final: false });
    expect(res2).not.toBeNull();
    expect(res2?.interrupted).toBe(true);
    expect(res2?.reason).toBe("speech_detected");
    expect(mockQueue.stop).toHaveBeenCalledTimes(1);
    expect(mockAbortStream).toHaveBeenCalledTimes(1);
    expect(bargeInEvents).toHaveLength(1);
  });

  it("does not trigger barge-in when audio is not actively playing", () => {
    isPlayingAudio = false;

    const controller = new BargeInController({
      queue: mockQueue,
      abortStream: mockAbortStream,
    });

    // Send multiple non-final tokens
    controller.handleSttToken({ is_final: false });
    controller.handleSttToken({ is_final: false });
    controller.handleSttToken({ is_final: false });

    expect(mockQueue.stop).not.toHaveBeenCalled();
    expect(mockAbortStream).not.toHaveBeenCalled();
    expect(controller.getLastBargeIn()).toBeNull();
  });

  it("resets non-final counter on a final token", () => {
    isPlayingAudio = true;

    const controller = new BargeInController({
      queue: mockQueue,
      abortStream: mockAbortStream,
    });

    // Token 1: non-final
    controller.handleSttToken({ is_final: false });
    // Final token received: counter reset to 0
    controller.handleSttToken({ is_final: true });
    // Token 3: non-final (counter = 1)
    const res = controller.handleSttToken({ is_final: false });

    expect(res).toBeNull();
    expect(mockQueue.stop).not.toHaveBeenCalled();
  });
});
