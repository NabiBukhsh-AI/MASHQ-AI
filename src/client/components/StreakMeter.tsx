"use client";

import React from "react";

export interface StreakMeterProps {
  currentDays: number;
  longestDays?: number;
  freezesLeft?: number;
  className?: string;
}

export function StreakMeter({
  currentDays,
  longestDays,
  freezesLeft = 1,
  className = "",
}: StreakMeterProps): React.JSX.Element {
  const label = `${currentDays} day streak (${freezesLeft} freeze available)`;

  return (
    <div
      data-testid="streak-meter"
      aria-label={label}
      title={longestDays ? `Best streak: ${longestDays} days` : label}
      className={`border-mist bg-paper/80 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs shadow-sm ${className}`}
    >
      {/* Flame Icon */}
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-600">
        <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 20 20" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.527.82-1.144 2.107-1.144 3.702 0 1.25.32 2.378.85 3.32a.75.75 0 01-.643 1.11 3.498 3.498 0 01-3.18-1.928 6.947 6.947 0 00-.776 2.748c0 3.866 3.134 7 7 7s7-3.134 7-7c0-2.836-1.684-5.28-4.035-6.457z"
            clipRule="evenodd"
          />
        </svg>
      </span>

      {/* Streak Count */}
      <div className="flex items-baseline gap-1">
        <span className="text-ink font-bold">{currentDays}</span>
        <span className="text-ink/70 text-[11px]">{currentDays === 1 ? "day" : "days"}</span>
      </div>

      {/* Freeze indicator */}
      {freezesLeft > 0 && (
        <span
          title="Weekly freeze active to protect your streak"
          className="inline-flex items-center text-sky-600"
        >
          <svg className="h-3 w-3 fill-current" viewBox="0 0 20 20" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M10 2a.75.75 0 01.75.75v2.33l1.64-1.64a.75.75 0 111.06 1.06L11.56 6.4v2.04l1.77-1.02 1.64-1.64a.75.75 0 111.06 1.06l-1.64 1.64h2.36a.75.75 0 010 1.5h-2.36l1.64 1.64a.75.75 0 11-1.06 1.06l-1.64-1.64-1.77-1.02v2.04l1.89 1.89a.75.75 0 11-1.06 1.06L10.75 14.92v2.33a.75.75 0 01-1.5 0v-2.33l-1.64 1.64a.75.75 0 11-1.06-1.06l1.89-1.89v-2.04l-1.77 1.02-1.64 1.64a.75.75 0 11-1.06-1.06l1.64-1.64H3.25a.75.75 0 010-1.5h2.36L3.97 7.48a.75.75 0 011.06-1.06l1.64 1.64 1.77 1.02V7.04L6.55 5.15a.75.75 0 111.06-1.06l1.64 1.64V2.75A.75.75 0 0110 2z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      )}
    </div>
  );
}
