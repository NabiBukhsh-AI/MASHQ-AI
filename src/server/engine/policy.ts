import type { MissionPack, Question } from "@/lib/schemas/design";
import type { Config, Persona } from "../config/schema";
import { variantFor } from "./difficulty";
import type { EngagementState } from "./engagement";
import type { Band } from "./mastery";
import type { Move } from "./moves";
import { decide, type PolicySnapshot, type Verdict } from "./rules";

export type { Move } from "./moves";
export type { Verdict } from "./rules";

// Policy entry points for a turn. The rule table lives in rules.ts;
// this file turns the session state into a snapshot and keeps the state transitions.

export interface TurnState {
  questionIndex: number;
  attempts: Record<string, number>;
  hintLevel: Record<string, number>;
  workedShown: Record<string, boolean>;
  completed: string[];
  started: boolean;
  finished: boolean;
  /** Engagement state; absent on older sessions. */
  engagement?: EngagementState;
}

export const EMPTY_STATE: TurnState = {
  questionIndex: 0,
  attempts: {},
  hintLevel: {},
  workedShown: {},
  completed: [],
  started: false,
  finished: false,
};

export function currentQuestion(pack: MissionPack, state: TurnState): Question | null {
  return pack.questions[state.questionIndex] ?? null;
}

/** Everything a rule may read beyond the mission state; every field has a neutral default. */
export interface DecideContext {
  cues?: {
    helpRequest?: boolean;
    idk?: boolean;
    outOfSource?: boolean;
    inSourceQuestion?: boolean;
    explicitSwitch?: PolicySnapshot["cues"]["explicitSwitch"];
  };
  misconceptionId?: string | null;
  engagement?: Partial<PolicySnapshot["engagement"]>;
  mastery?: { band: Band; p: number } | null;
  latencyMs?: number | null;
  persona?: Pick<Persona, "id" | "level" | "turnLength" | "latencyBaselineMs" | "startDifficulty">;
  /** Mastery band and P if this turn's answer turns out correct (for R11 in the correct slot). */
  masteryIfCorrect?: { band: Band; p: number } | null;
  variant?: PolicySnapshot["variant"];
  callback?: Partial<PolicySnapshot["callback"]>;
  languageDrift?: PolicySnapshot["languageDrift"];
  mechanic?: Partial<PolicySnapshot["mechanic"]>;
  limits?: Partial<PolicySnapshot["limits"]>;
  session?: Partial<PolicySnapshot["session"]>;
}

const DEFAULT_PERSONA: NonNullable<DecideContext["persona"]> = {
  id: "branch_new_joiner",
  level: "novice",
  turnLength: "short",
  latencyBaselineMs: 14_000,
  startDifficulty: 1,
};

export type VerdictSlot = Verdict | "out_of_source";

/**
 * The context for one verdict slot. The R04 cues (learner asked a question) only apply where
 * the input was not an answer; a question-shaped correct answer is still a correct answer.
 * The correct slot judges R11 on the mastery the answer would produce.
 */
export function slotContext(ctx: DecideContext, slot: VerdictSlot): DecideContext {
  const cues = ctx.cues ?? {};
  if (slot === "out_of_source")
    return { ...ctx, cues: { ...cues, outOfSource: true, inSourceQuestion: false } };
  if (slot === "not_an_answer")
    return { ...ctx, cues: { ...cues, helpRequest: true, outOfSource: false } };
  const answerCues = { ...cues, outOfSource: false, inSourceQuestion: false, explicitSwitch: null };
  if (slot === "correct")
    return {
      ...ctx,
      cues: answerCues,
      mastery: ctx.masteryIfCorrect === undefined ? ctx.mastery : ctx.masteryIfCorrect,
    };
  return { ...ctx, cues: answerCues };
}

export function buildSnapshot(
  pack: MissionPack,
  state: TurnState,
  q: Question,
  verdict: Verdict | null,
  ctx: DecideContext = {},
): PolicySnapshot {
  const nextQ = pack.questions[state.questionIndex + 1] ?? null;
  const persona = ctx.persona ?? DEFAULT_PERSONA;
  const remaining = pack.questions.length - (state.questionIndex + 1);
  return {
    question: {
      id: q.id,
      conceptKey: q.conceptKey,
      kind: q.kind,
      hints: q.hints,
      workedExample: q.workedExample,
    },
    verdict,
    attempts: state.attempts[q.id] ?? 0,
    hintLevel: state.hintLevel[q.id] ?? 0,
    workedShown: Boolean(state.workedShown[q.id]),
    misconceptionId: ctx.misconceptionId ?? null,
    cues: {
      helpRequest: Boolean(ctx.cues?.helpRequest),
      idk: Boolean(ctx.cues?.idk),
      outOfSource: Boolean(ctx.cues?.outOfSource),
      inSourceQuestion: Boolean(ctx.cues?.inSourceQuestion),
      explicitSwitch: ctx.cues?.explicitSwitch ?? null,
    },
    progress: {
      questionIndex: state.questionIndex,
      total: pack.questions.length,
      // Until per-objective bands are tracked, "objectives met" is the last question answered.
      objectivesMet: remaining <= 0,
      nextQuestion: nextQ ? { id: nextQ.id, prompt: nextQ.prompt } : null,
    },
    engagement: {
      frustrated: Boolean(ctx.engagement?.frustrated),
      frustratedBy:
        ctx.engagement?.frustratedBy ?? (ctx.engagement?.frustrated ? "threshold" : null),
      fatigued: Boolean(ctx.engagement?.fatigued),
      pace: ctx.engagement?.pace ?? "normal",
    },
    mastery: ctx.mastery ?? null,
    latencyMs: ctx.latencyMs ?? null,
    personaMedianMs: persona.latencyBaselineMs,
    persona: { id: persona.id, level: persona.level, turnLength: persona.turnLength },
    variant: ctx.variant ?? variantFor(persona.startDifficulty),
    callback: {
      due: Boolean(ctx.callback?.due),
      atBeatBoundary: Boolean(ctx.callback?.atBeatBoundary),
    },
    languageDrift: ctx.languageDrift ?? null,
    mechanic: {
      current: ctx.mechanic?.current ?? null,
      repeats: ctx.mechanic?.repeats ?? 0,
      better: ctx.mechanic?.better ?? null,
      easier: ctx.mechanic?.easier ?? null,
    },
    limits: {
      spendCapReached: Boolean(ctx.limits?.spendCapReached),
      tokenBudgetExhausted: Boolean(ctx.limits?.tokenBudgetExhausted),
    },
    session: {
      microSession: Boolean(ctx.session?.microSession),
      secondsLeft: ctx.session?.secondsLeft ?? null,
    },
  };
}

/** The move for a verdict on the current question; first match wins. */
export function decideMove(
  pack: MissionPack,
  state: TurnState,
  q: Question,
  verdict: Verdict,
  config: Config,
  ctx: DecideContext = {},
): Move {
  return decide(buildSnapshot(pack, state, q, verdict, ctx), config);
}

/** Moves offered to the model for inline assessment: one per possible verdict plus out of source. */
export function decideByVerdict(
  pack: MissionPack,
  state: TurnState,
  q: Question,
  config: Config,
  ctx: DecideContext = {},
): Record<VerdictSlot, Move> {
  const slot = (v: Verdict, name: VerdictSlot) =>
    decideMove(pack, state, q, v, config, slotContext(ctx, name));
  return {
    correct: slot("correct", "correct"),
    partial: slot("partial", "partial"),
    incorrect: slot("incorrect", "incorrect"),
    not_an_answer: slot("not_an_answer", "not_an_answer"),
    out_of_source: slot("not_an_answer", "out_of_source"),
  };
}

/** The adaptation_events row for a decision; the caller inserts it. */
export function logAdaptation(
  move: Move,
  snapshot: PolicySnapshot,
  ids: { orgId: string; sessionId: string; turnId: string | null; configVersion: number },
) {
  return {
    orgId: ids.orgId,
    sessionId: ids.sessionId,
    turnId: ids.turnId,
    ruleId: move.ruleId,
    moveType: move.type,
    modifiers: (move.modifiers ?? []).map(
      (m) => `${m.kind}${m.value === undefined ? "" : `=${String(m.value)}`}`,
    ),
    params: move.params,
    reason: move.reason,
    inputs: snapshot as unknown as Record<string, unknown>,
    configVersion: ids.configVersion,
    source: "policy" as const,
  };
}

/** Opening move: the intro beat and the first question. */
export function openingMove(pack: MissionPack, q: Question): Move {
  const intro =
    pack.beats.find((b) => b.kind === "intro" || b.kind === "scenario") ?? pack.beats[0];
  return {
    id: "mv_open",
    type: "present_question",
    ruleId: "R99",
    reason: `Mission start. Rule R99: play the opening beat and present ${q.id}.`,
    params: {
      question: q.id,
      concept: q.conceptKey,
      beat: intro?.id,
      beatText: intro?.text,
      speaker: intro?.speaker,
      prompt: q.prompt,
      variant: "standard",
    },
  };
}

/** Apply a verdict to the state; returns the new state (never mutates). */
export function advance(
  state: TurnState,
  pack: MissionPack,
  q: Question,
  move: Move,
  verdict: Verdict | null,
): TurnState {
  const next: TurnState = {
    ...state,
    attempts: { ...state.attempts },
    hintLevel: { ...state.hintLevel },
    workedShown: { ...state.workedShown },
    completed: [...state.completed],
    started: true,
  };
  if (move.type === "worked_example") next.workedShown[q.id] = true;
  if (typeof move.params.hintLevel === "number") next.hintLevel[q.id] = move.params.hintLevel;
  if (verdict === "incorrect" || verdict === "partial")
    next.attempts[q.id] = (state.attempts[q.id] ?? 0) + 1;
  if (verdict === "correct") {
    if (!next.completed.includes(q.id)) next.completed.push(q.id);
    if (state.questionIndex + 1 < pack.questions.length)
      next.questionIndex = state.questionIndex + 1;
    else next.finished = true;
  }
  return next;
}

/** What the screen shows for a question: options or puzzle items, never the answer key. */
export function uiPayload(q: Question | null) {
  if (!q) return null;
  if (
    q.kind === "choice" ||
    q.kind === "free_text" ||
    q.kind === "explanation" ||
    q.kind === "teach_back"
  ) {
    return {
      kind: q.kind,
      questionId: q.id,
      prompt: q.prompt,
      options: q.options?.map((o) => ({ id: o.id, label: o.label })) ?? null,
    };
  }
  if (q.kind === "sequence") {
    const correct = q.sequence?.correctOrder ?? [];
    // Canonical order (by label), so the wire carries no trace of the pack order; a public
    // seeded shuffle would be invertible. If that happens to be the answer, rotate once.
    let steps = byLabel(q.sequence?.steps ?? []);
    if (steps.every((st, i) => st.id === correct[i]) && steps.length > 1)
      steps = [...steps.slice(1), steps[0]!];
    return { kind: q.kind, questionId: q.id, prompt: q.prompt, steps };
  }
  if (q.kind === "match") {
    // Sides go separately, each in label order, so the payload carries no pairing.
    const pairs = q.pairs ?? [];
    return {
      kind: q.kind,
      questionId: q.id,
      prompt: q.prompt,
      lefts: byLabel(pairs.map((p) => p.left)),
      rights: byLabel(pairs.map((p) => p.right)),
    };
  }
  if (q.kind === "spot_error") {
    return {
      kind: q.kind,
      questionId: q.id,
      prompt: q.prompt,
      sentences: q.passage?.sentences ?? [],
    };
  }
  return { kind: q.kind, questionId: q.id, prompt: q.prompt };
}

type Labelled = { label: { en: string } } | { en: string };
const labelOf = (x: Labelled) => ("label" in x ? x.label.en : x.en);

/** Items in English label order: stable on reload and independent of the pack order. */
export function byLabel<T extends Labelled>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => labelOf(a).localeCompare(labelOf(b), "en"));
}
