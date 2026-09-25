import { describe, it, expect } from "vitest";
import { whyLine, nextRecommendation, type ConceptProgress } from "./progress";

const concept = (over: Partial<ConceptProgress> = {}): ConceptProgress => ({
  conceptId: "c1",
  conceptKey: "k1",
  conceptLabel: "Greeting within thirty seconds",
  p: 0.5,
  band: "developing",
  lower: 0.4,
  upper: 0.6,
  nEvents: 3,
  lastEvidenceAt: null,
  ...over,
});

describe("why lines", () => {
  it("explains a first try correct answer in plain words", () => {
    const line = whyLine({
      verdict: "correct",
      signal: "mcq",
      hintLevel: 0,
      selfCorrected: false,
      pBefore: 0.4,
      pAfter: 0.6,
    });
    expect(line).toContain("went up");
    expect(line).toContain("right first time");
  });

  it("says a hinted answer counts for less, rather than hiding it", () => {
    const line = whyLine({
      verdict: "correct",
      signal: "mcq",
      hintLevel: 2,
      selfCorrected: false,
      pBefore: 0.4,
      pAfter: 0.45,
    });
    expect(line).toContain("after a hint");
  });

  it("credits a self correction", () => {
    const line = whyLine({
      verdict: "correct",
      signal: "free_text",
      hintLevel: 0,
      selfCorrected: true,
      pBefore: 0.4,
      pAfter: 0.55,
    });
    expect(line).toContain("spotted the mistake yourself");
  });

  it("does not claim movement when the estimate barely changed", () => {
    const line = whyLine({
      verdict: "not_an_answer",
      signal: "free_text",
      hintLevel: 0,
      selfCorrected: false,
      pBefore: 0.5,
      pAfter: 0.5005,
    });
    expect(line).toContain("stayed about the same");
  });

  it("is never blaming about a wrong answer", () => {
    const line = whyLine({
      verdict: "incorrect",
      signal: "mcq",
      hintLevel: 0,
      selfCorrected: false,
      pBefore: 0.5,
      pAfter: 0.3,
    });
    // Guardrail: never shame a mistake.
    expect(line.toLowerCase()).not.toMatch(/fail|wrong|bad|poor/);
  });
});

describe("next recommendation", () => {
  it("puts a due recall check first", () => {
    const r = nextRecommendation([concept()], new Date(), {
      conceptLabel: "Listening fully",
    });
    expect(r?.kind).toBe("callback");
    expect(r?.label).toBe("Listening fully");
  });

  it("otherwise picks the least settled topic that has been practised", () => {
    const r = nextRecommendation([
      concept({ conceptId: "a", conceptLabel: "Strong topic", p: 0.8 }),
      concept({ conceptId: "b", conceptLabel: "Weak topic", p: 0.2 }),
    ]);
    expect(r?.kind).toBe("concept");
    expect(r?.label).toBe("Weak topic");
  });

  it("ignores topics with no evidence, so it cannot recommend something untouched", () => {
    const r = nextRecommendation([
      concept({ conceptId: "a", conceptLabel: "Untouched", p: 0.05, nEvents: 0 }),
      concept({ conceptId: "b", conceptLabel: "Practised", p: 0.5 }),
    ]);
    expect(r?.label).toBe("Practised");
  });

  it("moves on to the next mission when everything practised is mastered", () => {
    const r = nextRecommendation([concept({ p: 0.95, band: "mastered" })]);
    expect(r?.kind).toBe("mission");
  });

  it("falls back to the next mission when nothing has been practised at all", () => {
    expect(nextRecommendation([])?.kind).toBe("mission");
  });

  it("always gives a reason the screen can show", () => {
    for (const r of [
      nextRecommendation([], new Date(), { conceptLabel: "X" }),
      nextRecommendation([concept()]),
      nextRecommendation([]),
    ]) {
      expect(r?.reason.length ?? 0).toBeGreaterThan(10);
    }
  });
});
