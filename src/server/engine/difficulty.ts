import type { Config, Persona } from "../config/schema";
import type { Band } from "./mastery";

// Difficulty 1 to 5 per learner and concept. Step up after
// `stepUpAfterCorrect` consecutive correct answers while the band is at least developing;
// step down after `stepDownAfterIncorrect` consecutive incorrect answers. Packs carry
// foundation (1, 2), standard (3) and advanced (4, 5) variants, so no regeneration.

export interface DifficultyState {
  level: number;
  correctRun: number;
  incorrectRun: number;
}

export type Variant = "foundation" | "standard" | "advanced";

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

export function startDifficulty(persona: Pick<Persona, "startDifficulty">): DifficultyState {
  return { level: clampLevel(persona.startDifficulty), correctRun: 0, incorrectRun: 0 };
}

const clampLevel = (n: number) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(n)));

export function nextDifficulty(
  state: DifficultyState,
  verdict: "correct" | "partial" | "incorrect" | "not_an_answer",
  config: Pick<Config, "difficulty">,
  band: Band = "not_yet",
): DifficultyState {
  if (verdict === "not_an_answer") return state;
  if (verdict === "partial") return { ...state, correctRun: 0, incorrectRun: 0 };
  if (verdict === "correct") {
    const run = state.correctRun + 1;
    const canStepUp = band !== "not_yet" && run >= config.difficulty.stepUpAfterCorrect;
    return canStepUp
      ? { level: clampLevel(state.level + 1), correctRun: 0, incorrectRun: 0 }
      : { ...state, correctRun: run, incorrectRun: 0 };
  }
  const run = state.incorrectRun + 1;
  return run >= config.difficulty.stepDownAfterIncorrect
    ? { level: clampLevel(state.level - 1), correctRun: 0, incorrectRun: 0 }
    : { ...state, correctRun: 0, incorrectRun: run };
}

/** Which pack variant a level plays. */
export function variantFor(level: number): Variant {
  const l = clampLevel(level);
  if (l <= 2) return "foundation";
  if (l === 3) return "standard";
  return "advanced";
}
