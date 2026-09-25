import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { badges, userBadges } from "../db/schema";

export interface BadgeEvaluationContext {
  missionsCompleted?: number;
  teachBackScore?: number;
  streakDays?: number;
  selfCorrected?: boolean;
  roleplayCompleted?: boolean;
  allRoleplayDemonstrated?: boolean;
  masteredAfterIncorrect?: number;
  language?: string;
  evidenceRef?: string;
}

export interface BadgeSummary {
  id: string;
  code: string;
  name: string;
  nameUr: string | null;
  description: string;
  awardedAt?: Date;
  evidenceRef?: string | null;
}

/**
 * Pure evaluation of whether a badge's criteria are satisfied by the given context.
 */
export function isBadgeEligible(
  badge: { code: string; criteria?: Record<string, unknown> | null },
  context: BadgeEvaluationContext,
): boolean {
  const code = badge.code;
  const crit = (badge.criteria ?? {}) as Record<string, unknown>;

  // Check by specific well-known badge codes
  if (code === "first_mission" || code === "first_steps") {
    if (context.missionsCompleted !== undefined && context.missionsCompleted >= 1) return true;
  }
  if (code === "teach_back" || code === "clear_explainer") {
    if (context.teachBackScore !== undefined && context.teachBackScore >= 0.8) return true;
  }
  if (code === "self_correct") {
    if (context.selfCorrected) return true;
  }
  if (code === "streak_3" || code === "steady") {
    if (context.streakDays !== undefined && context.streakDays >= 3) return true;
  }
  if (code === "customer_first") {
    if (context.allRoleplayDemonstrated || context.roleplayCompleted) return true;
  }
  if (code === "comeback") {
    if (context.masteredAfterIncorrect !== undefined && context.masteredAfterIncorrect >= 2) {
      return true;
    }
  }
  if (code === "bilingual") {
    if (context.language === "ur" || context.language === "mixed") return true;
  }

  // Generic matching against criteria JSONB fields
  if (typeof crit.missionsCompleted === "number") {
    if ((context.missionsCompleted ?? 0) >= crit.missionsCompleted) return true;
  }
  if (typeof crit.streakDays === "number") {
    if ((context.streakDays ?? 0) >= crit.streakDays) return true;
  }
  if (crit.signal === "teach_back" && typeof crit.minScore === "number") {
    if ((context.teachBackScore ?? 0) >= crit.minScore) return true;
  }
  if (crit.selfCorrected && context.selfCorrected) {
    return true;
  }

  return false;
}

/**
 * Returns all badges earned by a user.
 */
export async function getUserBadges(
  userId: string,
  deps: { db?: Db } = {},
): Promise<BadgeSummary[]> {
  const db = deps.db ?? defaultDb;
  const rows = await db
    .select({
      id: badges.id,
      code: badges.code,
      name: badges.name,
      nameUr: badges.nameUr,
      description: badges.description,
      awardedAt: userBadges.awardedAt,
      evidenceRef: userBadges.evidenceRef,
    })
    .from(userBadges)
    .innerJoin(badges, eq(userBadges.badgeId, badges.id))
    .where(eq(userBadges.userId, userId));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    nameUr: r.nameUr,
    description: r.description,
    awardedAt: r.awardedAt,
    evidenceRef: r.evidenceRef,
  }));
}

/**
 * Evaluates all unearned badges for the user, persists new awards idempotently,
 * and returns the newly awarded badges.
 */
export async function evaluateBadges(
  userId: string,
  context: BadgeEvaluationContext,
  deps: { db?: Db } = {},
): Promise<BadgeSummary[]> {
  const db = deps.db ?? defaultDb;

  // 1. Fetch all system badges
  const allBadges = await db.select().from(badges);
  if (allBadges.length === 0) {
    return [];
  }

  // 2. Fetch already awarded badge IDs
  const earned = await db
    .select({ badgeId: userBadges.badgeId })
    .from(userBadges)
    .where(eq(userBadges.userId, userId));
  const earnedIds = new Set(earned.map((e) => e.badgeId));

  const newlyAwarded: BadgeSummary[] = [];

  for (const badge of allBadges) {
    if (earnedIds.has(badge.id)) continue;

    if (isBadgeEligible(badge, context)) {
      const now = new Date();
      await db
        .insert(userBadges)
        .values({
          userId,
          badgeId: badge.id,
          awardedAt: now,
          evidenceRef: context.evidenceRef ?? null,
        })
        .onConflictDoNothing();

      newlyAwarded.push({
        id: badge.id,
        code: badge.code,
        name: badge.name,
        nameUr: badge.nameUr,
        description: badge.description,
        awardedAt: now,
        evidenceRef: context.evidenceRef ?? null,
      });
      earnedIds.add(badge.id);
    }
  }

  return newlyAwarded;
}
