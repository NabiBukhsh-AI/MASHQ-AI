import { z } from "zod";
import type { Config } from "../config/schema";

// Per-session engagement state, updated on every learner action.
// Pure functions of (state, action, config); the turn stores the result in session state.

export const EngagementStateSchema = z.object({
  frustration: z.number().min(0).max(1),
  fatigue: z.number().min(0).max(1),
  /** Consecutive failed attempts (incorrect or "I don't know") on the current question. */
  streakWrong: z.number().int().min(0),
  /** Question id the streaks belong to. */
  streakQuestion: z.string().nullable(),
  /** Consecutive "I don't know" replies on the same question. */
  idkStreak: z.number().int().min(0),
  /** Response latencies in ms, oldest first (capped). */
  latencies: z.array(z.number()),
  /** Whether each of the last free-text answers was short (capped at 5). */
  shortFlags: z.array(z.boolean()),
  /** Consecutive typed turns while voice is on (modality suggestion). */
  typedWhileVoice: z.number().int().min(0),
  /** Time on task in ms: gaps between actions, each capped, plus idle nudges. */
  activeMs: z.number().min(0),
  lastActionAt: z.number().nullable(),
  /** Idle nudges received since the last real input. */
  idleCount: z.number().int().min(0),
});
export type EngagementState = z.infer<typeof EngagementStateSchema>;

export const EMPTY_ENGAGEMENT: EngagementState = {
  frustration: 0,
  fatigue: 0,
  streakWrong: 0,
  streakQuestion: null,
  idkStreak: 0,
  latencies: [],
  shortFlags: [],
  typedWhileVoice: 0,
  activeMs: 0,
  lastActionAt: null,
  idleCount: 0,
};

/** A stored state, or the empty one when the JSONB is missing or malformed. */
export function parseEngagement(raw: unknown): EngagementState {
  const parsed = EngagementStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_ENGAGEMENT;
}

export interface EngagementAction {
  /** Learner text (typed or transcribed); empty for taps and idle. */
  text?: string;
  mode: "text" | "voice" | "tap" | "drag" | "idle" | "start";
  verdict?: "correct" | "partial" | "incorrect" | "not_an_answer" | null;
  questionId?: string | null;
  /** Time the learner took to answer, if the client measured it. */
  latencyMs?: number;
  /** Voice mode is on for the session (for the modality suggestion). */
  voiceOn?: boolean;
  now?: number;
}

export interface EngagementSignals {
  idk: boolean;
  short: boolean;
  neg: boolean;
  streakWrong: number;
  idkStreak: number;
}

export type Pace = "slow" | "normal" | "fast";

type EngagementConfig = Config["engagement"];

const clip = (x: number) => Math.min(1, Math.max(0, x));
const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();

/** Pattern lists come from config in three languages; matching is a normalized substring test. */
export function matchesAny(text: string, patterns: readonly string[]): boolean {
  const t = norm(text);
  if (!t) return false;
  return patterns.some((p) => {
    const q = norm(p);
    return q.length > 0 && t.includes(q);
  });
}

export function detectSignals(
  state: EngagementState,
  action: EngagementAction,
  config: EngagementConfig,
): EngagementSignals {
  const text = action.text ?? "";
  const isFreeText = (action.mode === "text" || action.mode === "voice") && text.trim().length > 0;
  const idk = isFreeText && matchesAny(text, config.idkPatterns);
  const neg = isFreeText && matchesAny(text, config.frustrationPhrases);
  const short = isFreeText && text.trim().length < config.shortAnswerChars;
  const sameQuestion = action.questionId != null && action.questionId === state.streakQuestion;
  // "I don't know" is a failed attempt at the question, so it extends the wrong streak.
  const failed = action.verdict === "incorrect" || idk;
  const streakWrong = failed
    ? (sameQuestion ? state.streakWrong : 0) + 1
    : action.verdict === "correct" || action.verdict === "partial"
      ? 0
      : sameQuestion
        ? state.streakWrong
        : 0;
  const idkStreak = idk
    ? (sameQuestion ? state.idkStreak : 0) + 1
    : isFreeText || action.mode === "tap" || action.mode === "drag"
      ? 0
      : state.idkStreak;
  return { idk, short, neg, streakWrong, idkStreak };
}

function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** max(0, (median of last 3 - median of first 3) / median of first 3); 0 until enough samples exist. */
export function latencyTrend(latencies: readonly number[], minSamples: number): number {
  if (latencies.length < Math.max(2, minSamples)) return 0;
  const first = median(latencies.slice(0, 3));
  const last = median(latencies.slice(-3));
  if (first <= 0) return 0;
  return Math.max(0, (last - first) / first);
}

export function updateEngagement(
  state: EngagementState,
  action: EngagementAction,
  config: EngagementConfig,
): { state: EngagementState; signals: EngagementSignals } {
  const now = action.now ?? Date.now();
  const signals = detectSignals(state, action, config);
  const a = config.ewmaAlpha;
  const isInput = action.mode !== "idle" && action.mode !== "start";

  // Frustration, starting from F0 = 0. See engagementFlags for the repeated
  // "I don't know" trigger the policy reads alongside the threshold.
  const sig =
    0.35 * (signals.idk ? 1 : 0) +
    0.25 * (signals.streakWrong >= 2 ? 1 : 0) +
    0.2 * (signals.short ? 1 : 0) +
    0.2 * (signals.neg ? 1 : 0);
  const frustration = isInput ? clip(a * sig + (1 - a) * state.frustration) : state.frustration;

  // Time on task: the gap since the last action, capped so a break (resumed session, tea) is not
  // counted as work; an idle nudge counts as idleNudgeSeconds of sitting in front of the question.
  const gapCapMs = config.activeGapCapSeconds * 1000;
  const gapMs =
    isInput && state.lastActionAt !== null
      ? Math.min(gapCapMs, Math.max(0, now - state.lastActionAt))
      : 0;
  const idleMs = action.mode === "idle" ? config.idleNudgeSeconds * 1000 : 0;
  const activeMs = state.activeMs + gapMs + idleMs;

  const latencies =
    isInput && typeof action.latencyMs === "number" && action.latencyMs > 0
      ? [...state.latencies, action.latencyMs].slice(-30)
      : state.latencies;
  const isFreeText = action.mode === "text" || action.mode === "voice";
  const shortFlags = isFreeText ? [...state.shortFlags, signals.short].slice(-5) : state.shortFlags;
  const idleCount = action.mode === "idle" ? state.idleCount + 1 : isInput ? 0 : state.idleCount;
  const minutes = activeMs / 60_000;
  const shortRate = shortFlags.length ? shortFlags.filter(Boolean).length / shortFlags.length : 0;
  const fatigue = clip(
    0.5 * Math.min(1, minutes / 25) +
      0.3 * latencyTrend(latencies, config.latencyTrendMinSamples) +
      0.2 * shortRate,
  );

  const typedWhileVoice =
    action.mode === "text" && action.voiceOn
      ? state.typedWhileVoice + 1
      : action.mode === "voice"
        ? 0
        : state.typedWhileVoice;

  return {
    state: {
      frustration,
      fatigue,
      streakWrong: signals.streakWrong,
      streakQuestion: action.questionId ?? state.streakQuestion,
      idkStreak: signals.idkStreak,
      latencies,
      shortFlags,
      typedWhileVoice,
      activeMs,
      // Idle also advances the clock, so the next input's gap does not count the same seconds.
      lastActionAt: isInput || action.mode === "idle" ? now : state.lastActionAt,
      idleCount,
    },
    signals,
  };
}

/** Median response latency against the persona baseline; the ratios are config. */
export function paceOf(
  latencies: readonly number[],
  baselineMs: number,
  config: Pick<EngagementConfig, "paceSlowRatio" | "paceFastRatio">,
): Pace {
  if (latencies.length < 2 || baselineMs <= 0) return "normal";
  const m = median(latencies);
  if (m > baselineMs * config.paceSlowRatio) return "slow";
  if (m < baselineMs * config.paceFastRatio) return "fast";
  return "normal";
}

/**
 * What the policy reads. `frustrated` is true above the threshold or when the learner has said
 * "I don't know" twice in a row on the same question.
 */
export function engagementFlags(state: EngagementState, config: EngagementConfig) {
  const byThreshold = state.frustration >= config.frustrationThreshold;
  const byIdk = state.idkStreak >= config.idkRepeatTrigger;
  return {
    frustrated: byThreshold || byIdk,
    frustratedBy: byThreshold ? ("threshold" as const) : byIdk ? ("idk_repeat" as const) : null,
    fatigued: state.fatigue >= config.fatigueThreshold,
    suggestText: state.typedWhileVoice >= config.typedWhileVoiceTrigger,
  };
}
