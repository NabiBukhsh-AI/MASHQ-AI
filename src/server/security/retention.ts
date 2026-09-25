import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import {
  adaptationEvents,
  dataDeletions,
  evidenceEvents,
  learningSessions,
  llmCalls,
  masteryStates,
  mediaUsage,
  streaks,
  turns,
  userBadges,
  xpLedger,
} from "../db/schema";
import { log } from "../obs/logger";
import type { Config } from "../config/schema";

/**
 * Retention purge and self service deletion.
 *
 * The purge is bounded by age only, never by "everything older than the newest row", so an org
 * that has been quiet for a month does not lose its history the first time the cron runs after
 * someone uses it again.
 */

export interface PurgeCounts {
  turns: number;
  evidence: number;
  llmCalls: number;
  mediaUsage: number;
}

function cutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * Deletes rows past their retention window. Each table has its own window, because turn text
 * is the sensitive part and the aggregate signals are not.
 */
export async function purgeExpired(
  config: Config,
  deps: { db?: Db; now?: Date } = {},
): Promise<PurgeCounts> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const days = config.privacy.retentionDays;

  // Turn text first: it is the row that actually carries learner words.
  const turnsResult = await db
    .delete(turns)
    .where(lt(turns.createdAt, cutoff(days.turns, now)))
    .returning({ id: turns.id });

  const evidenceResult = await db
    .delete(evidenceEvents)
    .where(lt(evidenceEvents.createdAt, cutoff(days.evidence, now)))
    .returning({ id: evidenceEvents.id });

  const llmResult = await db
    .delete(llmCalls)
    .where(lt(llmCalls.createdAt, cutoff(days.llmCalls, now)))
    .returning({ id: llmCalls.id });

  const mediaResult = await db
    .delete(mediaUsage)
    .where(lt(mediaUsage.createdAt, cutoff(days.llmCalls, now)))
    .returning({ id: mediaUsage.id });

  const counts: PurgeCounts = {
    turns: turnsResult.length,
    evidence: evidenceResult.length,
    llmCalls: llmResult.length,
    mediaUsage: mediaResult.length,
  };

  log.info({ event: "retention_purge", ...counts, retentionDays: days });
  return counts;
}

export interface LearnerExport {
  exportedAt: string;
  pseudonym: string;
  sessions: unknown[];
  turns: unknown[];
  evidence: unknown[];
  mastery: unknown[];
  xp: unknown[];
  badges: unknown[];
}

/**
 * Everything held about one learner, as JSON. Names and emails are not included: the account
 * holder already knows their own, and the export is a file that can be forwarded.
 */
export async function exportLearnerData(
  userId: string,
  orgId: string,
  pseudonym: string,
  deps: { db?: Db; now?: Date } = {},
): Promise<LearnerExport> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();

  const sessions = await db
    .select()
    .from(learningSessions)
    .where(and(eq(learningSessions.userId, userId), eq(learningSessions.orgId, orgId)));
  const sessionIds = sessions.map((s) => s.id);

  const [turnRows, evidenceRows, masteryRows, xpRows, badgeRows] = await Promise.all([
    sessionIds.length
      ? db.select().from(turns).where(inArray(turns.sessionId, sessionIds))
      : Promise.resolve([]),
    db
      .select()
      .from(evidenceEvents)
      .where(and(eq(evidenceEvents.userId, userId), eq(evidenceEvents.orgId, orgId))),
    db.select().from(masteryStates).where(eq(masteryStates.userId, userId)),
    db.select().from(xpLedger).where(eq(xpLedger.userId, userId)),
    db.select().from(userBadges).where(eq(userBadges.userId, userId)),
  ]);

  return {
    exportedAt: now.toISOString(),
    pseudonym,
    sessions,
    turns: turnRows,
    evidence: evidenceRows,
    mastery: masteryRows,
    xp: xpRows,
    badges: badgeRows,
  };
}

export interface DeletionCounts {
  sessions: number;
  turns: number;
  evidence: number;
  adaptation: number;
  mastery: number;
  xp: number;
  badges: number;
  streaks: number;
}

/**
 * Removes everything linked to one learner, in one batch so a partial deletion cannot be left
 * behind, and records that it happened against the pseudonym rather than the person.
 */
export async function deleteLearnerData(
  userId: string,
  orgId: string,
  pseudonym: string,
  deps: { db?: Db } = {},
): Promise<DeletionCounts> {
  const db = deps.db ?? defaultDb;

  const sessions = await db
    .select({ id: learningSessions.id })
    .from(learningSessions)
    .where(and(eq(learningSessions.userId, userId), eq(learningSessions.orgId, orgId)));
  const sessionIds = sessions.map((s) => s.id);

  const counts: DeletionCounts = {
    sessions: sessionIds.length,
    turns: 0,
    evidence: 0,
    adaptation: 0,
    mastery: 0,
    xp: 0,
    badges: 0,
    streaks: 0,
  };

  const statements = [];
  if (sessionIds.length > 0) {
    statements.push(db.delete(turns).where(inArray(turns.sessionId, sessionIds)));
    statements.push(
      db.delete(adaptationEvents).where(inArray(adaptationEvents.sessionId, sessionIds)),
    );
    statements.push(db.delete(mediaUsage).where(inArray(mediaUsage.sessionId, sessionIds)));
  }
  statements.push(db.delete(evidenceEvents).where(eq(evidenceEvents.userId, userId)));
  statements.push(db.delete(masteryStates).where(eq(masteryStates.userId, userId)));
  statements.push(db.delete(xpLedger).where(eq(xpLedger.userId, userId)));
  statements.push(db.delete(userBadges).where(eq(userBadges.userId, userId)));
  statements.push(db.delete(streaks).where(eq(streaks.userId, userId)));
  if (sessionIds.length > 0) {
    statements.push(db.delete(learningSessions).where(inArray(learningSessions.id, sessionIds)));
  }
  // The record of the deletion is written in the same batch, so it cannot be lost if the
  // process dies between the delete and the log.
  statements.push(
    db.insert(dataDeletions).values({
      orgId,
      pseudonym,
      completedAt: new Date(),
      counts: counts as unknown as Record<string, number>,
    }),
  );

  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

  log.info({ event: "learner_data_deleted", orgId, pseudonym, sessions: counts.sessions });
  return counts;
}

/** Rows that would be purged right now, for the cron response and for tests. */
export async function purgePreview(
  config: Config,
  deps: { db?: Db; now?: Date } = {},
): Promise<Record<string, number>> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const days = config.privacy.retentionDays;
  const [row] = (
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM turns WHERE created_at < ${cutoff(days.turns, now).toISOString()})::int AS turns,
        (SELECT count(*) FROM evidence_events WHERE created_at < ${cutoff(days.evidence, now).toISOString()})::int AS evidence,
        (SELECT count(*) FROM llm_calls WHERE created_at < ${cutoff(days.llmCalls, now).toISOString()})::int AS llm_calls
    `)
  ).rows as Array<Record<string, unknown>>;
  return {
    turns: Number(row?.turns ?? 0),
    evidence: Number(row?.evidence ?? 0),
    llmCalls: Number(row?.llm_calls ?? 0),
  };
}
