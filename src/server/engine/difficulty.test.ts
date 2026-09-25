import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config/defaults";
import { MAX_LEVEL, MIN_LEVEL, nextDifficulty, startDifficulty, variantFor } from "./difficulty";

const config = DEFAULT_CONFIG;

describe("difficulty", () => {
  it("starts at the persona level, clamped to 1 to 5", () => {
    expect(startDifficulty({ startDifficulty: 3 }).level).toBe(3);
    expect(startDifficulty({ startDifficulty: 9 }).level).toBe(MAX_LEVEL);
    expect(startDifficulty({ startDifficulty: 0 }).level).toBe(MIN_LEVEL);
  });

  it("steps up after stepUpAfterCorrect consecutive correct answers, only from developing up", () => {
    let s = startDifficulty({ startDifficulty: 3 });
    s = nextDifficulty(s, "correct", config, "developing");
    expect(s.level).toBe(3);
    s = nextDifficulty(s, "correct", config, "developing");
    expect(s.level).toBe(4);
    expect(s.correctRun).toBe(0);
    // not yet: the run counts but the level holds
    let n = startDifficulty({ startDifficulty: 3 });
    n = nextDifficulty(n, "correct", config, "not_yet");
    n = nextDifficulty(n, "correct", config, "not_yet");
    expect(n.level).toBe(3);
  });

  it("steps down after stepDownAfterIncorrect consecutive incorrect answers; partial resets runs", () => {
    let s = startDifficulty({ startDifficulty: 3 });
    s = nextDifficulty(s, "incorrect", config);
    s = nextDifficulty(s, "partial", config);
    s = nextDifficulty(s, "incorrect", config);
    expect(s.level).toBe(3);
    s = nextDifficulty(s, "incorrect", config);
    expect(s.level).toBe(2);
  });

  it("never leaves 1 to 5; not_an_answer changes nothing", () => {
    let s = startDifficulty({ startDifficulty: 1 });
    for (let i = 0; i < 6; i++) s = nextDifficulty(s, "incorrect", config);
    expect(s.level).toBe(MIN_LEVEL);
    let t = startDifficulty({ startDifficulty: 5 });
    for (let i = 0; i < 6; i++) t = nextDifficulty(t, "correct", config, "proficient");
    expect(t.level).toBe(MAX_LEVEL);
    expect(nextDifficulty(t, "not_an_answer", config)).toEqual(t);
  });

  it("maps levels to pack variants", () => {
    expect(variantFor(1)).toBe("foundation");
    expect(variantFor(2)).toBe("foundation");
    expect(variantFor(3)).toBe("standard");
    expect(variantFor(4)).toBe("advanced");
    expect(variantFor(5)).toBe("advanced");
  });
});
