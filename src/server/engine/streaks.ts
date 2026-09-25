import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { streaks } from "../db/schema";
import type { Config } from "../config/schema";

export interface StreakState {
  userId: string;
  currentDays: number;
  longestDays: number;
  lastActiveDate: string | null;
  freezesLeft: number;
}

export interface StreakResult {
  currentDays: number;
  longestDays: number;
  freezeUsed: boolean;
  freezesLeft: number;
  status: "new" | "same_day" | "extended" | "freeze_used" | "reset";
  lastActiveDate: string;
}

/**
 * Format date as YYYY-MM-DD in the specified timezone (default: Asia/Karachi).
 */
export function toKarachiDate(date: Date, timeZone = "Asia/Karachi"): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Calculate difference in calendar days between two YYYY-MM-DD date strings.
 */
export function daysBetween(d1: string, d2: string): number {
  const [y1, m1, day1] = d1.split("-").map(Number);
  const [y2, m2, day2] = d2.split("-").map(Number);
  const utc1 = Date.UTC(y1!, m1! - 1, day1!);
  const utc2 = Date.UTC(y2!, m2! - 1, day2!);
  return Math.round((utc2 - utc1) / (24 * 60 * 60 * 1000));
}

/**
 * Returns Monday of the week (YYYY-MM-DD) for weekly freeze replenishment.
 */
export function getKarachiWeekStart(date: Date, timeZone = "Asia/Karachi"): string {
  const karachiDateStr = toKarachiDate(date, timeZone);
  const [y, m, d] = karachiDateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y!, m! - 1, d!));
  const dayOfWeek = utcDate.getUTCDay();
  // Monday is start of ISO week: Sun(0)->6, Mon(1)->0, Tue(2)->1...
  const diffToMonday = (dayOfWeek + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - diffToMonday);

  const monY = utcDate.getUTCFullYear();
  const monM = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const monD = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${monY}-${monM}-${monD}`;
}

/**
 * Get current streak state for a user.
 */
export async function getStreak(userId: string, deps: { db?: Db } = {}): Promise<StreakState> {
  const db = deps.db ?? defaultDb;
  const [row] = await db
    .select({
      userId: streaks.userId,
      currentDays: streaks.currentDays,
      longestDays: streaks.longestDays,
      lastActiveDate: streaks.lastActiveDate,
      freezesLeft: streaks.freezesLeft,
    })
    .from(streaks)
    .where(eq(streaks.userId, userId));

  if (!row) {
    return {
      userId,
      currentDays: 0,
      longestDays: 0,
      lastActiveDate: null,
      freezesLeft: 1,
    };
  }

  return {
    userId: row.userId,
    currentDays: row.currentDays,
    longestDays: row.longestDays,
    lastActiveDate: row.lastActiveDate,
    freezesLeft: row.freezesLeft,
  };
}

/**
 * Updates streak upon user activity.
 * Strict calendar days in Asia/Karachi.
 * Weekly freeze replenishment (1 freeze/week default).
 * Guardrail: No loss messaging or streak shaming.
 */
export async function updateStreak(
  userId: string,
  now: Date = new Date(),
  deps: { db?: Db; config?: Partial<Config> } = {},
): Promise<StreakResult> {
  const db = deps.db ?? defaultDb;
  const streaksConfig = deps.config?.gamification?.streaks;
  const timeZone = streaksConfig?.timezone ?? "Asia/Karachi";
  const freezesPerWeek = streaksConfig?.freezesPerWeek ?? 1;

  const todayStr = toKarachiDate(now, timeZone);
  const currentWeekStart = getKarachiWeekStart(now, timeZone);

  const [existing] = await db
    .select({
      currentDays: streaks.currentDays,
      longestDays: streaks.longestDays,
      lastActiveDate: streaks.lastActiveDate,
      freezesLeft: streaks.freezesLeft,
      updatedAt: streaks.updatedAt,
    })
    .from(streaks)
    .where(eq(streaks.userId, userId));

  if (!existing || !existing.lastActiveDate) {
    // First active session ever
    const currentDays = 1;
    const longestDays = 1;
    const freezesLeft = freezesPerWeek;

    await db
      .insert(streaks)
      .values({
        userId,
        currentDays,
        longestDays,
        lastActiveDate: todayStr,
        freezesLeft,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: streaks.userId,
        set: {
          currentDays,
          longestDays,
          lastActiveDate: todayStr,
          freezesLeft,
          updatedAt: now,
        },
      });

    return {
      currentDays,
      longestDays,
      freezeUsed: false,
      freezesLeft,
      status: "new",
      lastActiveDate: todayStr,
    };
  }

  // Check weekly freeze replenishment
  let freezesLeft = existing.freezesLeft;
  if (existing.updatedAt) {
    const previousWeekStart = getKarachiWeekStart(existing.updatedAt, timeZone);
    if (previousWeekStart !== currentWeekStart) {
      freezesLeft = Math.max(freezesLeft, freezesPerWeek);
    }
  }

  const diff = daysBetween(existing.lastActiveDate, todayStr);
  let currentDays = existing.currentDays;
  let longestDays = existing.longestDays;
  let freezeUsed = false;
  let status: StreakResult["status"] = "same_day";

  if (diff <= 0) {
    // Same calendar day: streak maintained, no increment
    status = "same_day";
  } else if (diff === 1) {
    // Consecutive calendar day: increment streak
    currentDays += 1;
    longestDays = Math.max(longestDays, currentDays);
    status = "extended";
  } else if (diff === 2 && freezesLeft > 0) {
    // Missed 1 day and freeze available: consume freeze, preserve streak
    freezesLeft -= 1;
    currentDays += 1;
    longestDays = Math.max(longestDays, currentDays);
    freezeUsed = true;
    status = "freeze_used";
  } else {
    // Missed multiple days or no freeze: reset to 1
    currentDays = 1;
    status = "reset";
  }

  await db
    .update(streaks)
    .set({
      currentDays,
      longestDays,
      lastActiveDate: todayStr,
      freezesLeft,
      updatedAt: now,
    })
    .where(eq(streaks.userId, userId));

  return {
    currentDays,
    longestDays,
    freezeUsed,
    freezesLeft,
    status,
    lastActiveDate: todayStr,
  };
}
