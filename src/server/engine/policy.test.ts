import { describe, expect, it } from "vitest";
import type { MissionPack, Question } from "@/lib/schemas/design";
import { UiPayloadSchema } from "@/lib/schemas/turn-events";
import { DEFAULT_CONFIG } from "../config/defaults";
import type { Config } from "../config/schema";
import {
  advance,
  buildSnapshot,
  decideMove,
  EMPTY_STATE,
  decideByVerdict,
  openingMove,
  byLabel,
  uiPayload,
  slotContext,
  type DecideContext,
  type TurnState,
} from "./policy";
import { decide, RULES } from "./rules";
import { RULE_IDS } from "./moves";

const l = (en: string) => ({ en, ur: `${en} ur`, urLatn: `${en} rom` });

const q1: Question = {
  id: "q1",
  conceptKey: "c_greet",
  kind: "choice",
  prompt: "What first?",
  variants: { foundation: "f", standard: "s", advanced: "a" },
  options: [
    {
      id: "a",
      label: l("Greet"),
      correct: true,
      consequence: "Good",
      factIds: ["f1"],
      misconceptionId: null,
    },
    {
      id: "b",
      label: l("Type"),
      correct: false,
      consequence: "Bad",
      factIds: ["f1"],
      misconceptionId: "m1",
    },
  ],
  sequence: null,
  pairs: null,
  passage: null,
  answerKey: null,
  hints: ["h1", "h2", "h3"],
  workedExample: "worked",
  factIds: ["f1"],
};
const q2: Question = {
  ...q1,
  id: "q2",
  kind: "sequence",
  options: null,
  sequence: {
    steps: [
      { id: "s1", label: l("One") },
      { id: "s2", label: l("Two") },
      { id: "s3", label: l("Three") },
      { id: "s4", label: l("Four") },
    ],
    correctOrder: ["s1", "s2", "s3", "s4"],
  },
};
const q3: Question = {
  ...q1,
  id: "q3",
  kind: "match",
  options: null,
  pairs: [
    { left: l("CNIC"), right: l("Identity") },
    { left: l("IBAN"), right: l("Account") },
    { left: l("PIN"), right: l("Secret") },
    { left: l("ATM"), right: l("Machine") },
  ],
};
const pack = {
  questions: [q1, q2, q3],
  beats: [{ id: "b1", kind: "intro", speaker: "Sana", text: "Welcome", factIds: [] }],
} as unknown as MissionPack;

const config = DEFAULT_CONFIG;
const novice = config.personas.find((p) => p.id === "branch_new_joiner")!;
const senior = config.personas.find((p) => p.id === "senior_manager")!;
const officer = config.personas.find((p) => p.id === "branch_officer")!;
const S = (over: Partial<TurnState> = {}): TurnState => ({ ...EMPTY_STATE, ...over });
const snap = (verdict: Parameters<typeof buildSnapshot>[3], ctx: DecideContext = {}, state = S()) =>
  buildSnapshot(pack, state, q1, verdict, ctx);

describe("rule table: one test per rule, first match wins", () => {
  it("R01 limits: spend cap or token budget ends the session", () => {
    const m = decide(snap("correct", { limits: { spendCapReached: true } }), config);
    expect(m).toMatchObject({ ruleId: "R01", type: "wrap_up" });
    expect(decide(snap("correct", { limits: { tokenBudgetExhausted: true } }), config).ruleId).toBe(
      "R01",
    );
  });

  it("R02 micro session: under 60 s left summarizes and bookmarks", () => {
    const m = decide(snap("correct", { session: { microSession: true, secondsLeft: 40 } }), config);
    expect(m).toMatchObject({ ruleId: "R02", type: "summarize_and_bookmark" });
    expect(
      decide(snap("correct", { session: { microSession: true, secondsLeft: 300 } }), config).ruleId,
    ).not.toBe("R02");
    const wide: Config = { ...config, policy: { ...config.policy, microSessionWrapSeconds: 300 } };
    expect(
      decide(snap("correct", { session: { microSession: true, secondsLeft: 200 } }), wide).ruleId,
    ).toBe("R02");
  });

  it("R03 explicit switch: language gives switch_language with a language modifier, others restyle", () => {
    const lang = decide(
      snap("correct", { cues: { explicitSwitch: { kind: "language", to: "ur" } } }),
      config,
    );
    expect(lang).toMatchObject({
      ruleId: "R03",
      type: "switch_language",
      modifiers: [{ kind: "language", value: "ur" }],
    });
    const reg = decide(
      snap("correct", { cues: { explicitSwitch: { kind: "register", to: "formal" } } }),
      config,
    );
    expect(reg).toMatchObject({ ruleId: "R03", type: "restyle" });
  });

  it("R04 question: in-source answers from excerpts, out-of-source follows grounding.strictness", () => {
    const inSrc = decide(snap("not_an_answer", { cues: { inSourceQuestion: true } }), config);
    expect(inSrc).toMatchObject({ ruleId: "R04", type: "answer_question" });
    const strict = decide(snap("not_an_answer", { cues: { outOfSource: true } }), config);
    expect(strict).toMatchObject({
      id: "mv_oos_strict",
      type: "out_of_source",
      params: { assisted: false },
    });
    const assisted: Config = {
      ...config,
      grounding: { ...config.grounding, strictness: "assisted" },
    };
    expect(decide(snap("not_an_answer", { cues: { outOfSource: true } }), assisted).id).toBe(
      "mv_oos_assisted",
    );
  });

  it("R05 frustration: encourage and simplify at foundation level, pace slow, before the verdict rules", () => {
    const m = decide(
      snap("incorrect", { engagement: { frustrated: true }, mechanic: { easier: "scenario" } }),
      config,
    );
    expect(m).toMatchObject({ ruleId: "R05", type: "encourage_and_simplify" });
    expect(m.params.variant).toBe("foundation");
    expect(m.params.switchMechanic).toBe("scenario");
    expect(m.modifiers).toEqual([{ kind: "pace", value: "slow" }]);
    // a correct answer is confirmed first; frustration waits for the next input
    expect(decide(snap("correct", { engagement: { frustrated: true } }), config).ruleId).toBe(
      "R99",
    );
  });

  it("R06 stuck: second incorrect shows the worked example, then hints climb", () => {
    const st = S({ attempts: { q1: 1 }, hintLevel: { q1: 1 } });
    expect(decideMove(pack, st, q1, "incorrect", config)).toMatchObject({
      ruleId: "R06",
      type: "worked_example",
    });
    const shown = S({ attempts: { q1: 2 }, hintLevel: { q1: 1 }, workedShown: { q1: true } });
    const m = decideMove(pack, shown, q1, "incorrect", config);
    expect(m).toMatchObject({ ruleId: "R06", type: "feedback_incorrect" });
    expect(m.params.hintLevel).toBe(2);
  });

  it("R07 incorrect: first wrong answer gets a level 1 hint aimed at the misconception", () => {
    const m = decideMove(pack, S(), q1, "incorrect", config, { misconceptionId: "m1" });
    expect(m).toMatchObject({ ruleId: "R07", type: "feedback_incorrect" });
    expect(m.params).toMatchObject({ hintLevel: 1, hint: "h1", misconception: "m1" });
    expect(m.reason).toContain("aimed at m1");
    // hints.autoOfferAfterIncorrect 2: the first wrong answer gets a correction without a hint
    const later: Config = { ...config, hints: { ...config.hints, autoOfferAfterIncorrect: 2 } };
    const noHint = decideMove(pack, S(), q1, "incorrect", later);
    expect(noHint).toMatchObject({ ruleId: "R07", type: "feedback_incorrect" });
    expect(noHint.params.hintLevel).toBeUndefined();
  });

  it("R08 partial: hint level climbs by one, capped at 3", () => {
    expect(decideMove(pack, S(), q1, "partial", config).params.hintLevel).toBe(1);
    expect(
      decideMove(pack, S({ hintLevel: { q1: 3 } }), q1, "partial", config).params.hintLevel,
    ).toBe(3);
    expect(decideMove(pack, S(), q1, "partial", config).ruleId).toBe("R08");
  });

  it("R09 help: hint, or the worked example at level 3; idk counts as a help request", () => {
    const help = decideMove(pack, S(), q1, "not_an_answer", config, {
      cues: { helpRequest: true },
    });
    expect(help).toMatchObject({ ruleId: "R09", type: "graded_hint" });
    const idk = decideMove(pack, S(), q1, "not_an_answer", config, { cues: { idk: true } });
    expect(idk.ruleId).toBe("R09");
    expect(idk.reason).toContain("I don't know");
    const worked = decideMove(pack, S({ hintLevel: { q1: 3 } }), q1, "not_an_answer", config, {
      cues: { helpRequest: true },
    });
    expect(worked.type).toBe("worked_example");
  });

  it("R10 objectives met: correct on the last question celebrates and unlocks", () => {
    const m = decideMove(pack, S({ questionIndex: 2 }), q3, "correct", config);
    expect(m).toMatchObject({
      ruleId: "R10",
      type: "celebrate_unlock",
      modifiers: [{ kind: "celebrate", value: true }],
    });
  });

  it("R11 deepen: correct, proficient and faster than the persona median schedules a callback", () => {
    const ctx = { mastery: { band: "proficient" as const, p: 0.75 }, persona: novice };
    const m = decideMove(pack, S(), q1, "correct", config, { ...ctx, latencyMs: 9000 });
    expect(m).toMatchObject({ ruleId: "R11", type: "deepen" });
    expect(m.modifiers).toEqual([
      { kind: "scheduleCallback", value: config.policy.callbackDelayMinutes },
    ]);
    expect(decideMove(pack, S(), q1, "correct", config, { ...ctx, latencyMs: 20000 }).ruleId).toBe(
      "R99",
    );
  });

  it("R12 callback due at a beat boundary", () => {
    expect(
      decide(snap("correct", { callback: { due: true, atBeatBoundary: true } }), config),
    ).toMatchObject({ ruleId: "R12", type: "retention_callback" });
    expect(
      decide(snap("correct", { callback: { due: true, atBeatBoundary: false } }), config).ruleId,
    ).not.toBe("R12");
  });

  it("R13 fatigue: a break for novices and slow pace, shorter turns otherwise", () => {
    const tired: DecideContext = { engagement: { fatigued: true } };
    expect(decide(snap("correct", { ...tired, persona: novice }), config)).toMatchObject({
      ruleId: "R13",
      type: "offer_break",
    });
    expect(decide(snap("correct", { ...tired, persona: officer }), config)).toMatchObject({
      ruleId: "R13",
      type: "change_pace",
    });
    expect(
      decide(snap("correct", { ...tired, persona: officer }), config).modifiers,
    ).toBeUndefined();
  });

  it("R14 language drift: two turns in another language switch when auto-switch is on", () => {
    const m = decide(snap("correct", { languageDrift: { turns: 2, lang: "ur" } }), config);
    expect(m).toMatchObject({ ruleId: "R14", type: "switch_language", params: { to: "ur" } });
    const off: Config = { ...config, language: { ...config.language, autoSwitch: false } };
    expect(decide(snap("correct", { languageDrift: { turns: 2, lang: "ur" } }), off).ruleId).toBe(
      "R99",
    );
    expect(
      decide(snap("correct", { languageDrift: { turns: 1, lang: "ur" } }), config).ruleId,
    ).toBe("R99");
  });

  it("R15 variety: a repeated mechanic with a better alternative switches at the next beat", () => {
    const m = decide(
      snap("correct", { mechanic: { current: "puzzle", repeats: 2, better: "roleplay" } }),
      config,
    );
    expect(m).toMatchObject({
      ruleId: "R15",
      type: "switch_mechanic",
      params: { to: "roleplay", atNextBeat: true },
    });
    expect(
      decide(snap("correct", { mechanic: { current: "puzzle", repeats: 2, better: null } }), config)
        .ruleId,
    ).toBe("R99");
  });

  it("R99 default: correct confirms and presents the next question; anything else clarifies", () => {
    const m = decideMove(pack, S(), q1, "correct", config);
    expect(m).toMatchObject({
      ruleId: "R99",
      type: "feedback_correct",
      params: { nextQuestion: "q2", celebrate: true },
    });
    expect(decideMove(pack, S(), q1, "not_an_answer", config)).toMatchObject({
      ruleId: "R99",
      type: "clarify_and_encourage",
    });
  });

  it("order: an earlier rule wins over a later one that also matches", () => {
    expect(decide(snap("incorrect", { engagement: { frustrated: true } }), config).ruleId).toBe(
      "R05",
    );
    expect(
      decide(
        snap("incorrect", { engagement: { frustrated: true }, limits: { spendCapReached: true } }),
        config,
      ).ruleId,
    ).toBe("R01");
  });

  it("disabled rules are skipped; R99 cannot be disabled", () => {
    const noR05: Config = {
      ...config,
      policy: { ...config.policy, rulesEnabled: { ...config.policy.rulesEnabled, R05: false } },
    };
    expect(decide(snap("incorrect", { engagement: { frustrated: true } }), noR05).ruleId).toBe(
      "R07",
    );
    const allOff: Config = {
      ...config,
      policy: {
        ...config.policy,
        rulesEnabled: Object.fromEntries(RULE_IDS.map((r) => [r, false])),
      },
    };
    expect(decide(snap("correct"), allOff).ruleId).toBe("R99");
    expect(RULES.map((r) => r.id)).toEqual(RULE_IDS);
  });

  it("every move carries at most two modifiers", () => {
    for (const s of [
      snap("correct", { limits: { spendCapReached: true } }),
      snap("correct", { engagement: { frustrated: true } }),
      snap("correct", { mastery: { band: "mastered", p: 0.95 }, latencyMs: 1000 }),
      snap("correct", { engagement: { fatigued: true } }),
    ])
      expect((decide(s, config).modifiers ?? []).length).toBeLessThanOrEqual(2);
  });
});

describe("worked example policy decisions", () => {
  it("after event 1: R08 graded hint level 2 aimed at mc2", () => {
    const m = decideMove(pack, S({ hintLevel: { q1: 1 } }), q1, "partial", config, {
      misconceptionId: "mc2",
    });
    expect(m).toMatchObject({ ruleId: "R08", params: { hintLevel: 2, misconception: "mc2" } });
    expect(m.reason).toBe(
      "Partial answer on q1 after a level 1 hint. Rule R08: level 2 hint aimed at mc2.",
    );
  });

  it("after event 2: R11 deepen with a callback in 8 minutes (proficient 0.75, 9 s against 14 s)", () => {
    const m = decideMove(pack, S(), q1, "correct", config, {
      mastery: { band: "proficient", p: 0.75 },
      latencyMs: 9000,
      persona: novice,
    });
    expect(m).toMatchObject({
      ruleId: "R11",
      type: "deepen",
      modifiers: [{ kind: "scheduleCallback", value: 8 }],
    });
    expect(m.reason).toContain("mastery 0.75 (proficient)");
    expect(m.reason).toContain("recall check in 8 minutes");
  });

  it("after event 3: R10 celebrate and unlock when all objectives are met", () => {
    const m = decideMove(
      pack,
      S({ questionIndex: 2, completed: ["q1", "q2"] }),
      q3,
      "correct",
      config,
      { mastery: { band: "mastered", p: 0.937 } },
    );
    expect(m).toMatchObject({ ruleId: "R10", type: "celebrate_unlock" });
  });
});

describe("persona differences: the same learner state, novice versus senior manager", () => {
  it("1. a quick correct answer: deepen for the novice (9 s under 14 s), plain feedback for the senior (9 s over 8 s)", () => {
    const ctx = { mastery: { band: "proficient" as const, p: 0.75 }, latencyMs: 9000 };
    expect(decideMove(pack, S(), q1, "correct", config, { ...ctx, persona: novice }).ruleId).toBe(
      "R11",
    );
    expect(decideMove(pack, S(), q1, "correct", config, { ...ctx, persona: senior }).ruleId).toBe(
      "R99",
    );
  });

  it("2. frustration: the novice gets encouragement, a foundation variant and an easier mechanic; the senior gets the question rephrased plainly", () => {
    const ctx: DecideContext = {
      engagement: { frustrated: true },
      mechanic: { easier: "scenario" },
    };
    const n = decideMove(pack, S(), q1, "incorrect", config, { ...ctx, persona: novice });
    const s = decideMove(pack, S(), q1, "incorrect", config, { ...ctx, persona: senior });
    expect(n).toMatchObject({
      ruleId: "R05",
      type: "encourage_and_simplify",
      params: { variant: "foundation", switchMechanic: "scenario" },
    });
    expect(s).toMatchObject({
      ruleId: "R05",
      type: "simplify",
      params: { variant: "standard", switchMechanic: null },
    });
    expect(s.modifiers).toBeUndefined();
  });

  it("3. fatigue: the novice is offered a break, the senior gets shorter turns; a slow pace breaks for everyone", () => {
    expect(
      decide(snap("correct", { engagement: { fatigued: true }, persona: novice }), config).type,
    ).toBe("offer_break");
    expect(
      decide(snap("correct", { engagement: { fatigued: true }, persona: senior }), config).type,
    ).toBe("change_pace");
    expect(
      decide(
        snap("correct", { engagement: { fatigued: true, pace: "slow" }, persona: senior }),
        config,
      ).type,
    ).toBe("offer_break");
  });

  it("4. the pack variant follows the persona's start difficulty unless the caller overrides it", () => {
    expect(decideMove(pack, S(), q1, "incorrect", config, { persona: novice }).params.variant).toBe(
      "foundation",
    );
    expect(decideMove(pack, S(), q1, "incorrect", config, { persona: senior }).params.variant).toBe(
      "advanced",
    );
  });

  it("R04 cues apply only to the not_an_answer and out_of_source slots: a question-shaped correct answer stays correct", () => {
    const asked: DecideContext = { cues: { inSourceQuestion: true } };
    const moves = decideByVerdict(pack, S(), q1, config, asked);
    expect(moves.correct).toMatchObject({ ruleId: "R99", type: "feedback_correct" });
    expect(moves.incorrect.ruleId).toBe("R07");
    expect(moves.partial.ruleId).toBe("R08");
    expect(moves.not_an_answer).toMatchObject({ ruleId: "R04", type: "answer_question" });
    expect(moves.out_of_source).toMatchObject({ id: "mv_oos_strict" });
    const oos = decideByVerdict(pack, S(), q1, config, { cues: { outOfSource: true } });
    expect(oos.correct.type).toBe("feedback_correct");
    expect(oos.not_an_answer.type).toBe("graded_hint");
  });

  it("the correct slot judges R11 on the mastery a correct answer would produce", () => {
    const moves = decideByVerdict(pack, S(), q1, config, {
      mastery: { band: "developing", p: 0.6 },
      masteryIfCorrect: { band: "proficient", p: 0.75 },
      latencyMs: 9000,
      persona: novice,
    });
    expect(moves.correct.ruleId).toBe("R11");
  });

  it("the stored snapshot reproduces the decision for every slot (adaptation_events.inputs)", () => {
    const ctx: DecideContext = {
      cues: { idk: true },
      engagement: { frustrated: false },
      persona: novice,
    };
    const moves = decideByVerdict(pack, S(), q1, config, ctx);
    for (const slot of [
      "correct",
      "partial",
      "incorrect",
      "not_an_answer",
      "out_of_source",
    ] as const) {
      const verdict = slot === "out_of_source" ? "not_an_answer" : slot;
      const replayed = decide(
        buildSnapshot(pack, S(), q1, verdict, slotContext(ctx, slot)),
        config,
      );
      expect(replayed).toEqual(moves[slot]);
    }
  });

  it("decideByVerdict offers one move per verdict plus out_of_source; the opening move plays the intro beat", () => {
    expect(Object.keys(decideByVerdict(pack, S(), q1, config))).toEqual([
      "correct",
      "partial",
      "incorrect",
      "not_an_answer",
      "out_of_source",
    ]);
    expect(decideByVerdict(pack, S(), q1, config).out_of_source.id).toBe("mv_oos_strict");
    expect(openingMove(pack, q1).params.beatText).toBe("Welcome");
  });
});

describe("advance", () => {
  it("never mutates, counts attempts, moves on when correct, finishes on the last question", () => {
    const wrong = advance(
      EMPTY_STATE,
      pack,
      q1,
      decideMove(pack, EMPTY_STATE, q1, "incorrect", config),
      "incorrect",
    );
    expect(EMPTY_STATE.attempts).toEqual({});
    expect(wrong.attempts.q1).toBe(1);
    expect(wrong.hintLevel.q1).toBe(1);
    expect(wrong.questionIndex).toBe(0);
    const right = advance(
      wrong,
      pack,
      q1,
      decideMove(pack, wrong, q1, "correct", config),
      "correct",
    );
    expect(right.completed).toEqual(["q1"]);
    expect(right.questionIndex).toBe(1);
    const last: TurnState = { ...right, questionIndex: 2 };
    expect(
      advance(last, pack, q3, decideMove(pack, last, q3, "correct", config), "correct").finished,
    ).toBe(true);
  });
});

describe("uiPayload", () => {
  it("choice: options without the answer key, valid against the shared schema", () => {
    const ui = uiPayload(q1)!;
    expect(UiPayloadSchema.safeParse(ui).success).toBe(true);
    expect(JSON.stringify(ui)).not.toMatch(/correct|consequence|misconception/);
  });

  it("sequence: label order (no pack order on the wire), never the correct order", () => {
    const ui = uiPayload(q2)!;
    const ids = ui.steps!.map((s) => s.id);
    expect([...ids].sort()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(ids).not.toEqual(q2.sequence!.correctOrder);
    const reversed = {
      ...q2,
      sequence: { ...q2.sequence!, steps: [...q2.sequence!.steps].reverse() },
    };
    expect(uiPayload(reversed)!.steps!.map((s) => s.id)).toEqual(ids);
    expect(JSON.stringify(ui)).not.toContain("correctOrder");
  });

  it("match: both sides in label order, so no pairing is recoverable from the payload", () => {
    const ui = uiPayload(q3)!;
    expect(ui.lefts!.map((x) => x.en)).toEqual(["ATM", "CNIC", "IBAN", "PIN"]);
    expect(ui.rights!.map((x) => x.en)).toEqual(["Account", "Identity", "Machine", "Secret"]);
    const reversed = { ...q3, pairs: [...q3.pairs!].reverse() };
    expect(uiPayload(reversed)).toEqual(ui);
    expect(ui).not.toHaveProperty("pairs");
  });
});

describe("byLabel", () => {
  it("sorts by English label without mutating the input", () => {
    const items = [{ en: "b" }, { en: "a" }];
    expect(byLabel(items).map((x) => x.en)).toEqual(["a", "b"]);
    expect(items.map((x) => x.en)).toEqual(["b", "a"]);
  });
});
