"use client";

import React from "react";

export interface LevelBadgeProps {
  level: number;
  totalXp?: number;
  currentLevelXp?: number;
  nextLevelXp?: number | null;
  progress?: number;
  className?: string;
}

export function LevelBadge({
  level,
  totalXp,
  nextLevelXp,
  progress = 0,
  className = "",
}: LevelBadgeProps): React.JSX.Element {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const label =
    nextLevelXp !== null && nextLevelXp !== undefined && totalXp !== undefined
      ? `Level ${level}: ${totalXp} XP (${percent}% to Level ${level + 1})`
      : `Level ${level}: ${totalXp ?? 0} XP`;

  return (
    <div
      data-testid="level-badge"
      aria-label={label}
      title={label}
      className={`border-mist bg-paper/80 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs shadow-sm ${className}`}
    >
      <div className="bg-neem flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white">
        {level}
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink font-semibold">Level {level}</span>
          {/* Full ink, not ink/60: at 10px this counts as small text and needs the higher
              contrast ratio. The violation only surfaced once this badge stopped being dead
              code and axe could actually see it. */}
          {nextLevelXp !== null && nextLevelXp !== undefined && (
            <span className="text-ink text-[10px]">{percent}%</span>
          )}
        </div>

        {nextLevelXp !== null && nextLevelXp !== undefined && (
          <div className="bg-mist mt-0.5 h-1 w-16 overflow-hidden rounded-full">
            <div
              className="bg-neem h-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
