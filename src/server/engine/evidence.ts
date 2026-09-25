import type { Config } from "../config/schema";
import { updateMastery } from "./mastery";

/**
 * Evidence signal types.
 */
export type EvidenceSignal =
  | "choice"
  | "puzzle"
  | "decision"
  | "free_text"
  | "explanation"
  | "application"
  | "teach_back"
  | "retention"
  | "question";

export type EvidenceSource = "key" | "inline" | "grader" | "extractor" | "seed";

export interface EvidenceVerdictInput {
  verdict: "correct" | "partial" | "incorrect" | "not_an_answer" | string;
  score?: number;
  self_correction?: boolean;
  help_request?: boolean;
  misconception?: string | null;
  confidence_cue?: string;
  lang?: string;
}

export interface EvidenceContext {
  userId: string;
  orgId: string;
  sessionId?: string;
  turnId?: string;
  conceptId: string;
  missionId?: string;
  questionId?: string;
  signal: EvidenceSignal | string;
  numOptions?: number;
  hintLevel?: number;
  isWorkedExample?: boolean;
  latencyMs?: number;
  lang?: string;
  modality?: string;
  isRetention?: boolean;
  callbackDelayMinutes?: number;
  isNextDay?: boolean;
  pBefore?: number;
  pAfter?: number;
  personaId?: string;
  source?: EvidenceSource;
}

export interface EvidenceEventInput {
  orgId: string;
  userId: string;
  sessionId?: string;
  turnId?: string;
  conceptId: string;
  missionId?: string;
  questionId?: string;
  signal: string;
  verdict: string;
  score: number;
  hintLevel: number;
  latencyMs?: number;
  selfCorrected: boolean;
  confidence?: string;
  lang?: string;
  modality?: string;
  misconceptionId?: string | null;
  weight: number;
  credit: number;
  guess: number;
  pBefore: number;
  pAfter: number;
  source: EvidenceSource;
}

const DEFAULT_WEIGHTS: Record<EvidenceSignal, number> = {
  choice: 0.5,
  puzzle: 0.6,
  decision: 0.7,
  free_text: 0.7,
  explanation: 0.9,
  application: 0.9,
  teach_back: 0.9,
  retention: 0.8,
  question: 0.0,
};

const DEFAULT_GUESS: Record<EvidenceSignal, number> = {
  choice: 0.25,
  puzzle: 0.1,
  decision: 0.2,
  free_text: 0.15,
  explanation: 0.05,
  application: 0.1,
  teach_back: 0.05,
  retention: 0.15,
  question: 0.0,
};

/**
 * Calculates guess probability g for a given signal and question configuration.
 */
export function getSignalGuess(
  signal: string,
  numOptions?: number,
  config?: Partial<Config>,
): number {
  if (signal === "choice") {
    const minChoice = config?.evidence?.guess?.choiceMin ?? 0.2;
    if (numOptions && numOptions > 0) {
      return Math.max(minChoice, 1 / numOptions);
    }
    return minChoice;
  }

  const guessMap = config?.evidence?.guess as Record<string, number> | undefined;
  if (guessMap && typeof guessMap[signal] === "number") {
    return guessMap[signal];
  }

  return DEFAULT_GUESS[signal as EvidenceSignal] ?? 0.15;
}

/**
 * Calculates reliability weight w for a signal including retention boosts.
 */
export function getSignalWeight(
  signal: string,
  context: Partial<EvidenceContext>,
  config?: Partial<Config>,
): number {
  const weightsMap = config?.evidence?.weights as Record<string, number> | undefined;
  let baseWeight =
    weightsMap && typeof weightsMap[signal] === "number"
      ? weightsMap[signal]
      : (DEFAULT_WEIGHTS[signal as EvidenceSignal] ?? 0.7);

  // Retention boost
  const isRetention = signal === "retention" || Boolean(context.isRetention);
  if (isRetention) {
    const minDelay = config?.evidence?.retentionBoost?.minDelayMinutes ?? 8;
    const delay = context.callbackDelayMinutes ?? 0;

    if (context.isNextDay) {
      const nextDayBoost = config?.evidence?.retentionBoost?.nextDay ?? 1.3;
      baseWeight = Math.min(1.0, baseWeight * nextDayBoost);
    } else if (delay >= minDelay) {
      const sameSessionBoost = config?.evidence?.retentionBoost?.sameSession ?? 1.15;
      baseWeight = Math.min(1.0, baseWeight * sameSessionBoost);
    }
  }

  return Math.max(0, Math.min(1, baseWeight));
}

/**
 * Calculates credit y [0, 1]:
 * - Base: correct 1.0; partial rubric score (default 0.5); incorrect 0.0.
 * - Hint discount: y = y * (1 - d[h]) for levels 0 to 3.
 * - Self-correction without a new hint: y = max(y, 0.70).
 */
export function calculateCredit(
  verdict: EvidenceVerdictInput,
  context: Partial<EvidenceContext>,
  config?: Partial<Config>,
): number {
  let y = 0.0;
  const v = verdict.verdict;

  if (v === "correct") {
    y = 1.0;
  } else if (v === "partial") {
    const defaultPartial = config?.evidence?.partialDefault ?? 0.5;
    y = typeof verdict.score === "number" ? verdict.score : defaultPartial;
  } else {
    y = 0.0;
  }

  // Apply hint discount
  const discounts = config?.evidence?.hintDiscount ?? [0, 0.3, 0.55, 0.8];
  let h = context.isWorkedExample ? 3 : (context.hintLevel ?? 0);
  h = Math.min(Math.max(0, h), 3);
  const discount = discounts[h] ?? 0;
  y = y * (1 - discount);

  // Self-correction floor
  if (verdict.self_correction) {
    const selfCorrectionFloor = config?.evidence?.selfCorrectionCredit ?? 0.7;
    y = Math.max(y, selfCorrectionFloor);
  }

  return Math.max(0, Math.min(1, y));
}

/** One BKT step; the formula lives in mastery.ts. */
export function computeBktUpdate(
  pBefore: number,
  credit: number,
  weight: number,
  guess: number,
  slip: number = 0.1,
  transit: number = 0.08,
): number {
  return updateMastery(pBefore, { credit, weight, guess }, { slip, transit });
}

/**
 * Builds a typed EvidenceEventInput record.
 */
export function buildEvidence(
  verdict: EvidenceVerdictInput,
  context: EvidenceContext,
  config?: Partial<Config>,
): EvidenceEventInput {
  const credit = calculateCredit(verdict, context, config);
  const weight = getSignalWeight(context.signal, context, config);
  const guess = getSignalGuess(context.signal, context.numOptions, config);
  const slip = config?.mastery?.slip ?? 0.1;
  const transit = config?.mastery?.transit ?? 0.08;

  const pBefore =
    typeof context.pBefore === "number" ? Math.max(0, Math.min(1, context.pBefore)) : 0.2; // default intermediate prior

  const pAfter =
    typeof context.pAfter === "number"
      ? Math.max(0, Math.min(1, context.pAfter))
      : computeBktUpdate(pBefore, credit, weight, guess, slip, transit);

  const score =
    typeof verdict.score === "number"
      ? Math.max(0, Math.min(1, verdict.score))
      : verdict.verdict === "correct"
        ? 1.0
        : verdict.verdict === "partial"
          ? 0.5
          : 0.0;

  return {
    orgId: context.orgId,
    userId: context.userId,
    sessionId: context.sessionId,
    turnId: context.turnId,
    conceptId: context.conceptId,
    missionId: context.missionId,
    questionId: context.questionId,
    signal: context.signal,
    verdict: verdict.verdict,
    score,
    hintLevel: context.isWorkedExample ? 3 : (context.hintLevel ?? 0),
    latencyMs: context.latencyMs,
    selfCorrected: Boolean(verdict.self_correction),
    confidence: verdict.confidence_cue,
    lang: context.lang ?? verdict.lang,
    modality: context.modality ?? "text",
    misconceptionId: verdict.misconception ?? null,
    weight,
    credit,
    guess,
    pBefore,
    pAfter,
    source: context.source ?? "inline",
  };
}
