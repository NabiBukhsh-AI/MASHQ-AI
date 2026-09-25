import type { Config } from "../config/schema";
import type { Band } from "./mastery";
import type { Move, RuleId } from "./moves";
import { reasons } from "./reasons";

// `decide(snapshot, config)` evaluates ordered rules; the first match wins.
// Everything a rule reads is in the snapshot, so the table is a pure function and the
// adaptation event can store the exact inputs.

export type Verdict = "correct" | "partial" | "incorrect" | "not_an_answer";

export interface PolicySnapshot {
  question: {
    id: string;
    conceptKey: string;
    kind: string;
    hints: string[];
    workedExample: string;
  };
  /** null on the opening turn. */
  verdict: Verdict | null;
  /** Attempts on this question before the current one. */
  attempts: number;
  /** Hint level the learner has already received on this question. */
  hintLevel: number;
  workedShown: boolean;
  misconceptionId: string | null;
  cues: {
    helpRequest: boolean;
    idk: boolean;
    outOfSource: boolean;
    /** The learner asked something the material covers (retrieval found excerpts). */
    inSourceQuestion: boolean;
    explicitSwitch: {
      kind: "language" | "register" | "persona" | "modality" | "preset";
      to: string;
    } | null;
  };
  progress: {
    questionIndex: number;
    total: number;
    /** All mission objectives have evidence at proficient or better. */
    objectivesMet: boolean;
    nextQuestion: { id: string; prompt: string } | null;
  };
  engagement: {
    frustrated: boolean;
    frustratedBy: "threshold" | "idk_repeat" | null;
    fatigued: boolean;
    pace: "slow" | "normal" | "fast";
  };
  mastery: { band: Band; p: number } | null;
  /** Learner response time on this turn and the persona's median, ms. */
  latencyMs: number | null;
  personaMedianMs: number;
  persona: {
    id: string;
    level: "novice" | "intermediate" | "expert";
    turnLength: "short" | "normal";
  };
  /** Pack variant for the learner's difficulty level. */
  variant: "foundation" | "standard" | "advanced";
  callback: { due: boolean; atBeatBoundary: boolean };
  languageDrift: { turns: number; lang: string } | null;
  mechanic: {
    current: string | null;
    repeats: number;
    /** Best-scoring alternative from preference.ts, if any scores higher. */
    better: string | null;
    /** Best-scoring easier mechanic for R05. */
    easier: string | null;
  };
  limits: { spendCapReached: boolean; tokenBudgetExhausted: boolean };
  session: { microSession: boolean; secondsLeft: number | null };
}

interface Rule {
  id: RuleId;
  when: (s: PolicySnapshot, c: Config) => boolean;
  move: (s: PolicySnapshot, c: Config) => Move;
}

const cap3 = (n: number) => Math.min(3, n);

const base = (s: PolicySnapshot) => ({
  question: s.question.id,
  concept: s.question.conceptKey,
  variant: s.variant,
});

const hintMove = (s: PolicySnapshot, ruleId: RuleId, id: string, reason: string): Move => {
  const level = cap3(s.hintLevel + 1);
  return {
    id,
    type: "graded_hint",
    ruleId,
    reason,
    params: {
      ...base(s),
      hintLevel: level,
      hint: s.question.hints[level - 1],
      misconception: s.misconceptionId,
    },
  };
};

const workedMove = (s: PolicySnapshot, ruleId: RuleId, reason: string): Move => ({
  id: "mv_worked",
  type: "worked_example",
  ruleId,
  reason,
  params: { ...base(s), workedExample: s.question.workedExample },
});

export const RULES: readonly Rule[] = [
  {
    id: "R01",
    when: (s) => s.limits.spendCapReached || s.limits.tokenBudgetExhausted,
    move: (s, c) => ({
      id: "mv_wrap",
      type: "wrap_up",
      ruleId: "R01",
      reason: reasons.R01(s),
      params: { ...base(s), rulesOnly: c.engine.rulesOnly },
    }),
  },
  {
    id: "R02",
    when: (s, c) =>
      s.session.microSession &&
      s.session.secondsLeft !== null &&
      s.session.secondsLeft < c.policy.microSessionWrapSeconds,
    move: (s) => ({
      id: "mv_bookmark",
      type: "summarize_and_bookmark",
      ruleId: "R02",
      reason: reasons.R02(s),
      params: { ...base(s), secondsLeft: s.session.secondsLeft },
    }),
  },
  {
    id: "R03",
    when: (s) => s.cues.explicitSwitch !== null,
    move: (s) => {
      const sw = s.cues.explicitSwitch!;
      return {
        id: sw.kind === "language" ? "mv_switch_language" : "mv_restyle",
        type: sw.kind === "language" ? "switch_language" : "restyle",
        ruleId: "R03",
        reason: reasons.R03(s),
        params: { ...base(s), kind: sw.kind, to: sw.to },
        modifiers: sw.kind === "language" ? [{ kind: "language", value: sw.to }] : undefined,
      };
    },
  },
  {
    id: "R04",
    when: (s) => s.cues.outOfSource || s.cues.inSourceQuestion,
    move: (s, c) => {
      if (s.cues.inSourceQuestion && !s.cues.outOfSource) {
        return {
          id: "mv_answer",
          type: "answer_question",
          ruleId: "R04",
          reason: reasons.R04in(s),
          params: { ...base(s), thenReturnTo: s.question.id },
        };
      }
      const assisted = c.grounding.strictness === "assisted";
      return {
        id: assisted ? "mv_oos_assisted" : "mv_oos_strict",
        type: "out_of_source",
        ruleId: "R04",
        reason: reasons.R04out(s, assisted),
        params: { ...base(s), assisted },
      };
    },
  },
  {
    id: "R05",
    // A correct answer is confirmed first (R99); frustration is handled on the next input.
    when: (s) => s.engagement.frustrated && s.verdict !== "correct",
    move: (s) => {
      // Experts get the question rephrased plainly; novices get encouragement, the foundation
      // variant and an easier mechanic ("not a children's game").
      const expert = s.persona.level === "expert";
      const level = cap3(s.hintLevel + 1);
      return {
        id: expert ? "mv_simplify" : "mv_encourage",
        type: expert ? "simplify" : "encourage_and_simplify",
        ruleId: "R05",
        reason: reasons.R05(s, expert),
        params: {
          ...base(s),
          variant: expert ? "standard" : "foundation",
          hintLevel: level,
          hint: s.question.hints[level - 1],
          switchMechanic: expert ? null : s.mechanic.easier,
        },
        modifiers: expert ? undefined : [{ kind: "pace", value: "slow" }],
      };
    },
  },
  {
    id: "R06",
    when: (s, c) =>
      s.verdict === "incorrect" && s.attempts + 1 >= c.hints.workedExampleAfterIncorrect,
    move: (s) =>
      s.workedShown
        ? {
            ...hintMove(s, "R06", "mv_incorrect", reasons.R06hint(s)),
            type: "feedback_incorrect",
          }
        : workedMove(s, "R06", reasons.R06worked(s)),
  },
  {
    id: "R07",
    when: (s) => s.verdict === "incorrect",
    move: (s, c) =>
      s.attempts + 1 >= c.hints.autoOfferAfterIncorrect
        ? { ...hintMove(s, "R07", "mv_incorrect", reasons.R07(s)), type: "feedback_incorrect" }
        : {
            id: "mv_incorrect",
            type: "feedback_incorrect",
            ruleId: "R07",
            reason: reasons.R07noHint(s),
            params: { ...base(s), misconception: s.misconceptionId },
          },
  },
  {
    id: "R08",
    when: (s) => s.verdict === "partial",
    move: (s) => ({
      ...hintMove(s, "R08", "mv_partial", reasons.R08(s)),
      type: "feedback_partial",
    }),
  },
  {
    id: "R09",
    when: (s) => s.verdict === "not_an_answer" && (s.cues.helpRequest || s.cues.idk),
    move: (s) =>
      s.hintLevel >= 3 && !s.workedShown
        ? workedMove(s, "R09", reasons.R09worked(s))
        : hintMove(s, "R09", "mv_hint", reasons.R09(s)),
  },
  {
    id: "R10",
    when: (s) => s.verdict === "correct" && s.progress.objectivesMet,
    move: (s) => ({
      id: "mv_celebrate",
      type: "celebrate_unlock",
      ruleId: "R10",
      reason: reasons.R10(s),
      params: { ...base(s), celebrate: true, wrapUp: true },
      modifiers: [{ kind: "celebrate", value: true }],
    }),
  },
  {
    id: "R11",
    when: (s) =>
      s.verdict === "correct" &&
      s.mastery !== null &&
      (s.mastery.band === "proficient" || s.mastery.band === "mastered") &&
      s.latencyMs !== null &&
      s.latencyMs < s.personaMedianMs,
    move: (s, c) => ({
      id: "mv_deepen",
      type: "deepen",
      ruleId: "R11",
      reason: reasons.R11(s, c.policy.callbackDelayMinutes),
      params: {
        ...base(s),
        variant: "advanced",
        then: "present_question",
        nextQuestion: s.progress.nextQuestion?.id,
        nextPrompt: s.progress.nextQuestion?.prompt,
      },
      modifiers: [{ kind: "scheduleCallback", value: c.policy.callbackDelayMinutes }],
    }),
  },
  {
    id: "R12",
    when: (s) => s.callback.due && s.callback.atBeatBoundary,
    move: (s) => ({
      id: "mv_callback",
      type: "retention_callback",
      ruleId: "R12",
      reason: reasons.R12(s),
      params: { ...base(s) },
    }),
  },
  {
    id: "R13",
    when: (s) => s.engagement.fatigued,
    move: (s) => {
      // Novices and slow-pace learners are offered a break; others get shorter turns first.
      const offerBreak = s.persona.level === "novice" || s.engagement.pace === "slow";
      return {
        id: offerBreak ? "mv_break" : "mv_pace",
        type: offerBreak ? "offer_break" : "change_pace",
        ruleId: "R13",
        reason: reasons.R13(s, offerBreak),
        params: { ...base(s), turnLength: "short" },
      };
    },
  },
  {
    id: "R14",
    when: (s, c) =>
      c.language.autoSwitch &&
      s.languageDrift !== null &&
      s.languageDrift.turns >= c.language.autoSwitchTurns,
    move: (s) => ({
      id: "mv_switch_language",
      type: "switch_language",
      ruleId: "R14",
      reason: reasons.R14(s),
      params: { ...base(s), to: s.languageDrift!.lang },
      modifiers: [{ kind: "language", value: s.languageDrift!.lang }],
    }),
  },
  {
    id: "R15",
    when: (s, c) => s.mechanic.repeats >= c.mechanics.maxRepeat && s.mechanic.better !== null,
    move: (s) => ({
      id: "mv_switch_mechanic",
      type: "switch_mechanic",
      ruleId: "R15",
      reason: reasons.R15(s),
      params: { ...base(s), to: s.mechanic.better, atNextBeat: true },
    }),
  },
  {
    id: "R99",
    when: () => true,
    move: (s) => {
      if (s.verdict === "correct") {
        const next = s.progress.nextQuestion;
        return {
          id: "mv_correct",
          type: "feedback_correct",
          ruleId: "R99",
          reason: reasons.R99correct(s),
          params: {
            ...base(s),
            then: next ? "present_question" : "continue_beat",
            nextQuestion: next?.id,
            nextPrompt: next?.prompt,
            celebrate: s.attempts === 0,
          },
        };
      }
      return {
        id: "mv_clarify",
        type: "clarify_and_encourage",
        ruleId: "R99",
        reason: reasons.R99clarify(s),
        params: { ...base(s) },
      };
    },
  },
];

/** First enabled rule whose condition holds; R99 cannot be disabled. */
export function decide(snapshot: PolicySnapshot, config: Config): Move {
  for (const rule of RULES) {
    if (rule.id !== "R99" && config.policy.rulesEnabled[rule.id] === false) continue;
    if (rule.when(snapshot, config)) return rule.move(snapshot, config);
  }
  return RULES[RULES.length - 1]!.move(snapshot, config);
}
