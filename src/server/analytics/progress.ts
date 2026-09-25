import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { concepts, evidenceEvents, masteryStates, streaks, userBadges, badges } from "../db/schema";
import { calculateLevel, getUserTotalXp } from "../engine/xp";
import type { Config } from "../config/schema";

/**
 * The learner's own progress.
 *
 * Everything here is scoped to one userId, which the route takes from the session, so a
 * learner can only ever see themselves. Mastery is always labelled as an estimate, and every
 * evidence row carries a plain sentence saying why it counted.
 */

export interface ConceptProgress {
  conceptId: string;
  conceptKey: string;
  conceptLabel: string;
  /** Estimated, never presented as a measurement. */
  p: number;
  band: string;
  lower: number;
  upper: number;
  nEvents: number;
  lastEvidenceAt: Date | null;
}

export interface EvidenceLine {
  id: string;
  conceptLabel: string;
  verdict: string;
  signal: string;
  score: number;
  hintLevel: number;
  selfCorrected: boolean;
  at: Date | null;
  /** Plain language reason this event moved the estimate, for the learner not the engineer. */
  why: string;
}

/** Turns one evidence row into a sentence a learner can act on. */
export function whyLine(e: {
  verdict: string;
  signal: string;
  hintLevel: number;
  selfCorrected: boolean;
  pBefore: number;
  pAfter: number;
}): string {
  const moved = e.pAfter - e.pBefore;
  const direction =
    Math.abs(moved) < 0.005
      ? "Your estimate stayed about the same"
      : moved > 0
        ? "Your estimate went up"
        : "Your estimate went down";

  const how =
    e.verdict === "correct"
      ? e.hintLevel > 0
        ? "you got it right after a hint, which counts for a little less than first time"
        : "you got it right first time"
      : e.verdict === "partial"
        ? "you got part of it"
        : e.verdict === "not_an_answer"
          ? "this turn was not an answer, so it counted for very little"
          : "this one did not go in";

  const extra = e.selfCorrected ? ", and you spotted the mistake yourself" : "";
  return `${direction} because ${how}${extra}.`;
}

export interface LearnerProgress {
  concepts: ConceptProgress[];
  evidence: EvidenceLine[];
  xp: { total: number; level: number; nextLevelXp: number | null; progress: number };
  streak: { currentDays: number; longestDays: number; freezesLeft: number };
  badges: Array<{ code: string; name: string; description: string; awardedAt: Date | null }>;
  minutesThisWeek: number;
  nextRecommendation: { kind: string; label: string; reason: string } | null;
}

/**
 * The next thing to do, by this rule: a due callback first, then the
 * weakest concept, then simply the next mission. Deterministic, so the screen can explain it.
 */
export function nextRecommendation(
  conceptRows: ConceptProgress[],
  now = new Date(),
  dueCallback?: { conceptLabel: string } | null,
): LearnerProgress["nextRecommendation"] {
  if (dueCallback) {
    return {
      kind: "callback",
      label: dueCallback.conceptLabel,
      reason: "A quick recall check on something you learned earlier is due.",
    };
  }
  const practised = conceptRows.filter((c) => c.nEvents > 0);
  if (practised.length > 0) {
    const weakest = [...practised].sort((a, b) => a.p - b.p)[0]!;
    if (weakest.band !== "mastered") {
      return {
        kind: "concept",
        label: weakest.conceptLabel,
        reason: "This is the topic your answers suggest is least settled so far.",
      };
    }
  }
  void now;
  return {
    kind: "mission",
    label: "Continue your journey",
    reason: "You are on track. Carry on with the next mission.",
  };
}

export async function loadLearnerProgress(
  userId: string,
  orgId: string,
  config: Config,
  deps: { db?: Db; now?: Date } = {},
): Promise<LearnerProgress> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [masteryRows, evidenceRows, streakRow, badgeRows, weekRow] = await Promise.all([
    db
      .select({
        conceptId: masteryStates.conceptId,
        conceptKey: concepts.key,
        conceptLabel: concepts.name,
        p: masteryStates.p,
        band: masteryStates.band,
        lower: masteryStates.lower,
        upper: masteryStates.upper,
        nEvents: masteryStates.nEvents,
        lastEvidenceAt: masteryStates.lastEvidenceAt,
      })
      .from(masteryStates)
      .innerJoin(concepts, eq(concepts.id, masteryStates.conceptId))
      .where(and(eq(masteryStates.userId, userId), eq(masteryStates.orgId, orgId))),

    db
      .select({
        id: evidenceEvents.id,
        conceptLabel: concepts.name,
        verdict: evidenceEvents.verdict,
        signal: evidenceEvents.signal,
        score: evidenceEvents.score,
        hintLevel: evidenceEvents.hintLevel,
        selfCorrected: evidenceEvents.selfCorrected,
        pBefore: evidenceEvents.pBefore,
        pAfter: evidenceEvents.pAfter,
        at: evidenceEvents.createdAt,
      })
      .from(evidenceEvents)
      .innerJoin(concepts, eq(concepts.id, evidenceEvents.conceptId))
      .where(and(eq(evidenceEvents.userId, userId), eq(evidenceEvents.orgId, orgId)))
      .orderBy(desc(evidenceEvents.createdAt))
      .limit(50),

    db
      .select({
        currentDays: streaks.currentDays,
        longestDays: streaks.longestDays,
        freezesLeft: streaks.freezesLeft,
      })
      .from(streaks)
      .where(eq(streaks.userId, userId))
      .limit(1),

    db
      .select({
        code: badges.code,
        name: badges.name,
        description: badges.description,
        awardedAt: userBadges.awardedAt,
      })
      .from(userBadges)
      .innerJoin(badges, eq(badges.id, userBadges.badgeId))
      .where(eq(userBadges.userId, userId)),

    db
      .select({ ms: sql<string>`COALESCE(sum(${evidenceEvents.latencyMs}), 0)` })
      .from(evidenceEvents)
      .where(
        and(
          eq(evidenceEvents.userId, userId),
          eq(evidenceEvents.orgId, orgId),
          gte(evidenceEvents.createdAt, weekAgo),
        ),
      ),
  ]);

  const totalXp = await getUserTotalXp(userId, db);
  const levels = config.gamification.levels;
  const levelInfo = calculateLevel(totalXp, levels);

  const conceptList: ConceptProgress[] = masteryRows.map((r) => ({
    conceptId: r.conceptId,
    conceptKey: r.conceptKey,
    conceptLabel: r.conceptLabel,
    p: r.p,
    band: r.band,
    lower: r.lower,
    upper: r.upper,
    nEvents: r.nEvents,
    lastEvidenceAt: r.lastEvidenceAt,
  }));

  return {
    concepts: conceptList,
    evidence: evidenceRows.map((e) => ({
      id: e.id,
      conceptLabel: e.conceptLabel,
      verdict: e.verdict,
      signal: e.signal,
      score: e.score,
      hintLevel: e.hintLevel,
      selfCorrected: e.selfCorrected,
      at: e.at,
      why: whyLine(e),
    })),
    xp: {
      total: totalXp,
      level: levelInfo.level,
      nextLevelXp: levelInfo.nextLevelXp,
      progress: levelInfo.progress,
    },
    streak: {
      currentDays: streakRow[0]?.currentDays ?? 0,
      longestDays: streakRow[0]?.longestDays ?? 0,
      freezesLeft: streakRow[0]?.freezesLeft ?? 0,
    },
    badges: badgeRows,
    // Answer latency is the only time we record, so this is time on task, not wall clock.
    minutesThisWeek: Math.round(Number(weekRow[0]?.ms ?? 0) / 60_000),
    nextRecommendation: nextRecommendation(conceptList, now),
  };
}
