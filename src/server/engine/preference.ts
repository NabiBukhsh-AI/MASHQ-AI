import { Mechanic, type Config, type Persona } from "../config/schema";

// Mechanic preference: Beta counts per mechanic from beat rewards,
// scored against config and persona weights with a repeat penalty and a fixed tie-break.

export type MechanicId = Mechanic;

export interface PreferenceState {
  /** Sum of rewards per mechanic (alpha = 1 + this). */
  rewards: Partial<Record<MechanicId, number>>;
  /** Number of completed beats per mechanic (beta = 1 + beats - rewards). */
  beats: Partial<Record<MechanicId, number>>;
  /** Most recent mechanics, newest last (capped). */
  recent: MechanicId[];
}

export const EMPTY_PREFERENCE: PreferenceState = { rewards: {}, beats: {}, recent: [] };

/** Fixed order for argmax ties, so equal inputs always give the same mechanic. */
export const TIE_BREAK: readonly MechanicId[] = Mechanic.options;

/** Reward for a completed beat: r = 0.5 * engagedOk + 0.5 * [mastery gain > 0.05]. */
export function beatReward(engagedOk: boolean, masteryGain: number): number {
  return 0.5 * (engagedOk ? 1 : 0) + 0.5 * (masteryGain > 0.05 ? 1 : 0);
}

export function recordBeat(
  state: PreferenceState,
  mechanic: MechanicId,
  reward: number,
): PreferenceState {
  const r = Math.min(1, Math.max(0, reward));
  return {
    rewards: { ...state.rewards, [mechanic]: (state.rewards[mechanic] ?? 0) + r },
    beats: { ...state.beats, [mechanic]: (state.beats[mechanic] ?? 0) + 1 },
    recent: [...state.recent, mechanic].slice(-10),
  };
}

/** Posterior mean of the Beta(1 + sum r, 1 + sum (1 - r)) for a mechanic. */
export function meanReward(state: PreferenceState, mechanic: MechanicId): number {
  const r = state.rewards[mechanic] ?? 0;
  const n = state.beats[mechanic] ?? 0;
  const alpha = 1 + r;
  const beta = 1 + (n - r);
  return alpha / (alpha + beta);
}

/** How many of the last `maxRepeat` beats used this mechanic: the penalty grows per repeat. */
function repeatPenalty(
  state: PreferenceState,
  mechanic: MechanicId,
  config: Pick<Config, "mechanics">,
): number {
  const { maxRepeat, repeatPenalty: perRepeat } = config.mechanics;
  const window = state.recent.slice(-maxRepeat);
  const repeats = window.filter((m) => m === mechanic).length;
  return repeats >= maxRepeat ? 1 : repeats * perRepeat;
}

/**
 * score_m = w_config(m) * w_persona(m) * (0.5 + mean_m) - repeatPenalty(m).
 * Disabled mechanics score minus infinity. Deterministic for equal inputs.
 */
export function scoreMechanics(
  state: PreferenceState,
  persona: Pick<Persona, "mechanicWeights">,
  config: Pick<Config, "mechanics">,
): Record<MechanicId, number> {
  const out = {} as Record<MechanicId, number>;
  for (const m of TIE_BREAK) {
    if (!config.mechanics.enabled[m]) {
      out[m] = Number.NEGATIVE_INFINITY;
      continue;
    }
    const wc = config.mechanics.weights[m] ?? 0;
    const wp = persona.mechanicWeights[m] ?? 0;
    out[m] = wc * wp * (0.5 + meanReward(state, m)) - repeatPenalty(state, m, config);
  }
  return out;
}

/** The mechanic to play next: argmax with the fixed tie-break order; null when all are disabled. */
export function chooseMechanic(
  state: PreferenceState,
  persona: Pick<Persona, "mechanicWeights">,
  config: Pick<Config, "mechanics">,
  candidates: readonly MechanicId[] = TIE_BREAK,
): MechanicId | null {
  const scores = scoreMechanics(state, persona, config);
  let best: MechanicId | null = null;
  for (const m of TIE_BREAK) {
    if (!candidates.includes(m)) continue;
    const s = scores[m];
    if (!Number.isFinite(s)) continue;
    if (best === null || s > scores[best]) best = m;
  }
  return best;
}
