import { describe, expect, it } from "vitest";
import {
  applyEvent,
  bandOf,
  emptyMastery,
  forget,
  replayMastery,
  updateMastery,
  type MasteryEvent,
  type MasteryParams,
} from "./mastery";

// Persona prior 0.20, T = 0.08, s = 0.10, default bands and k = 0.5.
const params: MasteryParams = {
  p0: 0.2,
  transit: 0.08,
  slip: 0.1,
  bands: { developing: 0.4, proficient: 0.7, mastered: 0.9 },
  masteredMinEvents: 3,
  masteredMinSignalTypes: 2,
  masteredMinLower: 0.6,
  bandK: 0.5,
  forgetting: { enabled: false, halfLifeDays: 14 },
};

const t0 = new Date("2026-09-19T10:00:00Z");
const workedExample: MasteryEvent[] = [
  { credit: 0.35, weight: 0.7, guess: 0.15, signal: "free_text", at: t0 },
  { credit: 0.9, weight: 0.9, guess: 0.05, signal: "teach_back", at: new Date(+t0 + 60_000) },
  { credit: 1.0, weight: 0.92, guess: 0.15, signal: "retention", at: new Date(+t0 + 12 * 60_000) },
];
const r3 = (x: number) => Math.round(x * 1000) / 1000;

describe("worked example (3 decimals)", () => {
  it("row by row: P after, n_eff, band", () => {
    let s = emptyMastery(0.2, params);
    expect(r3(s.p)).toBe(0.2);

    s = applyEvent(s, workedExample[0]!, params);
    expect(r3(s.p)).toBe(0.264);
    expect(r3(s.nEff)).toBe(0.7);
    expect(s.band).toBe("not_yet");
    expect([r3(s.lower), r3(s.upper)]).toEqual([0, 0.647]);

    s = applyEvent(s, workedExample[1]!, params);
    expect(r3(s.p)).toBe(0.75);
    expect(r3(s.nEff)).toBe(1.6);
    expect(s.band).toBe("proficient");
    expect(s.limitedEvidence).toBe(true);
    expect(r3(s.lower)).toBe(0.44);

    s = applyEvent(s, workedExample[2]!, params);
    expect(r3(s.p)).toBe(0.937);
    expect(r3(s.nEff)).toBe(2.52);
    expect(s.band).toBe("mastered");
    expect(s.limitedEvidence).toBe(false);
    expect(r3(s.lower)).toBe(0.67);
    expect(s.signalTypes).toEqual(["free_text", "teach_back", "retention"]);
  });

  it("row 1 intermediate values from the check line", () => {
    // P_c 0.600, P_i 0.029, P_obs 0.229, P_post 0.220, P_next 0.264
    const p = 0.2;
    const pC = (p * 0.9) / (p * 0.9 + (1 - p) * 0.15);
    const pI = (p * 0.1) / (p * 0.1 + (1 - p) * 0.85);
    expect(r3(pC)).toBe(0.6);
    expect(r3(pI)).toBe(0.029);
    const pObs = 0.35 * pC + 0.65 * pI;
    expect(r3(pObs)).toBe(0.229);
    const pPost = 0.7 * pObs + 0.3 * p;
    expect(r3(pPost)).toBe(0.22);
    expect(r3(updateMastery(p, workedExample[0]!, params))).toBe(0.264);
  });

  it("replay of the log equals the sequential result, whatever the input order", () => {
    const sequential = workedExample.reduce(
      (s, e) => applyEvent(s, e, params),
      emptyMastery(0.2, params),
    );
    const replayed = replayMastery([...workedExample].reverse(), params);
    expect(replayed).toEqual(sequential);
  });
});

describe("bounds and bands", () => {
  it("P stays in [0, 1] for random inputs, including degenerate ones", () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 5000; i++) {
      const p = [0, 1, rnd()][i % 3]!;
      const next = updateMastery(
        p,
        { credit: rnd() * 1.4 - 0.2, weight: rnd() * 1.4 - 0.2, guess: rnd() * 1.2 - 0.1 },
        { slip: rnd() * 0.3, transit: rnd() * 0.3 },
      );
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(1);
      expect(Number.isNaN(next)).toBe(false);
    }
  });

  it("mastered requires all four conditions; otherwise proficient with limited evidence", () => {
    const base = { p: 0.95, nEvents: 3, nEff: 2.5, signalTypes: ["free_text", "teach_back"] };
    expect(bandOf(base, params)).toMatchObject({ band: "mastered", limitedEvidence: false });
    expect(bandOf({ ...base, p: 0.89 }, params)).toMatchObject({
      band: "proficient",
      limitedEvidence: false,
    });
    expect(bandOf({ ...base, p: 0.75, nEvents: 2 }, params)).toMatchObject({
      band: "proficient",
      limitedEvidence: true,
    });
    expect(bandOf({ ...base, nEvents: 2 }, params)).toMatchObject({
      band: "proficient",
      limitedEvidence: true,
    });
    expect(bandOf({ ...base, signalTypes: ["choice", "choice"] }, params)).toMatchObject({
      band: "proficient",
      limitedEvidence: true,
    });
    // low n_eff widens the band: lower bound 0.95 - 0.5 / sqrt(1.2) = 0.49 < 0.60
    expect(bandOf({ ...base, nEff: 0.2 }, params)).toMatchObject({
      band: "proficient",
      limitedEvidence: true,
    });
  });

  it("band thresholds", () => {
    const s = (p: number) => ({ p, nEvents: 5, nEff: 4, signalTypes: ["a", "b", "c"] });
    expect(bandOf(s(0.39), params).band).toBe("not_yet");
    expect(bandOf(s(0.4), params).band).toBe("developing");
    expect(bandOf(s(0.7), params).band).toBe("proficient");
    expect(bandOf(s(0.9), params).band).toBe("mastered");
  });
});

describe("forgetting", () => {
  it("decays toward P0 by half per half-life and is off by default", () => {
    expect(r3(forget(0.8, 0.2, 14 * 86_400_000, 14))).toBe(0.5);
    expect(forget(0.8, 0.2, 0, 14)).toBe(0.8);
    const on: MasteryParams = { ...params, forgetting: { enabled: true, halfLifeDays: 14 } };
    const start = applyEvent(emptyMastery(0.2, params), workedExample[1]!, params);
    const later: MasteryEvent = {
      ...workedExample[2]!,
      at: new Date(+workedExample[1]!.at! + 14 * 86_400_000),
    };
    const withForgetting = applyEvent(start, later, on);
    const without = applyEvent(start, later, params);
    expect(withForgetting.p).toBeLessThan(without.p);
  });
});
