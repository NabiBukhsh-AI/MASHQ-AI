import { and, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "@/lib/ids";
import { db as defaultDb, type Db } from "./client";
import {
  adaptationEvents,
  concepts,
  evidenceEvents,
  journeys,
  learningSessions,
  masteryStates,
  missions,
  streaks,
  turns,
  user,
  xpLedger,
} from "./schema";
import { applyEvent, emptyMastery, masteryParams, type MasteryEvent } from "../engine/mastery";
import { buildEvidence } from "../engine/evidence";
import { DEFAULT_XP_MAP } from "../engine/xp";
import type { Config } from "../config/schema";
import { ensureSeedJourneys } from "./import-journey-fixture";

/**
 * Demo data for the dashboards.
 *
 * Every row is produced by running the same evidence and mastery functions the live engine
 * uses, over scripted answer patterns. Nothing is invented: if the dashboards show a learner
 * at 0.82 on a concept, that number came out of the real BKT update. No LLM is called, so
 * seeding is fast, free and repeatable.
 *
 * Every row carries is_seeded = true so the reset can remove it without touching real work.
 */

export const DEPARTMENTS = ["Branch Operations", "Customer Care", "Compliance", "Digital"] as const;
export const COHORTS = ["New joiners 2026", "Branch leads", "Refresher"] as const;
export const PERSONAS = ["branch_new_joiner", "ops_officer", "senior_manager"] as const;
export const LANGUAGES = ["en", "ur", "ur-Latn", "mixed"] as const;

export const DEMO_LEARNER_COUNT = 40;
export const DEMO_DAYS = 14;

/** Deterministic pseudo-random so a reseed produces the same dashboards. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

export interface DemoLearner {
  id: string;
  name: string;
  email: string;
  department: string;
  cohort: string;
  persona: string;
  language: string;
  /** How well this learner does, which drives the scripted answer pattern. */
  ability: number;
}

/** Forty learners spread across departments, cohorts, personas and languages. */
export function buildDemoLearners(count = DEMO_LEARNER_COUNT): DemoLearner[] {
  const rand = makeRandom(20260920);
  const learners: DemoLearner[] = [];
  for (let i = 0; i < count; i++) {
    const n = i + 1;
    learners.push({
      id: `demo-learner-${String(n).padStart(3, "0")}`,
      name: `Demo Learner ${n}`,
      email: `demo.learner.${String(n).padStart(3, "0")}@example.invalid`,
      department: DEPARTMENTS[i % DEPARTMENTS.length]!,
      cohort: COHORTS[i % COHORTS.length]!,
      persona: PERSONAS[i % PERSONAS.length]!,
      language: LANGUAGES[i % LANGUAGES.length]!,
      // A spread rather than a clump, so the dashboards show a real distribution.
      ability: 0.25 + rand() * 0.7,
    });
  }
  return learners;
}

export type ScriptedVerdict = "correct" | "partial" | "incorrect" | "not_an_answer";

/** One scripted answer. Ability decides the verdict; attempt number decides the hint level. */
export function scriptAnswer(
  ability: number,
  attempt: number,
  rand: () => number,
): { verdict: ScriptedVerdict; score: number; hintLevel: number; selfCorrected: boolean } {
  const roll = rand();
  // A second attempt is easier, because the learner has just had a hint.
  const effective = Math.min(0.95, ability + attempt * 0.2);
  if (roll < effective) {
    return { verdict: "correct", score: 1, hintLevel: attempt, selfCorrected: attempt > 0 };
  }
  if (roll < effective + 0.25) {
    return { verdict: "partial", score: 0.5, hintLevel: attempt, selfCorrected: false };
  }
  if (roll < effective + 0.32) {
    return { verdict: "not_an_answer", score: 0, hintLevel: attempt, selfCorrected: false };
  }
  return { verdict: "incorrect", score: 0, hintLevel: attempt, selfCorrected: false };
}

export interface SimulatedEvent {
  conceptId: string;
  signal: string;
  verdict: ScriptedVerdict;
  score: number;
  hintLevel: number;
  selfCorrected: boolean;
  weight: number;
  credit: number;
  guess: number;
  pBefore: number;
  pAfter: number;
  at: Date;
  latencyMs: number;
}

/**
 * Runs the real evidence and mastery functions over a learner's scripted answers for one
 * concept, returning both the events to insert and the mastery state they produce. The state
 * is therefore always a faithful replay of the events, which the mastery replay relies on.
 */
export function simulateConcept(input: {
  conceptId: string;
  ability: number;
  attempts: number;
  startAt: Date;
  rand: () => number;
  config: Config;
  /** Persona prior. Novice 0.15, intermediate 0.25, expert 0.35. */
  p0?: number;
}): { events: SimulatedEvent[]; mastery: ReturnType<typeof emptyMastery> } {
  const params = masteryParams(input.config, input.p0 ?? 0.25);
  let state = emptyMastery(params.p0, params);
  const events: SimulatedEvent[] = [];
  const signals = ["mcq", "free_text", "sequence", "teach_back"];

  for (let i = 0; i < input.attempts; i++) {
    const signal = signals[i % signals.length]!;
    const scripted = scriptAnswer(input.ability, i % 2, input.rand);
    const at = new Date(input.startAt.getTime() + i * 90_000);

    const evidence = buildEvidence(
      {
        verdict: scripted.verdict,
        score: scripted.score,
        self_correction: scripted.selfCorrected,
      } as never,
      {
        signal,
        hintLevel: scripted.hintLevel,
        attempts: (i % 2) + 1,
        numOptions: signal === "mcq" ? 4 : undefined,
        pBefore: state.p,
      } as never,
      input.config,
    );

    const masteryEvent: MasteryEvent = {
      credit: evidence.credit,
      weight: evidence.weight,
      guess: evidence.guess ?? 0.25,
      signal,
      at,
    };
    const pBefore = state.p;
    state = applyEvent(state, masteryEvent, params);

    events.push({
      conceptId: input.conceptId,
      signal,
      verdict: scripted.verdict,
      score: scripted.score,
      hintLevel: scripted.hintLevel,
      selfCorrected: scripted.selfCorrected,
      weight: evidence.weight,
      credit: evidence.credit,
      guess: evidence.guess ?? 0.25,
      pBefore,
      pAfter: state.p,
      at,
      latencyMs: 4000 + Math.floor(input.rand() * 9000),
    });
  }

  return { events, mastery: state };
}

export interface SeedDemoResult {
  learners: number;
  sessions: number;
  evidence: number;
  masteryRows: number;
  xpRows: number;
  days: number;
}

/**
 * Writes the demo dataset. Idempotent: it removes the previous seeded activity first, so
 * running it twice gives the same dashboards rather than doubled numbers.
 */
export async function seedDemoData(
  orgId: string,
  config: Config,
  deps: { db?: Db; now?: Date } = {},
): Promise<SeedDemoResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();

  // A fresh database has no journey, and generating one costs model calls, which seeding
  // must never do. The committed fixtures carry the design work instead.
  await ensureSeedJourneys(orgId, { db });

  const [journey] = await db
    .select({ id: journeys.id, contentId: journeys.contentId })
    .from(journeys)
    .where(and(eq(journeys.orgId, orgId), eq(journeys.status, "ready")))
    .limit(1);
  if (!journey) {
    throw new Error(
      "No ready journey to attach demo sessions to, and no fixtures in eval/fixtures/seed/journeys. Run pnpm pipeline:live then pnpm fixtures:export.",
    );
  }

  const conceptRows = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(eq(concepts.contentId, journey.contentId))
    .limit(8);
  if (conceptRows.length === 0) {
    throw new Error("The ready journey has no concepts, so there is nothing to show mastery for.");
  }

  const [mission] = await db
    .select({ id: missions.id })
    .from(missions)
    .where(eq(missions.journeyId, journey.id))
    .orderBy(missions.ordinal)
    .limit(1);

  await clearDemoData(orgId, { db });

  const learners = buildDemoLearners();
  const rand = makeRandom(97531);

  await db
    .insert(user)
    .values(
      learners.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        emailVerified: true,
        orgId,
        role: "learner" as const,
        department: l.department,
        cohort: l.cohort,
        pseudonym: `Learner ${l.id.slice(-3)}`,
        isSeeded: true,
        createdAt: new Date(now.getTime() - DEMO_DAYS * 86_400_000),
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();

  // Neon HTTP costs a round trip per statement, so rows are collected and inserted in
  // chunks. Row by row this took 350s; the target is two minutes.
  const sessionRows: (typeof learningSessions.$inferInsert)[] = [];
  const turnRows: (typeof turns.$inferInsert)[] = [];
  const evidenceRows: (typeof evidenceEvents.$inferInsert)[] = [];
  const xpRows: (typeof xpLedger.$inferInsert)[] = [];
  const adaptationRows: (typeof adaptationEvents.$inferInsert)[] = [];
  const masteryRows: (typeof masteryStates.$inferInsert)[] = [];
  const streakRows: (typeof streaks.$inferInsert)[] = [];

  let sessionCount = 0;
  let evidenceCount = 0;
  let masteryCount = 0;
  let xpCount = 0;

  for (const learner of learners) {
    // Between three and twelve sessions spread over the fortnight.
    const sessionsForLearner = 3 + Math.floor(rand() * 10);
    const masteryByConcept = new Map<string, ReturnType<typeof emptyMastery>>();
    let xpTotal = 0;

    for (let sIdx = 0; sIdx < sessionsForLearner; sIdx++) {
      const dayOffset = Math.floor(rand() * DEMO_DAYS);
      const startedAt = new Date(
        now.getTime() - dayOffset * 86_400_000 - Math.floor(rand() * 8) * 3_600_000,
      );
      const sessionId = uuidv7();

      sessionRows.push({
        id: sessionId,
        orgId,
        userId: learner.id,
        journeyId: journey.id,
        currentMissionId: mission?.id ?? null,
        personaId: learner.persona,
        language: learner.language,
        modality: rand() > 0.6 ? "voice" : "text",
        presets: [],
        constraints: {},
        configVersion: 1,
        configHash: "demo-seed",
        state: { started: true, finished: rand() > 0.35 },
        tokensUsed: 1200 + Math.floor(rand() * 4000),
        costUsd: (0.01 + rand() * 0.05).toFixed(6),
        status: "ended",
        startedAt,
        isSeeded: true,
      });
      sessionCount += 1;

      const concept = conceptRows[Math.floor(rand() * conceptRows.length)]!;
      const attempts = 2 + Math.floor(rand() * 4);
      const prior = masteryByConcept.get(concept.id);
      const sim = simulateConcept({
        conceptId: concept.id,
        ability: learner.ability,
        attempts,
        startAt: startedAt,
        rand,
        config,
      });

      // Continue from where this learner already was on the concept.
      let state = prior ?? sim.mastery;
      if (prior) {
        const params = masteryParams(config, 0.25);
        state = sim.events.reduce(
          (acc, e) =>
            applyEvent(
              acc,
              { credit: e.credit, weight: e.weight, guess: e.guess, signal: e.signal, at: e.at },
              params,
            ),
          prior,
        );
      }
      masteryByConcept.set(concept.id, state);

      for (const e of sim.events) {
        const turnId = uuidv7();
        turnRows.push({
          id: turnId,
          sessionId,
          orgId,
          ordinal: sim.events.indexOf(e) + 1,
          role: "learner",
          text: "Seeded demo answer.",
          lang: learner.language,
          inputMode: rand() > 0.6 ? "voice" : "text",
          createdAt: e.at,
        });

        evidenceRows.push({
          id: uuidv7(),
          orgId,
          userId: learner.id,
          sessionId,
          turnId,
          conceptId: e.conceptId,
          missionId: mission?.id ?? null,
          questionId: `q_${e.signal}`,
          signal: e.signal,
          verdict: e.verdict,
          score: e.score,
          hintLevel: e.hintLevel,
          latencyMs: e.latencyMs,
          selfCorrected: e.selfCorrected,
          lang: learner.language,
          modality: "text",
          weight: e.weight,
          credit: e.credit,
          guess: e.guess,
          pBefore: e.pBefore,
          pAfter: e.pAfter,
          source: "seed",
          createdAt: e.at,
        });
        evidenceCount += 1;

        const reason =
          e.verdict === "correct"
            ? e.hintLevel > 0
              ? "correct_after_hint"
              : "correct_first_try"
            : e.verdict === "partial"
              ? "partial"
              : null;
        if (reason) {
          const amount = config.gamification.xp[reason] ?? DEFAULT_XP_MAP[reason] ?? 0;
          if (amount > 0) {
            xpTotal += amount;
            xpRows.push({
              id: uuidv7(),
              orgId,
              userId: learner.id,
              sessionId,
              amount,
              reasonCode: reason,
              refId: turnId,
              createdAt: e.at,
            });
            xpCount += 1;
          }
        }
      }

      if (rand() > 0.7) {
        adaptationRows.push({
          id: uuidv7(),
          orgId,
          sessionId,
          ruleId: "R07",
          moveType: "feedback_incorrect",
          reason: "Seeded demo adaptation: first incorrect answer, gentle correction and a hint.",
          source: "policy",
          configVersion: 1,
          createdAt: startedAt,
        });
      }
    }

    for (const [conceptId, state] of masteryByConcept) {
      masteryRows.push({
        userId: learner.id,
        conceptId,
        orgId,
        p: state.p,
        nEvents: state.nEvents,
        nEff: state.nEff,
        signalTypes: state.signalTypes,
        band: state.band,
        lower: state.lower,
        upper: state.upper,
        lastEvidenceAt: state.lastEvidenceAt,
        configVersion: 1,
      });
      masteryCount += 1;
    }

    streakRows.push({
      userId: learner.id,
      currentDays: 1 + Math.floor(rand() * 9),
      longestDays: 3 + Math.floor(rand() * 12),
      lastActiveDate: new Date(now.getTime() - Math.floor(rand() * 3) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      freezesLeft: 1,
    });

    void xpTotal;
  }

  // Chunked so one statement stays well inside Postgres parameter limits.
  const chunk = <T>(rows: T[], size = 200): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
  };

  // Order matters: turns reference sessions, evidence references turns.
  for (const part of chunk(sessionRows)) await db.insert(learningSessions).values(part);
  for (const part of chunk(turnRows)) await db.insert(turns).values(part);
  for (const part of chunk(evidenceRows)) await db.insert(evidenceEvents).values(part);
  for (const part of chunk(xpRows)) await db.insert(xpLedger).values(part);
  for (const part of chunk(adaptationRows)) await db.insert(adaptationEvents).values(part);
  for (const part of chunk(masteryRows))
    await db.insert(masteryStates).values(part).onConflictDoNothing();
  for (const part of chunk(streakRows)) await db.insert(streaks).values(part).onConflictDoNothing();

  return {
    learners: learners.length,
    sessions: sessionCount,
    evidence: evidenceCount,
    masteryRows: masteryCount,
    xpRows: xpCount,
    days: DEMO_DAYS,
  };
}

/**
 * Removes everything the demo seed created for an org, and nothing else. Keyed on
 * is_seeded plus the generated learner ids, so a real learner's work is never touched.
 */
export async function clearDemoData(orgId: string, deps: { db?: Db } = {}): Promise<number> {
  const db = deps.db ?? defaultDb;
  const ids = buildDemoLearners().map((l) => l.id);

  const sessions = await db
    .select({ id: learningSessions.id })
    .from(learningSessions)
    .where(and(eq(learningSessions.orgId, orgId), inArray(learningSessions.userId, ids)));
  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length > 0) {
    await db.delete(evidenceEvents).where(inArray(evidenceEvents.sessionId, sessionIds));
    await db.delete(adaptationEvents).where(inArray(adaptationEvents.sessionId, sessionIds));
    await db.delete(xpLedger).where(inArray(xpLedger.sessionId, sessionIds));
    await db.delete(turns).where(inArray(turns.sessionId, sessionIds));
    await db.delete(learningSessions).where(inArray(learningSessions.id, sessionIds));
  }
  // Scoped by org: the demo learner ids are the same constants in every org, so without
  // this an admin of one org would clear another org's demo rows.
  await db
    .delete(masteryStates)
    .where(and(eq(masteryStates.orgId, orgId), inArray(masteryStates.userId, ids)));
  const orgUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.orgId, orgId), inArray(user.id, ids), eq(user.isSeeded, true)));
  if (orgUsers.length > 0) {
    await db.delete(streaks).where(
      inArray(
        streaks.userId,
        orgUsers.map((u) => u.id),
      ),
    );
  }
  await db
    .delete(user)
    .where(and(eq(user.orgId, orgId), inArray(user.id, ids), eq(user.isSeeded, true)));

  return sessionIds.length;
}

/** Counts of seeded demo rows, for the admin screen and the reset confirmation. */
export async function demoDataSummary(orgId: string, deps: { db?: Db } = {}) {
  const db = deps.db ?? defaultDb;
  const ids = buildDemoLearners().map((l) => l.id);
  const [row] = await db
    .select({
      sessions: sql<string>`count(*)`,
    })
    .from(learningSessions)
    .where(and(eq(learningSessions.orgId, orgId), inArray(learningSessions.userId, ids)));
  return { sessions: Number(row?.sessions ?? 0), learners: ids.length };
}
