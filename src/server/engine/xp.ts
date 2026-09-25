import { and, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "@/lib/ids";
import { db as defaultDb, type Db } from "../db/client";
import { learnerProfiles, xpLedger } from "../db/schema";
import type { Config } from "../config/schema";

/**
 * Standard XP amounts from the default config.
 * Deterministic awards only.
 */
export const DEFAULT_XP_MAP: Record<string, number> = {
  correct_first_try: 10,
  correct_after_hint: 5,
  correct_with_hint: 5,
  partial: 3,
  self_correction: 6,
  teach_back: 25,
  teach_back_strong: 25,
  callback_correct: 15,
  retention_hit: 15,
  mission_complete: 50,
  chapter_complete: 100,
  first_session_of_day: 20,
};

/** Default level progression thresholds. */
export const DEFAULT_LEVELS = [0, 100, 250, 500, 900, 1400, 2000];

export type XpReasonCode =
  | "correct_first_try"
  | "correct_after_hint"
  | "correct_with_hint"
  | "partial"
  | "self_correction"
  | "teach_back"
  | "teach_back_strong"
  | "callback_correct"
  | "retention_hit"
  | "mission_complete"
  | "chapter_complete"
  | "first_session_of_day";

export interface XpEventInput {
  orgId: string;
  userId: string;
  sessionId?: string | null;
  reasonCode: XpReasonCode | string;
  refId?: string | null;
  amount?: number;
}

export interface LevelInfo {
  level: number;
  totalXp: number;
  currentLevelXp: number;
  nextLevelXp: number | null;
  progress: number;
}

export interface XpAwardResult {
  id: string;
  amount: number;
  reasonCode: string;
  totalXp: number;
  level: number;
  levelUp: boolean;
  previousLevel: number;
  progress: number;
  nextLevelXp: number | null;
}

/**
 * Pure calculation of learner level from total XP and thresholds.
 * Threshold array: [0, 100, 250, 500, 900, 1400, 2000] maps to levels 1 through 7.
 */
export function calculateLevel(totalXp: number, levels: number[] = DEFAULT_LEVELS): LevelInfo {
  const safeXp = Math.max(0, totalXp);
  const safeLevels = levels.length >= 2 ? levels : DEFAULT_LEVELS;

  let idx = 0;
  for (let i = 0; i < safeLevels.length; i++) {
    if (safeXp >= safeLevels[i]!) {
      idx = i;
    } else {
      break;
    }
  }

  const level = idx + 1;
  const currentLevelXp = safeLevels[idx]!;
  const hasNext = idx + 1 < safeLevels.length;
  const nextLevelXp = hasNext ? safeLevels[idx + 1]! : null;

  let progress = 1.0;
  if (nextLevelXp !== null && nextLevelXp > currentLevelXp) {
    progress = Math.min(1, Math.max(0, (safeXp - currentLevelXp) / (nextLevelXp - currentLevelXp)));
  }

  return {
    level,
    totalXp: safeXp,
    currentLevelXp,
    nextLevelXp,
    progress: Math.round(progress * 1000) / 1000,
  };
}

/**
 * Returns total XP earned by a user by summing the append-only ledger.
 */
export async function getUserTotalXp(userId: string, db: Db = defaultDb): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${xpLedger.amount}), 0)` })
    .from(xpLedger)
    .where(eq(xpLedger.userId, userId));
  return Number(row?.total ?? 0);
}

/**
 * Returns full XP and level status for a user.
 */
export async function getUserXpState(
  userId: string,
  deps: { db?: Db; config?: Partial<Config> } = {},
): Promise<LevelInfo> {
  const db = deps.db ?? defaultDb;
  const levels = deps.config?.gamification?.levels ?? DEFAULT_LEVELS;
  const totalXp = await getUserTotalXp(userId, db);
  return calculateLevel(totalXp, levels);
}

/**
 * Awards XP to a user, appends to the immutable ledger, and updates level on profile.
 * Only deterministic server rules call this function.
 */
export async function awardXp(
  event: XpEventInput,
  deps: { db?: Db; config?: Partial<Config> } = {},
): Promise<XpAwardResult> {
  const db = deps.db ?? defaultDb;
  const gamificationConfig = deps.config?.gamification;

  if (gamificationConfig && gamificationConfig.enabled === false) {
    const totalXp = await getUserTotalXp(event.userId, db);
    const info = calculateLevel(totalXp, gamificationConfig.levels ?? DEFAULT_LEVELS);
    return {
      id: "",
      amount: 0,
      reasonCode: event.reasonCode,
      totalXp,
      level: info.level,
      levelUp: false,
      previousLevel: info.level,
      progress: info.progress,
      nextLevelXp: info.nextLevelXp,
    };
  }

  const levels = gamificationConfig?.levels ?? DEFAULT_LEVELS;
  const xpConfig = gamificationConfig?.xp ?? {};

  const amount =
    event.amount !== undefined
      ? event.amount
      : (xpConfig[event.reasonCode] ?? DEFAULT_XP_MAP[event.reasonCode] ?? 0);

  const entryId = uuidv7();

  // 1. Fetch current profile level before insert
  const [existingProfile] = await db
    .select({ level: learnerProfiles.level })
    .from(learnerProfiles)
    .where(eq(learnerProfiles.userId, event.userId));
  const previousLevel = existingProfile?.level ?? 1;

  // 2. Append to ledger if amount > 0, once per (user, session, reason, ref). A duplicate
  // final turn would otherwise award mission_complete twice, since it refs the mission, not
  // the turn. Scoped to the session so replaying a journey in a new session still earns.
  // ponytail: read then write, safe because the per-session turn lock serializes awards;
  // a unique index on (user_id, reason_code, ref_id) is the real fix if that ever changes.
  if (amount > 0 && event.refId) {
    const [duplicate] = await db
      .select({ id: xpLedger.id })
      .from(xpLedger)
      .where(
        and(
          eq(xpLedger.userId, event.userId),
          eq(xpLedger.reasonCode, event.reasonCode),
          eq(xpLedger.refId, event.refId),
          event.sessionId ? eq(xpLedger.sessionId, event.sessionId) : isNull(xpLedger.sessionId),
        ),
      )
      .limit(1);
    if (duplicate) {
      const existingTotal = await getUserTotalXp(event.userId, db);
      const existingLevel = calculateLevel(existingTotal, levels);
      return {
        id: duplicate.id,
        amount: 0,
        reasonCode: event.reasonCode,
        totalXp: existingTotal,
        level: existingLevel.level,
        previousLevel: existingLevel.level,
        levelUp: false,
        progress: existingLevel.progress,
        nextLevelXp: existingLevel.nextLevelXp,
      };
    }
  }

  if (amount > 0) {
    await db.insert(xpLedger).values({
      id: entryId,
      orgId: event.orgId,
      userId: event.userId,
      sessionId: event.sessionId ?? null,
      amount,
      reasonCode: event.reasonCode,
      refId: event.refId ?? null,
    });
  }

  // 3. Compute new total and level
  const totalXp = await getUserTotalXp(event.userId, db);
  const levelInfo = calculateLevel(totalXp, levels);
  const levelUp = levelInfo.level > previousLevel;

  // 4. Update learner profile if level changed or row does not exist
  await db
    .insert(learnerProfiles)
    .values({
      userId: event.userId,
      orgId: event.orgId,
      level: levelInfo.level,
    })
    .onConflictDoUpdate({
      target: learnerProfiles.userId,
      set: {
        level: levelInfo.level,
        updatedAt: new Date(),
      },
    });

  return {
    id: entryId,
    amount,
    reasonCode: event.reasonCode,
    totalXp,
    level: levelInfo.level,
    levelUp,
    previousLevel,
    progress: levelInfo.progress,
    nextLevelXp: levelInfo.nextLevelXp,
  };
}
