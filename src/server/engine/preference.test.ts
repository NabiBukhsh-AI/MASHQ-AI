import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config/defaults";
import {
  beatReward,
  chooseMechanic,
  EMPTY_PREFERENCE,
  meanReward,
  recordBeat,
  scoreMechanics,
  TIE_BREAK,
} from "./preference";

const config = DEFAULT_CONFIG;
const persona = config.personas[0]!;

describe("mechanic preference", () => {
  it("beat reward: half for engagement, half for a mastery gain above 0.05", () => {
    expect(beatReward(true, 0.1)).toBe(1);
    expect(beatReward(true, 0.02)).toBe(0.5);
    expect(beatReward(false, 0.2)).toBe(0.5);
    expect(beatReward(false, 0)).toBe(0);
  });

  it("Beta counts: mean starts at 0.5 and moves with rewards", () => {
    expect(meanReward(EMPTY_PREFERENCE, "puzzle")).toBe(0.5);
    const liked = recordBeat(recordBeat(EMPTY_PREFERENCE, "puzzle", 1), "puzzle", 1);
    const disliked = recordBeat(recordBeat(EMPTY_PREFERENCE, "puzzle", 0), "puzzle", 0);
    expect(meanReward(liked, "puzzle")).toBe(0.75);
    expect(meanReward(disliked, "puzzle")).toBe(0.25);
    expect(EMPTY_PREFERENCE.beats).toEqual({});
  });

  it("choice is deterministic for equal inputs and follows the fixed tie-break order", () => {
    const a = chooseMechanic(EMPTY_PREFERENCE, persona, config);
    const b = chooseMechanic({ rewards: {}, beats: {}, recent: [] }, persona, config);
    expect(a).toBe(b);
    // With all weights equal the first enabled mechanic in TIE_BREAK wins.
    const flat = {
      ...persona,
      mechanicWeights: Object.fromEntries(
        TIE_BREAK.map((m) => [m, 1]),
      ) as typeof persona.mechanicWeights,
    };
    const flatConfig = {
      mechanics: {
        ...config.mechanics,
        weights: Object.fromEntries(
          TIE_BREAK.map((m) => [m, 1]),
        ) as typeof config.mechanics.weights,
      },
    };
    expect(chooseMechanic(EMPTY_PREFERENCE, flat, flatConfig)).toBe(TIE_BREAK[0]);
  });

  it("rewards raise a mechanic's score; repeats beyond maxRepeat push it down", () => {
    const base = scoreMechanics(EMPTY_PREFERENCE, persona, config);
    const liked = recordBeat(recordBeat(EMPTY_PREFERENCE, "puzzle", 1), "puzzle", 1);
    // Same recency, better history: the score rises.
    expect(scoreMechanics({ ...liked, recent: [] }, persona, config).puzzle).toBeGreaterThan(
      base.puzzle,
    );
    // Two puzzles in a row (maxRepeat 2): the penalty saturates and something else is chosen.
    const repeated = { ...liked, recent: ["puzzle", "puzzle"] as const };
    expect(chooseMechanic({ ...repeated, recent: [...repeated.recent] }, persona, config)).not.toBe(
      "puzzle",
    );
  });

  it("disabled mechanics are never chosen; all disabled gives null", () => {
    const onlyTeach = {
      mechanics: {
        ...config.mechanics,
        enabled: {
          ...config.mechanics.enabled,
          scenario: false,
          roleplay: false,
          puzzle: false,
          decision: false,
          final_challenge: false,
        },
      },
    };
    expect(chooseMechanic(EMPTY_PREFERENCE, persona, onlyTeach)).toBe("teach_back");
    const none = {
      mechanics: {
        ...config.mechanics,
        enabled: Object.fromEntries(
          TIE_BREAK.map((m) => [m, false]),
        ) as typeof config.mechanics.enabled,
      },
    };
    expect(chooseMechanic(EMPTY_PREFERENCE, persona, none)).toBeNull();
  });
});
