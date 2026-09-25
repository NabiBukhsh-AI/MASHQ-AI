"use client";

import type { TtsQueue } from "./ttsQueue";

export interface BargeInEvent {
  reason: "talk_button_pressed" | "speech_detected" | "manual";
  heardUntilSentence: number;
  interrupted: true;
  timestamp: number;
}

export interface BargeInControllerOptions {
  queue: TtsQueue;
  abortStream?: () => void;
  onBargeIn?: (event: BargeInEvent) => void;
}

/**
 * Handles barge-in:
 * Pressing talk, or detecting speech in hands-free mode (at least 2 non-final STT tokens
 * while audio is actively playing), stops audio within 150 ms, clears the queue,
 * aborts the tutor stream, and records heard_until_sentence with interrupted=true.
 */
export class BargeInController {
  private queue: TtsQueue;
  private abortStream?: () => void;
  private onBargeIn?: (event: BargeInEvent) => void;

  private nonFinalTokenCount = 0;
  private lastBargeInEvent: BargeInEvent | null = null;

  constructor(options: BargeInControllerOptions) {
    this.queue = options.queue;
    this.abortStream = options.abortStream;
    this.onBargeIn = options.onBargeIn;
  }

  /**
   * Immediately stops audio playback within 150 ms, aborts tutor stream,
   * and records interrupted state.
   */
  public triggerBargeIn(reason: BargeInEvent["reason"] = "manual"): BargeInEvent {
    // 1. Abort tutor SSE stream if running
    if (this.abortStream) {
      try {
        this.abortStream();
      } catch {
        // Ignore stream abort errors
      }
    }

    // 2. Stop TTS playback queue and get heard index
    const heard = this.queue.stop();

    const event: BargeInEvent = {
      reason,
      heardUntilSentence: heard,
      interrupted: true,
      timestamp: Date.now(),
    };

    this.lastBargeInEvent = event;
    this.nonFinalTokenCount = 0;

    this.onBargeIn?.(event);
    return event;
  }

  /**
   * Called when user presses the talk button or space hotkey.
   */
  public handleTalkPress(): BargeInEvent {
    return this.triggerBargeIn("talk_button_pressed");
  }

  /**
   * Called on incoming STT tokens during hands-free mode.
   * If speech is detected (at least 2 non-final tokens while audio is actively playing),
   * barge-in triggers immediately.
   */
  public handleSttToken(token: { is_final?: boolean; isFinal?: boolean }): BargeInEvent | null {
    const isFinal = Boolean(token.is_final ?? token.isFinal);

    if (!this.queue.isPlaying()) {
      this.nonFinalTokenCount = 0;
      return null;
    }

    if (!isFinal) {
      this.nonFinalTokenCount++;
      if (this.nonFinalTokenCount >= 2) {
        return this.triggerBargeIn("speech_detected");
      }
    } else {
      this.nonFinalTokenCount = 0;
    }

    return null;
  }

  public getLastBargeIn(): BargeInEvent | null {
    return this.lastBargeInEvent;
  }

  public reset(): void {
    this.nonFinalTokenCount = 0;
    this.lastBargeInEvent = null;
  }
}
