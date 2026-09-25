import { and, asc, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { evidenceEvents, masteryStates } from "../db/schema";
import { getSignalGuess } from "./evidence";
import {
  bandOf,
  emptyMastery,
  replayMastery,
  type MasteryEvent,
  type MasteryParams,
  type MasteryState,
} from "./mastery";

export interface MasteryKey {
  userId: string;
  conceptId: string;
  orgId: string;
}

/** The stored state for one learner and concept, or the persona prior when none exists yet. */
export async function loadMastery(
  key: Pick<MasteryKey, "userId" | "conceptId">,
  params: MasteryParams,
  db: Db = defaultDb,
): Promise<MasteryState> {
  const [row] = await db
    .select()
    .from(masteryStates)
    .where(and(eq(masteryStates.userId, key.userId), eq(masteryStates.conceptId, key.conceptId)))
    .limit(1);
  if (!row) return emptyMastery(params.p0, params);
  const base = {
    p: row.p,
    nEvents: row.nEvents,
    nEff: row.nEff,
    signalTypes: row.signalTypes,
    lastEvidenceAt: row.lastEvidenceAt,
  };
  return { ...base, ...bandOf(base, params) };
}

/** The upsert statement for a state (caller batches it with the turn's other writes). */
export function upsertMastery(
  key: MasteryKey,
  state: MasteryState,
  configVersion: number,
  db: Db = defaultDb,
) {
  const values = {
    userId: key.userId,
    conceptId: key.conceptId,
    orgId: key.orgId,
    p: state.p,
    nEvents: state.nEvents,
    nEff: state.nEff,
    signalTypes: state.signalTypes,
    band: state.band,
    lower: state.lower,
    upper: state.upper,
    lastEvidenceAt: state.lastEvidenceAt,
    configVersion,
  };
  return db
    .insert(masteryStates)
    .values(values)
    .onConflictDoUpdate({
      target: [masteryStates.userId, masteryStates.conceptId],
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * Replay the evidence log for one concept (extractor corrections,
 * deletions and parameter changes recompute mastery from the log) and store the result.
 */
export async function replayConcept(
  key: MasteryKey,
  params: MasteryParams,
  configVersion: number,
  db: Db = defaultDb,
): Promise<MasteryState> {
  const rows = await db
    .select({
      credit: evidenceEvents.credit,
      weight: evidenceEvents.weight,
      guess: evidenceEvents.guess,
      signal: evidenceEvents.signal,
      pBefore: evidenceEvents.pBefore,
      createdAt: evidenceEvents.createdAt,
    })
    .from(evidenceEvents)
    .where(
      and(
        eq(evidenceEvents.userId, key.userId),
        eq(evidenceEvents.conceptId, key.conceptId),
        isNull(evidenceEvents.supersededBy),
      ),
    )
    .orderBy(asc(evidenceEvents.createdAt));
  const events: MasteryEvent[] = rows.map((r) => ({
    credit: r.credit,
    weight: r.weight,
    // Rows written before the guess column existed fall back to the signal default.
    guess: r.guess ?? getSignalGuess(r.signal),
    signal: r.signal,
    at: r.createdAt,
  }));
  // The chain started from the persona prior of the first event; a live persona switch must
  // not rewrite history, so the replay seeds from that row rather than the current persona.
  const p0 = rows[0]?.pBefore ?? params.p0;
  const state = replayMastery(events, { ...params, p0 });
  await upsertMastery(key, state, configVersion, db);
  return state;
}
