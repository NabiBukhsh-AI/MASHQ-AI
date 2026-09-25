import { describe, it, expect } from "vitest";
import {
  buildDemoLearners,
  makeRandom,
  scriptAnswer,
  simulateConcept,
  DEMO_LEARNER_COUNT,
  DEPARTMENTS,
  COHORTS,
} from "./demo-seed";
import { baseConfig } from "../config/service";
import { masteryParams, replayMastery, type MasteryEvent } from "../engine/mastery";

const config = baseConfig();

describe("demo learners", () => {
  it("creates the full cohort", () => {
    expect(buildDemoLearners()).toHaveLength(DEMO_LEARNER_COUNT);
  });

  it("spreads learners across every department and cohort, so filters have something to show", () => {
    const learners = buildDemoLearners();
    const departments = new Set(learners.map((l) => l.department));
    const cohorts = new Set(learners.map((l) => l.cohort));
    expect(departments.size).toBe(DEPARTMENTS.length);
    expect(cohorts.size).toBe(COHORTS.length);
  });

  it("gives a spread of ability rather than a clump", () => {
    const abilities = buildDemoLearners().map((l) => l.ability);
    expect(Math.min(...abilities)).toBeLessThan(0.45);
    expect(Math.max(...abilities)).toBeGreaterThan(0.75);
  });

  it("is deterministic, so reseeding gives the same dashboards", () => {
    expect(buildDemoLearners()).toEqual(buildDemoLearners());
  });

  it("uses only reserved example addresses, never a real inbox", () => {
    for (const l of buildDemoLearners()) {
      expect(l.email.endsWith("@example.invalid")).toBe(true);
    }
  });
});

describe("scripted answers", () => {
  it("makes a strong learner mostly correct and a weak one mostly not", () => {
    const strongRand = makeRandom(11);
    const weakRand = makeRandom(11);
    let strongCorrect = 0;
    let weakCorrect = 0;
    for (let i = 0; i < 200; i++) {
      if (scriptAnswer(0.9, 0, strongRand).verdict === "correct") strongCorrect++;
      if (scriptAnswer(0.2, 0, weakRand).verdict === "correct") weakCorrect++;
    }
    expect(strongCorrect).toBeGreaterThan(weakCorrect * 2);
  });

  it("treats a second attempt as easier, because a hint has been given", () => {
    const a = makeRandom(7);
    const b = makeRandom(7);
    let first = 0;
    let second = 0;
    for (let i = 0; i < 200; i++) {
      if (scriptAnswer(0.5, 0, a).verdict === "correct") first++;
      if (scriptAnswer(0.5, 1, b).verdict === "correct") second++;
    }
    expect(second).toBeGreaterThan(first);
  });
});

describe("simulated mastery", () => {
  it("produces a state that is a faithful replay of its own events", () => {
    const sim = simulateConcept({
      conceptId: "c1",
      ability: 0.7,
      attempts: 6,
      startAt: new Date("2026-09-06T09:00:00Z"),
      rand: makeRandom(42),
      config,
    });

    // The dashboards must not show a number the evidence log cannot reproduce.
    const events: MasteryEvent[] = sim.events.map((e) => ({
      credit: e.credit,
      weight: e.weight,
      guess: e.guess,
      signal: e.signal,
      at: e.at,
    }));
    const replayed = replayMastery(events, masteryParams(config, 0.25));

    expect(replayed.p).toBeCloseTo(sim.mastery.p, 10);
    expect(replayed.nEvents).toBe(sim.mastery.nEvents);
    expect(replayed.band).toBe(sim.mastery.band);
  });

  it("chains pBefore to pAfter across events, so the log reads as one history", () => {
    const sim = simulateConcept({
      conceptId: "c1",
      ability: 0.6,
      attempts: 5,
      startAt: new Date("2026-09-06T09:00:00Z"),
      rand: makeRandom(9),
      config,
    });
    for (let i = 1; i < sim.events.length; i++) {
      expect(sim.events[i]!.pBefore).toBeCloseTo(sim.events[i - 1]!.pAfter, 10);
    }
  });

  it("keeps every probability inside the range the database checks allow", () => {
    const sim = simulateConcept({
      conceptId: "c1",
      ability: 0.95,
      attempts: 12,
      startAt: new Date("2026-09-06T09:00:00Z"),
      rand: makeRandom(3),
      config,
    });
    for (const e of sim.events) {
      expect(e.pBefore).toBeGreaterThanOrEqual(0);
      expect(e.pBefore).toBeLessThanOrEqual(1);
      expect(e.pAfter).toBeGreaterThanOrEqual(0);
      expect(e.pAfter).toBeLessThanOrEqual(1);
      expect(e.credit).toBeGreaterThanOrEqual(0);
      expect(e.credit).toBeLessThanOrEqual(1);
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(1);
    }
  });

  it("moves a capable learner up the bands rather than leaving them at the prior", () => {
    const sim = simulateConcept({
      conceptId: "c1",
      ability: 0.95,
      attempts: 10,
      startAt: new Date("2026-09-06T09:00:00Z"),
      rand: makeRandom(5),
      config,
    });
    expect(sim.mastery.p).toBeGreaterThan(0.25);
    expect(sim.mastery.signalTypes.length).toBeGreaterThan(1);
  });
});
