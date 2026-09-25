import { describe, expect, it } from "vitest";
import {
  buildEvidence,
  calculateCredit,
  computeBktUpdate,
  getSignalGuess,
  getSignalWeight,
} from "./evidence";

describe("evidence module", () => {
  describe("credit calculation", () => {
    it("assigns base credit for correct, partial, and incorrect verdicts", () => {
      expect(calculateCredit({ verdict: "correct" }, {})).toBe(1.0);
      expect(calculateCredit({ verdict: "partial", score: 0.8 }, {})).toBe(0.8);
      expect(calculateCredit({ verdict: "partial" }, {})).toBe(0.5); // default
      expect(calculateCredit({ verdict: "incorrect" }, {})).toBe(0.0);
      expect(calculateCredit({ verdict: "not_an_answer" }, {})).toBe(0.0);
    });

    it("applies hint discounts for levels 0 through 3 and worked examples", () => {
      // Correct answers with hints:
      expect(calculateCredit({ verdict: "correct" }, { hintLevel: 0 })).toBe(1.0);
      expect(calculateCredit({ verdict: "correct" }, { hintLevel: 1 })).toBeCloseTo(0.7, 3);
      expect(calculateCredit({ verdict: "correct" }, { hintLevel: 2 })).toBeCloseTo(0.45, 3);
      expect(calculateCredit({ verdict: "correct" }, { hintLevel: 3 })).toBeCloseTo(0.2, 3);

      // Worked example counts as level 3 discount (0.80)
      expect(calculateCredit({ verdict: "correct" }, { isWorkedExample: true })).toBeCloseTo(
        0.2,
        3,
      );

      // Worked example row 1: partial (0.5) with level 1 hint (0.30 discount) -> 0.35
      expect(calculateCredit({ verdict: "partial", score: 0.5 }, { hintLevel: 1 })).toBeCloseTo(
        0.35,
        3,
      );
    });

    it("applies self-correction floor of 0.70", () => {
      // Without hint:
      const credit = calculateCredit({ verdict: "incorrect", self_correction: true }, {});
      expect(credit).toBe(0.7);

      // With heavy hint discount, self-correction ensures at least 0.70:
      const creditWithHint = calculateCredit(
        { verdict: "correct", self_correction: true },
        { hintLevel: 3 }, // normal discount would make it 0.20
      );
      expect(creditWithHint).toBe(0.7);
    });
  });

  describe("signal weight and retention boost", () => {
    it("returns standard weights by signal type", () => {
      expect(getSignalWeight("choice", {})).toBe(0.5);
      expect(getSignalWeight("puzzle", {})).toBe(0.6);
      expect(getSignalWeight("free_text", {})).toBe(0.7);
      expect(getSignalWeight("explanation", {})).toBe(0.9);
      expect(getSignalWeight("teach_back", {})).toBe(0.9);
      expect(getSignalWeight("question", {})).toBe(0.0);
    });

    it("applies retention boosts for same-session delay and next-day callbacks", () => {
      // Retention base weight is 0.8
      expect(getSignalWeight("retention", { callbackDelayMinutes: 5 })).toBe(0.8);

      // Same-session delay >= 8 min: 0.8 * 1.15 = 0.92 (worked example row 3)
      expect(getSignalWeight("retention", { callbackDelayMinutes: 12 })).toBeCloseTo(0.92, 2);

      // Next day: 0.8 * 1.30 = 1.04 -> clamped to 1.0
      expect(getSignalWeight("retention", { isNextDay: true })).toBe(1.0);
    });
  });

  describe("signal guess calculation", () => {
    it("computes guess probability based on choices or signal defaults", () => {
      expect(getSignalGuess("choice", 4)).toBe(0.25);
      expect(getSignalGuess("choice", 2)).toBe(0.5);
      expect(getSignalGuess("choice", 10)).toBe(0.2); // clamped to choiceMin (0.2)
      expect(getSignalGuess("free_text")).toBe(0.15);
      expect(getSignalGuess("puzzle")).toBe(0.1);
      expect(getSignalGuess("teach_back")).toBe(0.05);
    });
  });

  describe("worked example", () => {
    it("reproduces row 1 of the worked example to 3 decimal places", () => {
      // Event 1: free text, partial (rubric 0.5), after level 1 hint
      // y = 0.35, w = 0.70, g = 0.15, P_before = 0.200 -> P_next = 0.264
      const pAfter = computeBktUpdate(
        0.2, // P_before
        0.35, // credit y
        0.7, // weight w
        0.15, // guess g
        0.1, // slip s
        0.08, // transit T
      );
      expect(pAfter).toBeCloseTo(0.264, 3);
    });

    it("reproduces row 2 of the worked example to 3 decimal places", () => {
      // Event 2: teach-back, rubric 0.9, no hint
      // y = 0.90, w = 0.90, g = 0.05, P_before = 0.264 -> P_next = 0.750
      const pAfter = computeBktUpdate(0.264, 0.9, 0.9, 0.05, 0.1, 0.08);
      expect(pAfter).toBeCloseTo(0.75, 3);
    });

    it("reproduces row 3 of the worked example to 3 decimal places", () => {
      // Event 3: retention callback 12 min later, correct
      // y = 1.00, w = 0.92, g = 0.15, P_before = 0.750 -> P_next = 0.937
      const pAfter = computeBktUpdate(0.75, 1.0, 0.92, 0.15, 0.1, 0.08);
      expect(pAfter).toBeCloseTo(0.937, 3);
    });
  });

  describe("buildEvidence", () => {
    it("constructs a complete, valid EvidenceEventInput", () => {
      const event = buildEvidence(
        {
          verdict: "partial",
          score: 0.5,
          misconception: "mc_cnic",
          confidence_cue: "medium",
        },
        {
          orgId: "org-1",
          userId: "user-1",
          sessionId: "sess-1",
          turnId: "turn-1",
          conceptId: "concept-1",
          missionId: "mission-1",
          questionId: "q1",
          signal: "free_text",
          hintLevel: 1,
          latencyMs: 4200,
          pBefore: 0.2,
          source: "inline",
        },
      );

      expect(event.orgId).toBe("org-1");
      expect(event.conceptId).toBe("concept-1");
      expect(event.credit).toBeCloseTo(0.35, 3);
      expect(event.weight).toBe(0.7);
      expect(event.pBefore).toBe(0.2);
      expect(event.pAfter).toBeCloseTo(0.264, 3);
      expect(event.misconceptionId).toBe("mc_cnic");
      expect(event.source).toBe("inline");
    });
  });
});
