import type { Config } from "../config/schema";

// BKT-style mastery with soft evidence. Pure functions; the
// evidence log is the source of truth and mastery is a replay of it.

export interface MasteryParams {
  /** Persona prior P0 (novice 0.15, intermediate 0.25, expert 0.35). */
  p0: number;
  /** Learning opportunity T. */
  transit: number;
  /** Slip s. */
  slip: number;
  bands: { developing: number; proficient: number; mastered: number };
  masteredMinEvents: number;
  masteredMinSignalTypes: number;
  masteredMinLower: number;
  /** Half-width constant k: h = k / sqrt(1 + n_eff). */
  bandK: number;
  forgetting: { enabled: boolean; halfLifeDays: number };
}

/** One evidence event as the update sees it. */
export interface MasteryEvent {
  /** Credit y in [0, 1]. */
  credit: number;
  /** Reliability weight w in [0, 1]. */
  weight: number;
  /** Guess probability g in (0, 1). */
  guess: number;
  signal: string;
  at?: Date;
}

export type Band = "not_yet" | "developing" | "proficient" | "mastered";

export interface MasteryState {
  p: number;
  nEvents: number;
  nEff: number;
  signalTypes: string[];
  band: Band;
  /** True from proficient up while the mastered evidence conditions are not yet met. */
  limitedEvidence: boolean;
  lower: number;
  upper: number;
  lastEvidenceAt: Date | null;
}

export function masteryParams(config: Config, p0: number): MasteryParams {
  const m = config.mastery;
  return {
    p0,
    transit: m.transit,
    slip: m.slip,
    bands: m.bands,
    masteredMinEvents: m.masteredMinEvents,
    masteredMinSignalTypes: m.masteredMinSignalTypes,
    masteredMinLower: m.masteredMinLower,
    bandK: m.bandK,
    forgetting: m.forgetting,
  };
}

const clip = (x: number) => Math.min(1, Math.max(0, x));

/** One event: P -> P_next. */
export function updateMastery(
  P: number,
  event: Pick<MasteryEvent, "credit" | "weight" | "guess">,
  params: Pick<MasteryParams, "slip" | "transit">,
): number {
  const p = clip(P);
  const y = clip(event.credit);
  const w = clip(event.weight);
  const g = Math.min(0.999, Math.max(0.001, event.guess));
  const s = params.slip;
  const denomC = p * (1 - s) + (1 - p) * g;
  const denomI = p * s + (1 - p) * (1 - g);
  const pC = denomC > 0 ? (p * (1 - s)) / denomC : p;
  const pI = denomI > 0 ? (p * s) / denomI : p;
  const pObs = y * pC + (1 - y) * pI;
  const pPost = w * pObs + (1 - w) * p;
  return clip(pPost + (1 - pPost) * params.transit * w);
}

/** Optional forgetting: decay toward P0 with the configured half-life. */
export function forget(P: number, p0: number, dtMs: number, halfLifeDays: number): number {
  if (dtMs <= 0) return P;
  const halfLifeMs = halfLifeDays * 86_400_000;
  return p0 + (P - p0) * Math.pow(2, -dtMs / halfLifeMs);
}

export function halfWidth(nEff: number, k: number): number {
  return k / Math.sqrt(1 + Math.max(0, nEff));
}

/** Band and the "limited evidence" flag for a state. */
export function bandOf(
  state: Pick<MasteryState, "p" | "nEvents" | "nEff" | "signalTypes">,
  params: Pick<
    MasteryParams,
    "bands" | "masteredMinEvents" | "masteredMinSignalTypes" | "masteredMinLower" | "bandK"
  >,
): { band: Band; limitedEvidence: boolean; lower: number; upper: number } {
  const h = halfWidth(state.nEff, params.bandK);
  const lower = clip(state.p - h);
  const upper = clip(state.p + h);
  const { p } = state;
  if (p < params.bands.developing) return { band: "not_yet", limitedEvidence: false, lower, upper };
  if (p < params.bands.proficient)
    return { band: "developing", limitedEvidence: false, lower, upper };
  // From proficient up the label says "limited evidence" until the mastered conditions hold
  // (worked example row 2: proficient at 0.75 with two events).
  const enough =
    state.nEvents >= params.masteredMinEvents &&
    new Set(state.signalTypes).size >= params.masteredMinSignalTypes &&
    lower >= params.masteredMinLower;
  if (p < params.bands.mastered)
    return { band: "proficient", limitedEvidence: !enough, lower, upper };
  return enough
    ? { band: "mastered", limitedEvidence: false, lower, upper }
    : { band: "proficient", limitedEvidence: true, lower, upper };
}

export function emptyMastery(p0: number, params: MasteryParams): MasteryState {
  return withBand(
    { p: clip(p0), nEvents: 0, nEff: 0, signalTypes: [], lastEvidenceAt: null },
    params,
  );
}

function withBand(
  s: Omit<MasteryState, "band" | "limitedEvidence" | "lower" | "upper">,
  params: MasteryParams,
): MasteryState {
  return { ...s, ...bandOf(s, params) };
}

/** Apply one event to a full state (what a turn does), never mutating the input. */
export function applyEvent(
  state: MasteryState,
  event: MasteryEvent,
  params: MasteryParams,
): MasteryState {
  let p = state.p;
  if (params.forgetting.enabled && event.at && state.lastEvidenceAt) {
    p = forget(
      p,
      params.p0,
      event.at.getTime() - state.lastEvidenceAt.getTime(),
      params.forgetting.halfLifeDays,
    );
  }
  const next = updateMastery(p, event, params);
  return withBand(
    {
      p: next,
      nEvents: state.nEvents + 1,
      nEff: state.nEff + clip(event.weight),
      signalTypes: state.signalTypes.includes(event.signal)
        ? state.signalTypes
        : [...state.signalTypes, event.signal],
      lastEvidenceAt: event.at ?? state.lastEvidenceAt,
    },
    params,
  );
}

/** Mastery is a replay of the evidence log in time order under one config. */
export function replayMastery(
  events: readonly MasteryEvent[],
  params: MasteryParams,
): MasteryState {
  const ordered = [...events].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  return ordered.reduce((s, e) => applyEvent(s, e, params), emptyMastery(params.p0, params));
}
