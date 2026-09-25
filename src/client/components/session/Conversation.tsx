import React, { useEffect, useRef, type ReactNode } from "react";
import { BidiText, type SupportedLang, type TextDirection } from "../BidiText";

export interface TurnMessage {
  id: string;
  role: "learner" | "tutor" | "system";
  text: string;
  lang?: string;
  dir?: "ltr" | "rtl" | "auto";
  /** Fact ids the tutor cited (from `facts` events); rendered by `renderAfter`. */
  facts?: string[];
  /** A label above the bubble, such as "General knowledge, not from your material". */
  badge?: string;
  /**
   * Figures in this reply that no fact or excerpt supports. Assisted mode shows the sentence
   * as written, so the learner has to be told which numbers are not from their material
   * Strict mode replaces the sentence instead and leaves this empty.
   */
  unverified?: string[];
}

export interface ConversationProps {
  turns?: TurnMessage[];
  isStreaming?: boolean;
  streamingDelta?: string;
  /** Session language, so streaming text is laid out right before the sentence completes. */
  language?: SupportedLang;
  className?: string;
  /** Extra content under a message (fact chips, source links). */
  renderAfter?: (turn: TurnMessage) => ReactNode;
  /** Content after the last message: the current mechanic. */
  children?: ReactNode;
}

export function Conversation({
  turns = [],
  isStreaming = false,
  streamingDelta = "",
  language,
  className = "",
  renderAfter,
  children,
}: ConversationProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages or stream deltas
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, isStreaming, streamingDelta, children]);

  // Only the newest tutor message is announced. Marking the whole transcript live would
  // re-read the history on every turn, which is worse than silence.
  const latestTutor = [...turns].reverse().find((t) => t.role === "tutor");

  return (
    <section
      aria-label="Conversation stream"
      data-testid="conversation-stream"
      className={`flex-1 overflow-y-auto px-4 py-6 md:px-8 ${className}`}
    >
      {/* The completed reply lives in a normal article for reading order; a screen reader
          learns about it here, once, when it arrives. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="tutor-live-region"
        lang={latestTutor?.lang ?? language}
        dir={(latestTutor?.dir as "ltr" | "rtl" | undefined) ?? undefined}
      >
        {!isStreaming && latestTutor ? latestTutor.text : ""}
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {turns.length === 0 && !isStreaming ? (
          <div
            data-testid="conversation-empty"
            className="border-mist rounded-lg border border-dashed bg-white/50 p-8 text-center"
          >
            <p className="text-ink/70 text-sm">
              No messages yet. Read the mission prompt and reply below to begin.
            </p>
          </div>
        ) : (
          turns.map((turn, index) => {
            const isLearner = turn.role === "learner";
            const isSystem = turn.role === "system";
            const turnLang = (turn.lang as SupportedLang) || undefined;
            const turnDir = (turn.dir as TextDirection) || undefined;

            if (isSystem) {
              return (
                <div
                  key={turn.id || `system-${index}`}
                  role="status"
                  className="flex justify-center"
                >
                  <div className="border-mist bg-paper text-ink/70 rounded-full border px-3 py-1 text-xs">
                    <BidiText text={turn.text} lang={turnLang} dir={turnDir} as="span" />
                  </div>
                </div>
              );
            }

            return (
              <article
                key={turn.id || `turn-${index}`}
                aria-label={`${isLearner ? "Your answer" : "Tutor message"}, message ${index + 1}`}
                data-testid={`turn-${turn.role}`}
                data-role={turn.role}
                className={`flex flex-col gap-1.5 ${isLearner ? "items-end" : "items-start"}`}
              >
                {/* Speaker indicator */}
                <span className="text-ink/70 text-xs font-medium">
                  {isLearner ? "You" : "Tutor (Sana)"}
                </span>

                {turn.badge && (
                  <span
                    data-testid="turn-badge"
                    className="border-haldi/60 bg-haldi/15 text-ink rounded-full border px-2 py-0.5 text-xs"
                  >
                    {turn.badge}
                  </span>
                )}

                {turn.unverified && turn.unverified.length > 0 && (
                  <span
                    data-testid="turn-unverified"
                    className="border-kattha/50 bg-kattha/10 text-ink rounded-full border px-2 py-0.5 text-xs"
                  >
                    {`Not checked against your material: ${turn.unverified.join(", ")}`}
                  </span>
                )}

                {/* Message bubble */}
                <div
                  className={`prose-measure rounded-xl px-4 py-3 text-sm shadow-sm transition-colors ${
                    isLearner
                      ? "border-neem/20 bg-neem/10 text-ink border"
                      : "border-mist text-ink border bg-white"
                  }`}
                >
                  <BidiText
                    text={turn.text}
                    lang={turnLang}
                    dir={turnDir}
                    as="div"
                    className="break-words whitespace-pre-wrap"
                  />
                </div>
                {renderAfter?.(turn)}
              </article>
            );
          })
        )}

        {/* Live streaming bubble */}
        {isStreaming && (
          <article
            aria-label="Tutor is typing"
            aria-live="polite"
            data-testid="turn-streaming"
            className="flex flex-col items-start gap-1.5"
          >
            <span className="text-ink/70 text-xs font-medium">Tutor (Sana)</span>
            <div className="prose-measure border-mist rounded-xl border bg-white px-4 py-3 text-sm shadow-sm">
              {streamingDelta ? (
                <BidiText
                  text={streamingDelta}
                  lang={language}
                  dir={language === "ur" || language === "mixed" ? "rtl" : undefined}
                  as="div"
                  className="whitespace-pre-wrap"
                />
              ) : (
                <span className="text-ink/70 flex items-center gap-1.5 text-xs">
                  <span className="bg-neem h-2 w-2 animate-pulse rounded-full" />
                  Thinking...
                </span>
              )}
            </div>
          </article>
        )}

        {children}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </section>
  );
}
