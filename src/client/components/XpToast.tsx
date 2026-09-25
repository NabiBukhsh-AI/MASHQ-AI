"use client";

import React, { useEffect, useState } from "react";

export interface XpToastProps {
  amount: number;
  reasonCode: string;
  reasonLabel?: string;
  levelUp?: boolean;
  newLevel?: number;
  onDismiss?: () => void;
  autoDismissMs?: number;
}

const REASON_LABELS: Record<string, string> = {
  correct_first_try: "Correct on first try",
  correct_after_hint: "Solved with hint",
  correct_with_hint: "Solved with hint",
  partial: "Partial answer",
  self_correction: "Self-correction",
  teach_back: "Strong teach-back",
  teach_back_strong: "Strong teach-back",
  callback_correct: "Retention callback",
  retention_hit: "Retention callback",
  mission_complete: "Mission completed",
  chapter_complete: "Chapter completed",
  first_session_of_day: "First session of the day",
};

export function XpToast({
  amount,
  reasonCode,
  reasonLabel,
  levelUp = false,
  newLevel,
  onDismiss,
  autoDismissMs = 4000,
}: XpToastProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  if (!visible) return null;

  const label = reasonLabel || REASON_LABELS[reasonCode] || reasonCode.replace(/_/g, " ");

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="xp-toast"
      className="border-neem/30 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 fixed right-6 bottom-20 z-50 flex max-w-sm items-center gap-3 rounded-xl border bg-white p-4 shadow-lg motion-safe:transition-all motion-safe:duration-300 motion-reduce:transition-none"
    >
      <div className="bg-neem/10 text-neem flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg font-bold">
        <svg className="h-5 w-5 fill-current" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2a1 1 0 01.832.445l4.5 6.5A1 1 0 0114.5 10.5h-9a1 1 0 01-.832-1.555l4.5-6.5A1 1 0 0110 2zm-4.417 9h8.834L10 16.667 5.583 11z" />
        </svg>
      </div>

      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-ink text-base font-bold">+{amount} XP</span>
          {levelUp && newLevel !== undefined && (
            <span
              data-testid="level-up-badge"
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
            >
              Level {newLevel}!
            </span>
          )}
        </div>
        <p className="text-ink/70 text-xs">{label}</p>
      </div>

      <button
        type="button"
        onClick={() => {
          setVisible(false);
          onDismiss?.();
        }}
        aria-label="Dismiss XP notification"
        className="text-ink/40 hover:text-ink focus:ring-neem rounded p-1 focus:ring-2 focus:outline-none"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
