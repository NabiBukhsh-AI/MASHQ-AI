"use client";

import React from "react";

export interface UnlockBannerProps {
  title: string;
  description?: string;
  kind?: "chapter" | "final_challenge";
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function UnlockBanner({
  title,
  description,
  kind = "chapter",
  onAction,
  onDismiss,
  className = "",
}: UnlockBannerProps): React.JSX.Element {
  const isFinal = kind === "final_challenge";
  const defaultDesc = isFinal
    ? "You have completed all prerequisite missions. Take on the comprehensive branch scenario!"
    : "You have unlocked a new chapter in your practice journey.";

  return (
    <div
      role="region"
      aria-live="polite"
      data-testid="unlock-banner"
      className={`border-neem/40 from-neem/10 rounded-xl border bg-gradient-to-r via-emerald-50 to-amber-50 p-4 shadow-sm motion-safe:transition-all motion-safe:duration-300 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="bg-neem flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-white">
            {isFinal ? (
              <svg className="h-5 w-5 fill-current" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ) : (
              <svg className="h-5 w-5 fill-current" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 2a4 4 0 00-4 4v1H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2v-7a2 2 0 00-2-2h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-4 5a2 2 0 114 0 2 2 0 01-4 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="bg-neem/20 text-neem rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                {isFinal ? "Final Challenge Unlocked" : "Chapter Unlocked"}
              </span>
            </div>
            <h3 className="text-ink mt-1 text-sm font-bold">{title}</h3>
            <p className="text-ink/80 mt-0.5 text-xs">{description || defaultDesc}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onAction && (
            <button
              type="button"
              onClick={onAction}
              className="bg-neem hover:bg-neem/90 focus:ring-neem rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm focus:ring-2 focus:outline-none"
            >
              {isFinal ? "Start Challenge" : "Open Chapter"}
            </button>
          )}

          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss unlock notification"
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
          )}
        </div>
      </div>
    </div>
  );
}
