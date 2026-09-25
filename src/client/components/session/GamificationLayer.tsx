"use client";

import React from "react";
import { z } from "zod";
import { XpToast } from "../XpToast";
import { StreakMeter } from "../StreakMeter";
import { UnlockBanner } from "../UnlockBanner";

/**
 * The gamification event arrives over the wire as unknown, so it is parsed here before
 * anything is rendered from it.
 */
export const GamificationDataSchema = z.object({
  xpAwards: z
    .array(
      z.object({
        id: z.string(),
        amount: z.number(),
        reasonCode: z.string(),
        level: z.number(),
        levelUp: z.boolean(),
      }),
    )
    .default([]),
  streak: z
    .object({
      currentDays: z.number(),
      freezesLeft: z.number().optional(),
      freezeUsed: z.boolean().optional(),
    })
    .optional(),
  newBadges: z
    .array(
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
});

export type GamificationData = z.infer<typeof GamificationDataSchema>;

export function parseGamification(payload: unknown): GamificationData | null {
  const parsed = GamificationDataSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export interface GamificationLayerProps {
  data: GamificationData | null;
  onDismiss: () => void;
}

/**
 * Shows what the turn just earned: XP, a new streak day, and any badge unlocked.
 * One celebration at a time, and every motion is left to the components, which honour
 * prefers-reduced-motion.
 */
export function GamificationLayer({
  data,
  onDismiss,
}: GamificationLayerProps): React.JSX.Element | null {
  if (!data) return null;

  const earned = data.xpAwards.filter((a) => a.amount > 0);
  const badge = data.newBadges[0];
  if (earned.length === 0 && !badge && !data.streak?.freezeUsed) return null;

  // One toast for the turn: the awards are summed, and a level up wins the label.
  const total = earned.reduce((sum, a) => sum + a.amount, 0);
  const levelUpAward = earned.find((a) => a.levelUp);
  const headline = earned[0];

  return (
    <div
      aria-live="polite"
      data-testid="gamification-layer"
      className="pointer-events-none fixed right-4 bottom-28 z-30 flex w-72 flex-col items-end gap-2"
    >
      {badge && (
        <div className="pointer-events-auto w-full">
          <UnlockBanner title={badge.name} description={badge.description} onDismiss={onDismiss} />
        </div>
      )}

      {total > 0 && headline && (
        <div className="pointer-events-auto w-full">
          <XpToast
            amount={total}
            reasonCode={headline.reasonCode}
            levelUp={Boolean(levelUpAward)}
            newLevel={levelUpAward?.level}
            onDismiss={onDismiss}
          />
        </div>
      )}

      {data.streak && data.streak.currentDays > 0 && (
        <div className="pointer-events-auto w-full">
          <StreakMeter
            currentDays={data.streak.currentDays}
            freezesLeft={data.streak.freezesLeft}
          />
        </div>
      )}
    </div>
  );
}
