import { uuidv7 } from "@/lib/ids";
import type { Config } from "../config/schema";

export interface PendingCallback {
  id: string;
  conceptId: string;
  conceptKey?: string;
  scheduledAt: Date;
  dueAt: Date;
  delayMinutes: number;
  fired: boolean;
  completed: boolean;
  correct?: boolean;
}

export interface CallbackMetrics {
  totalCallbacks: number;
  successfulCallbacks: number;
  successRate: number;
}

/**
 * Schedules a retention callback when a concept reaches proficient (p >= 0.70).
 * Default delay is 8 minutes (policy.callbackDelayMinutes).
 */
export function scheduleCallback(
  conceptId: string,
  now: Date = new Date(),
  config?: Partial<Config>,
  conceptKey?: string,
): PendingCallback {
  const delayMinutes = config?.policy?.callbackDelayMinutes ?? 8;
  const dueAt = new Date(now.getTime() + delayMinutes * 60 * 1000);

  return {
    id: uuidv7(),
    conceptId,
    conceptKey,
    scheduledAt: now,
    dueAt,
    delayMinutes,
    fired: false,
    completed: false,
  };
}

/**
 * Checks if a pending callback is due based on current time.
 */
export function isCallbackDue(callback: PendingCallback, now: Date = new Date()): boolean {
  if (callback.completed || callback.fired) return false;
  return now.getTime() >= callback.dueAt.getTime();
}

/**
 * Finds the first callback that is due and ready to fire at a beat boundary.
 * R12: A callback only fires when due and at a beat boundary.
 */
export function checkPendingCallbacks(
  callbacks: PendingCallback[],
  now: Date = new Date(),
  isAtBeatBoundary = true,
): PendingCallback | null {
  if (!isAtBeatBoundary) return null;

  for (const cb of callbacks) {
    if (isCallbackDue(cb, now)) {
      return cb;
    }
  }

  return null;
}

/**
 * Calculates reliability weight w with retention boost:
 * w = min(1, baseWeight * 1.15) for same-session callback >= 8 minutes later.
 * w = min(1, baseWeight * 1.30) for next day or later.
 */
export function applyRetentionBoost(baseWeight = 0.8, delayMinutes = 8, isNextDay = false): number {
  if (delayMinutes < 8) return baseWeight;

  const boost = isNextDay ? 1.3 : 1.15;
  const boosted = Math.min(1, baseWeight * boost);
  return Math.round(boosted * 1000) / 1000;
}

/**
 * Computes callback success statistics.
 */
export function calculateCallbackMetrics(
  callbacks: Array<{ completed: boolean; correct?: boolean }>,
): CallbackMetrics {
  const completed = callbacks.filter((c) => c.completed && c.correct !== undefined);
  const totalCallbacks = completed.length;
  const successfulCallbacks = completed.filter((c) => c.correct).length;
  const successRate =
    totalCallbacks > 0 ? Math.round((successfulCallbacks / totalCallbacks) * 1000) / 1000 : 0;

  return {
    totalCallbacks,
    successfulCallbacks,
    successRate,
  };
}
