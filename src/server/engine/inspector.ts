import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import {
  adaptationEvents,
  concepts,
  configAudit,
  evidenceEvents,
  learningSessions,
  llmCalls,
  masteryStates,
  turns,
} from "../db/schema";
import { errors } from "../http/errors";
import { getOrgConfig } from "../config/service";
import { summarize, type PatchOp } from "../config/json-patch";

// What the Engine Inspector shows for one session. Everything is scoped to the
// session's own org and learner; the model identifier is withheld unless ui.showModelIdentifiers.

export interface InspectorEvidence {
  id: string;
  at: string;
  conceptKey: string;
  signal: string;
  verdict: string;
  score: number;
  credit: number;
  weight: number;
  hintLevel: number;
  selfCorrected: boolean;
  misconceptionId: string | null;
  pBefore: number;
  pAfter: number;
  source: string;
}

export interface InspectorMastery {
  conceptKey: string;
  conceptName: string;
  p: number;
  lower: number;
  upper: number;
  band: string;
  nEvents: number;
  nEff: number;
  signalTypes: string[];
}

export interface InspectorRule {
  id: string;
  at: string;
  ruleId: string;
  moveType: string;
  modifiers: string[];
  reason: string;
  source: string;
}

export interface InspectorTimings {
  /** Per turn, newest first. firstAudioMs stays null until voice lands. */
  turns: {
    at: string;
    ttftMs: number | null;
    latencyMs: number | null;
    firstAudioMs: number | null;
    moveType: string | null;
  }[];
  /** Model work for this session; tier only unless model identifiers are on. */
  calls: {
    at: string;
    task: string;
    tier: string;
    model: string | null;
    ttftMs: number | null;
    latencyMs: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
  }[];
  totals: { costUsd: number; cacheShare: number; calls: number };
}

export interface InspectorSnapshot {
  /** The newest row timestamp in this snapshot; the client uses it to mark what is new. */
  cursor: string | null;
  /** Evidence events, newest first. */
  events: InspectorEvidence[];
  mastery: InspectorMastery[];
  rules: InspectorRule[];
  timings: InspectorTimings;
  configVersion: number;
  configHash: string;
  /** What changed in the active config version, for the banner. */
  configSummary: string | null;
  mode: {
    grounding: string;
    assessment: string;
    rulesOnly: boolean;
    showModelIdentifiers: boolean;
  };
}

const MAX_ROWS = 50;
const iso = (d: Date | null) => (d ?? new Date(0)).toISOString();

/**
 * One read for the Inspector: the newest rows of each feed, capped at MAX_ROWS.
 *
 * Deliberately not incremental. A `since` filter would miss two things a live panel must show:
 * the async extractor updates an evidence row in place after a re-grade (no new row, no new
 * timestamp), and two independent writers (a turn batch and a panel control) can commit out of
 * order, so a shared cursor can step over rows that were still in flight. Fifty small rows cost
 * far less than a feed that quietly disagrees with the Mastery tab. `since` is still accepted and
 * echoed back, so a caller can tell which rows it has seen.
 */
export async function inspectorSnapshot(
  params: { sessionId: string; userId: string; orgId: string; since?: string },
  db: Db = defaultDb,
): Promise<InspectorSnapshot> {
  const [session] = await db
    .select({
      id: learningSessions.id,
      userId: learningSessions.userId,
      orgId: learningSessions.orgId,
      configVersion: learningSessions.configVersion,
      configHash: learningSessions.configHash,
    })
    .from(learningSessions)
    .where(
      and(
        eq(learningSessions.id, params.sessionId),
        eq(learningSessions.userId, params.userId),
        eq(learningSessions.orgId, params.orgId),
      ),
    )
    .limit(1);
  if (!session) throw errors.notFound("Session not found.");

  const { config } = await getOrgConfig(session.orgId, db);
  const showModels = config.ui.showModelIdentifiers;

  const evidenceRows = await db
    .select({
      id: evidenceEvents.id,
      createdAt: evidenceEvents.createdAt,
      conceptKey: concepts.key,
      signal: evidenceEvents.signal,
      verdict: evidenceEvents.verdict,
      score: evidenceEvents.score,
      credit: evidenceEvents.credit,
      weight: evidenceEvents.weight,
      hintLevel: evidenceEvents.hintLevel,
      selfCorrected: evidenceEvents.selfCorrected,
      misconceptionId: evidenceEvents.misconceptionId,
      pBefore: evidenceEvents.pBefore,
      pAfter: evidenceEvents.pAfter,
      source: evidenceEvents.source,
    })
    .from(evidenceEvents)
    .innerJoin(concepts, eq(concepts.id, evidenceEvents.conceptId))
    .where(eq(evidenceEvents.sessionId, session.id))
    .orderBy(desc(evidenceEvents.createdAt))
    .limit(MAX_ROWS);

  const ruleRows = await db
    .select({
      id: adaptationEvents.id,
      createdAt: adaptationEvents.createdAt,
      ruleId: adaptationEvents.ruleId,
      moveType: adaptationEvents.moveType,
      modifiers: adaptationEvents.modifiers,
      reason: adaptationEvents.reason,
      source: adaptationEvents.source,
    })
    .from(adaptationEvents)
    .where(eq(adaptationEvents.sessionId, session.id))
    .orderBy(desc(adaptationEvents.createdAt))
    .limit(MAX_ROWS);

  // Mastery for the concepts this session has evidence on: small, so it is always sent whole.
  const masteryRows = await db
    .select({
      conceptKey: concepts.key,
      conceptName: concepts.name,
      p: masteryStates.p,
      lower: masteryStates.lower,
      upper: masteryStates.upper,
      band: masteryStates.band,
      nEvents: masteryStates.nEvents,
      nEff: masteryStates.nEff,
      signalTypes: masteryStates.signalTypes,
    })
    .from(masteryStates)
    .innerJoin(concepts, eq(concepts.id, masteryStates.conceptId))
    .where(
      and(
        eq(masteryStates.userId, session.userId),
        eq(masteryStates.orgId, session.orgId),
        sql`${masteryStates.conceptId} in (select distinct concept_id from evidence_events where session_id = ${session.id})`,
      ),
    )
    .orderBy(asc(concepts.key));

  const turnRows = await db
    .select({
      createdAt: turns.createdAt,
      timings: turns.timings,
      moveType: turns.moveType,
      role: turns.role,
    })
    .from(turns)
    .where(eq(turns.sessionId, session.id))
    .orderBy(desc(turns.ordinal))
    .limit(MAX_ROWS);

  const callRows = await db
    .select({
      createdAt: llmCalls.createdAt,
      task: llmCalls.task,
      tier: llmCalls.tier,
      model: llmCalls.model,
      ttftMs: llmCalls.ttftMs,
      latencyMs: llmCalls.latencyMs,
      inputTokens: llmCalls.inputTokens,
      outputTokens: llmCalls.outputTokens,
      cacheReadTokens: llmCalls.cacheReadTokens,
      costUsd: llmCalls.costUsd,
    })
    .from(llmCalls)
    .where(eq(llmCalls.sessionId, session.id))
    .orderBy(desc(llmCalls.createdAt))
    .limit(MAX_ROWS);

  // One line for the config banner: what the active version changed.
  const [audit] = await db
    .select({ reason: configAudit.reason, diff: configAudit.diff })
    .from(configAudit)
    .where(
      and(
        eq(configAudit.orgId, session.orgId),
        eq(configAudit.entity, "config"),
        eq(configAudit.toVersion, session.configVersion),
      ),
    )
    .orderBy(desc(configAudit.createdAt))
    .limit(1);
  const configSummary = audit
    ? (audit.reason ?? (audit.diff ? summarize(audit.diff as PatchOp[]) : null))
    : null;

  const totalInput = callRows.reduce((a, c) => a + c.inputTokens + c.cacheReadTokens, 0);
  const totalCacheRead = callRows.reduce((a, c) => a + c.cacheReadTokens, 0);
  const newest = [evidenceRows[0]?.createdAt, ruleRows[0]?.createdAt]
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    cursor: newest ? newest.toISOString() : (params.since ?? null),
    events: evidenceRows.map((r) => ({
      id: r.id,
      at: iso(r.createdAt),
      conceptKey: r.conceptKey,
      signal: r.signal,
      verdict: r.verdict,
      score: r.score,
      credit: r.credit,
      weight: r.weight,
      hintLevel: r.hintLevel,
      selfCorrected: r.selfCorrected,
      misconceptionId: r.misconceptionId,
      pBefore: r.pBefore,
      pAfter: r.pAfter,
      source: r.source,
    })),
    mastery: masteryRows,
    rules: ruleRows.map((r) => ({
      id: r.id,
      at: iso(r.createdAt),
      ruleId: r.ruleId,
      moveType: r.moveType,
      modifiers: r.modifiers,
      reason: r.reason,
      source: r.source,
    })),
    timings: {
      turns: turnRows
        .filter((t) => t.role === "tutor")
        .map((t) => ({
          at: iso(t.createdAt),
          ttftMs: t.timings?.ttftMs ?? null,
          latencyMs: t.timings?.latencyMs ?? null,
          firstAudioMs: t.timings?.firstAudioMs ?? null,
          moveType: t.moveType,
        })),
      calls: callRows.map((c) => ({
        at: iso(c.createdAt),
        task: c.task,
        tier: c.tier,
        // UI shows tiers, never model ids, unless the org turned identifiers on.
        model: showModels ? c.model : null,
        ttftMs: c.ttftMs,
        latencyMs: c.latencyMs,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        cacheReadTokens: c.cacheReadTokens,
        costUsd: Number(c.costUsd),
      })),
      totals: {
        costUsd: Math.round(callRows.reduce((a, c) => a + Number(c.costUsd), 0) * 1e6) / 1e6,
        cacheShare: totalInput > 0 ? Math.round((totalCacheRead / totalInput) * 100) / 100 : 0,
        calls: callRows.length,
      },
    },
    configVersion: session.configVersion,
    configHash: session.configHash,
    configSummary,
    mode: {
      grounding: config.grounding.strictness,
      assessment: config.engine.assessmentMode,
      rulesOnly: config.engine.rulesOnly,
      showModelIdentifiers: showModels,
    },
  };
}
