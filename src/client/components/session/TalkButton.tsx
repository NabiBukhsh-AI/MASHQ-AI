"use client";

import React, { useEffect, useCallback } from "react";
import { useStt, type SttMode, type UseSttOptions } from "@/client/voice/useStt";

export interface TalkButtonProps {
  onTranscript: (text: string) => void;
  /** Fired the instant talk is pressed, so tutor audio can stop (barge-in). */
  onTalkStart?: () => void;
  disabled?: boolean;
  sessionId?: string;
  contentId?: string;
  hints?: string[];
  context?: { terms?: string[] };
  mode?: SttMode;
  autoSend?: boolean;
  className?: string;
}

export function TalkButton({
  onTranscript,
  onTalkStart,
  disabled = false,
  sessionId,
  contentId,
  hints,
  context,
  mode: initialMode = "push_to_talk",
  autoSend = true,
  className = "",
}: TalkButtonProps): React.JSX.Element {
  const handleEndpoint = useCallback(
    (text: string) => {
      if (text.trim()) {
        onTranscript(text.trim());
      }
    },
    [onTranscript],
  );

  const sttOptions: UseSttOptions = {
    sessionId,
    contentId,
    hints,
    context,
    mode: initialMode,
    onEndpoint: handleEndpoint,
  };

  const stt = useStt(sttOptions);
  const isRecording = stt.state === "listening" || stt.state === "recognizing";

  // Tap to start, tap again to send, in both modes. Holding was hard to manage in practice
  // (Nabi, 22 Sep), and a missed release left the microphone open. Hands free adds one thing:
  // a pause also sends, so the second tap is optional.
  const handsFree = initialMode === "hands_free";

  const begin = useCallback(() => {
    // Barge-in first: the tutor must go quiet before the microphone opens, or it
    // records its own voice.
    onTalkStart?.();
    void stt.start();
  }, [stt, onTalkStart]);

  const finish = useCallback(() => {
    const fullTranscript = (stt.final + " " + stt.partial).trim();
    void stt.stop();
    if (autoSend && fullTranscript) {
      onTranscript(fullTranscript);
      stt.clear();
    }
  }, [stt, autoSend, onTranscript]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (isRecording) finish();
    else begin();
  }, [disabled, isRecording, finish, begin]);

  // Spacebar anywhere outside a control does the same as a tap.
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;

      // Leave Space alone whenever it already means something to the focused element:
      // typing, and activating a button or link. Otherwise a keyboard user cannot press
      // "Send" or "I need a hint" at all.
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.tagName === "BUTTON" ||
          activeEl.tagName === "A" ||
          activeEl.getAttribute("role") === "button" ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();
      toggle();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, toggle]);

  const liveCaption = (stt.final + " " + stt.partial).trim();

  return (
    <div className={`relative inline-flex flex-col items-center ${className}`}>
      {/* Live Captions Display */}
      {isRecording && (
        <div
          role="status"
          aria-live="polite"
          data-testid="stt-live-caption"
          className="border-neem/40 text-ink absolute -top-12 z-20 max-w-xs truncate rounded-md border bg-white px-3 py-1 text-xs shadow-md"
        >
          {liveCaption || "Listening..."}
        </div>
      )}

      {/* Error alert notice */}
      {stt.error && (
        <div
          role="alert"
          data-testid="stt-error-alert"
          className="border-kattha/30 bg-kattha/10 text-kattha absolute -top-14 z-20 w-64 rounded-md border p-2 text-xs shadow-md"
        >
          {stt.error}
        </div>
      )}

      {/* Talk Button */}
      <button
        type="button"
        // One click handler covers mouse, touch, pen and keyboard.
        onClick={toggle}
        disabled={disabled}
        aria-pressed={isRecording}
        aria-label={
          isRecording
            ? handsFree
              ? "Listening. Pause or tap again to send your answer."
              : "Listening. Tap again to send your answer."
            : handsFree
              ? "Tap to speak. Your answer is sent when you pause. Or press Spacebar."
              : "Tap to speak, tap again to send. Or press Spacebar."
        }
        data-testid="talk-button"
        className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          isRecording
            ? "border-neem bg-neem text-white shadow-md motion-safe:animate-pulse"
            : "border-mist bg-paper text-ink hover:border-neem/60 hover:bg-white"
        }`}
      >
        {/* Microphone SVG */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
          <path d="M5.5 9.64A.75.75 0 016.25 10a3.75 3.75 0 007.5 0 .75.75 0 011.5 0 5.25 5.25 0 01-4.5 5.195V17a.75.75 0 01-1.5 0v-1.805A5.25 5.25 0 014.75 10a.75.75 0 01.75-.36z" />
        </svg>

        <span>{isRecording ? "Listening... tap to send" : "Tap to speak"}</span>
      </button>
    </div>
  );
}
