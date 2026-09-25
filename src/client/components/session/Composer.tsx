"use client";

import React, { useState, useRef, type KeyboardEvent } from "react";
import { TalkButton } from "./TalkButton";

export interface ComposerProps {
  onSend: (text: string) => void;
  onHint?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  /** When set, a Stop button aborts the tutor's reply in flight. */
  onStop?: () => void;
  sessionId?: string;
  contentId?: string;
  voiceEnabled?: boolean;
  /** Fired when talk is pressed, so the page can stop tutor audio. */
  onTalkStart?: () => void;
  /** Shown when speech fell back to browser voice or captions only. */
  speechNotice?: string | null;
}

export function Composer({
  onSend,
  onHint,
  disabled = false,
  isLoading = false,
  placeholder = "Type your reply... (Press Enter to send, Shift+Enter for a new line)",
  onStop,
  sessionId,
  contentId,
  voiceEnabled = true,
  onTalkStart,
  speechNotice = null,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState("");
  // Off by default: a branch counter is noisy, and a microphone that submits on any pause is
  // worse than one the learner controls. The learner turns it on when they want it.
  const [handsFree, setHandsFree] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled || isLoading) return;

    onSend(trimmed);
    setText("");

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter without Shift key
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-adjust height up to 160px
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
  };

  const handleHintClick = () => {
    if (disabled || isLoading) return;
    if (onHint) {
      onHint();
    } else {
      onSend("I need a hint");
    }
  };

  return (
    <footer
      role="region"
      aria-label="Reply composer"
      className="border-mist border-t bg-white/90 p-4 backdrop-blur-sm"
    >
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl flex-col gap-3">
        {speechNotice && (
          <p
            role="status"
            aria-live="polite"
            data-testid="composer-speech-notice"
            className="text-ink/70 text-xs"
          >
            {speechNotice}
          </p>
        )}
        <div className="relative flex flex-col">
          <label htmlFor="session-composer-input" className="sr-only">
            Your answer
          </label>
          <textarea
            id="session-composer-input"
            ref={textareaRef}
            rows={2}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={disabled || isLoading}
            placeholder={placeholder}
            aria-label="Your answer"
            data-testid="composer-input"
            className="border-mist bg-paper text-ink placeholder:text-ink/40 focus:border-neem w-full resize-none rounded-lg border px-3.5 py-2.5 text-sm transition-colors focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Hint button */}
          <button
            type="button"
            onClick={handleHintClick}
            disabled={disabled || isLoading}
            aria-label="Request a hint"
            data-testid="composer-hint-btn"
            className="border-haldi/60 bg-haldi/10 text-ink hover:bg-haldi/20 inline-flex items-center justify-center rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            I need a hint
          </button>

          <div className="flex items-center gap-2">
            {isLoading && onStop && (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop the tutor's reply"
                data-testid="composer-stop-btn"
                className="border-mist text-ink hover:border-kattha/60 inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none"
              >
                Stop
              </button>
            )}

            {/* Talk button (Speech input) */}
            {voiceEnabled && (
              <label
                className="text-ink/70 flex cursor-pointer items-center gap-1.5 text-xs"
                title="Send automatically when you stop speaking"
              >
                <input
                  type="checkbox"
                  checked={handsFree}
                  onChange={(e) => setHandsFree(e.target.checked)}
                  data-testid="hands-free-toggle"
                  className="accent-neem h-3.5 w-3.5"
                />
                Hands free
              </label>
            )}
            {voiceEnabled && (
              <TalkButton
                onTalkStart={onTalkStart}
                sessionId={sessionId}
                contentId={contentId}
                // Hands free turns on endpoint detection, so a pause ends the turn and the
                // transcript is sent without the learner reaching for a button.
                mode={handsFree ? "hands_free" : "push_to_talk"}
                // Not disabled while the tutor is streaming: pressing talk then is the
                // barge-in, which stops the audio and aborts the reply.
                disabled={disabled}
                onTranscript={(spokenText) => {
                  if (spokenText.trim()) {
                    onSend(spokenText.trim());
                  }
                }}
              />
            )}

            {/* Send button */}
            <button
              type="submit"
              disabled={!text.trim() || disabled || isLoading}
              aria-label="Send reply"
              data-testid="composer-send-btn"
              className="bg-neem hover:bg-neem/90 inline-flex items-center justify-center rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </form>
    </footer>
  );
}
