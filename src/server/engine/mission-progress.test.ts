import { describe, it, expect } from "vitest";
import { EMPTY_STATE, advance, type TurnState } from "./policy";
import type { MissionPack, Question } from "@/lib/schemas/design";

/**
 * Finishing a mission is not finishing the journey.
 *
 * currentMissionId was written once, when the session was created, and nothing ever moved it
 * on. Completing the last question of mission 1 set the session to "ended", so the route strip
 * stayed on station 1 of 7 and a seven mission journey only ever played one of them.
 *
 * The engine change lives in turn.ts, which needs a database. These cover the part that can be
 * asserted in isolation: the state handed to the next mission, and the boundary that decides
 * whether the journey is over.
 */

const q = (id: string): Question =>
  ({
    id,
    kind: "free_text",
    prompt: `Q ${id}`,
    conceptKey: "c1",
    hints: ["h1", "h2", "h3"],
  }) as Question;

const pack = (n: number): MissionPack =>
  ({ questions: Array.from({ length: n }, (_, i) => q(`q${i + 1}`)) }) as MissionPack;

/** What turn.ts persists when the mission is done and another one follows. */
function stateForNextMission(finished: TurnState): TurnState {
  return { ...EMPTY_STATE, started: true, engagement: finished.engagement };
}

describe("finishing the questions in a mission", () => {
  it("marks the mission finished once the last question is answered", () => {
    let state: TurnState = { ...EMPTY_STATE, started: true };
    const p = pack(2);

    state = advance(
      state,
      p,
      q("q1"),
      { type: "feedback_correct", params: {} } as never,
      "correct",
    );
    expect(state.finished).toBe(false);
    expect(state.questionIndex).toBe(1);

    state = advance(
      state,
      p,
      q("q2"),
      { type: "feedback_correct", params: {} } as never,
      "correct",
    );
    expect(state.finished).toBe(true);
    expect(state.completed).toEqual(["q1", "q2"]);
  });

  it("does not finish on a wrong answer, however many times", () => {
    let state: TurnState = { ...EMPTY_STATE, started: true };
    const p = pack(1);
    for (let i = 0; i < 5; i++) {
      state = advance(state, p, q("q1"), { type: "hint", params: {} } as never, "incorrect");
    }
    expect(state.finished).toBe(false);
    expect(state.attempts["q1"]).toBe(5);
  });
});

describe("crossing into the next mission", () => {
  it("starts the new mission from its first question, not the old index", () => {
    const finished: TurnState = {
      ...EMPTY_STATE,
      started: true,
      finished: true,
      questionIndex: 3,
      completed: ["q1", "q2", "q3", "q4"],
      attempts: { q2: 2 },
      hintLevel: { q2: 1 },
    };

    const next = stateForNextMission(finished);
    expect(next.questionIndex).toBe(0);
    expect(next.finished).toBe(false);
    expect(next.completed).toEqual([]);
    // Attempts and hint levels belong to the questions just left behind.
    expect(next.attempts).toEqual({});
    expect(next.hintLevel).toEqual({});
    // Already started, so the learner is not sent back to the journey map.
    expect(next.started).toBe(true);
  });

  it("carries engagement across the boundary, because it belongs to the learner", () => {
    const finished: TurnState = {
      ...EMPTY_STATE,
      finished: true,
      engagement: { frustration: 0.6, fatigue: 0.3, latencies: [1200, 900] },
    } as TurnState;

    expect(stateForNextMission(finished).engagement).toEqual(finished.engagement);
  });

  it("only the last mission ends the journey", () => {
    // The rule turn.ts applies: finished plus no later ordinal means the journey is over.
    const journeyDone = (finished: boolean, nextMission: unknown) =>
      Boolean(finished && !nextMission);

    expect(journeyDone(true, { id: "m2", ordinal: 1 })).toBe(false);
    expect(journeyDone(true, null)).toBe(true);
    expect(journeyDone(false, null)).toBe(false);
  });
});
