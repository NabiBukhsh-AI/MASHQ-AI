import { GradeLine } from "@/lib/schemas/turn-events";
import { buildEngineRequest, type HistoryTurn } from "@/server/engine/prompt";
import { parseTurnStream } from "@/server/engine/turnstream";
import { llm as defaultLlm, type Llm } from "@/server/llm/provider";
import type { Lang, Persona } from "@/server/config/schema";

export type Register = "colleague" | "formal";
export type SpeechMode = "none" | "mirror" | "normalize" | "llm";

export interface Verdict extends GradeLine {
  feedback?: string;
  kind?: string;
}

export interface QuestionLike {
  id?: string;
  conceptKey?: string;
  concept?: string;
  type?: string;
  kind?: string;
  correct?: unknown;
  options?: Array<{
    id: string;
    correct?: boolean;
    misconceptionId?: string | null;
    consequence?: string;
    label?: unknown;
  }> | null;
  sequence?: {
    steps?: Array<{ id: string; label?: unknown }>;
    correctOrder: string[];
  } | null;
  correctOrder?: string[];
  pairs?: Array<{ left: unknown; right: unknown }> | null;
  passage?: {
    sentences?: Array<{ id: string; text?: unknown }>;
    errorSentenceId: string;
    misconceptionId?: string | null;
  } | null;
  errorSentenceId?: string;
  misconceptionId?: string | null;
  lang?: Lang;
  [key: string]: unknown;
}

export interface ModelVerdictContext {
  session?: string;
  config?: { orgId?: string };
  pack?: {
    contentId?: string;
    chapterKey?: string;
    packHash?: string;
    outline?: string;
    characters?: string;
    glossary?: string;
    concepts?: string;
    facts?: string;
    misconceptions?: string;
    missions?: string;
    excerpts?: Array<{ chunkId: string; anchor: string; text: string; flagged?: boolean }>;
  };
  history?: HistoryTurn[];
  persona?: Persona | string;
  language?: Lang;
  register?: Register;
  speechMode?: SpeechMode;
  missionId?: string;
  missionTitle?: string;
  beat?: string;
  mechanic?: string;
  hintLevel?: number;
  attempts?: number;
  learnerState?: string;
  allowedFactIds?: string[];
  excerptsForThisTurn?: string;
  inputMode?: "text" | "voice";
  detectedLang?: string;
  deploymentId?: string;
}

export interface ModelVerdictDeps {
  llm?: Pick<Llm, "stream">;
}

/**
 * Calculates normalized Kendall tau distance score in [0, 1].
 * Exact match gives 1.0.
 * Inverted match gives 0.0.
 * Partial swaps give credit proportional to concordant pairs.
 */
export function kendallTauScore(correctOrder: string[], answerOrder: string[]): number {
  if (!Array.isArray(correctOrder) || !Array.isArray(answerOrder)) {
    return 0;
  }
  const n = correctOrder.length;
  if (n <= 1) {
    if (n === 0) return 1;
    return answerOrder.length === 1 && answerOrder[0] === correctOrder[0] ? 1 : 0;
  }

  const totalPairs = (n * (n - 1)) / 2;
  const answerIndices = new Map<string, number>();
  for (let i = 0; i < answerOrder.length; i++) {
    const item = answerOrder[i];
    if (item !== undefined && !answerIndices.has(item)) {
      answerIndices.set(item, i);
    }
  }

  let concordant = 0;
  for (let i = 0; i < n; i++) {
    const itemA = correctOrder[i];
    if (itemA === undefined) continue;
    const posA = answerIndices.get(itemA);
    if (posA === undefined) continue;

    for (let j = i + 1; j < n; j++) {
      const itemB = correctOrder[j];
      if (itemB === undefined) continue;
      const posB = answerIndices.get(itemB);
      if (posB === undefined) continue;

      if (posA < posB) {
        concordant++;
      }
    }
  }

  return Math.max(0, Math.min(1, concordant / totalPairs));
}

/**
 * Normalizes a pair element (string, number, or object with id/en) to a string representation.
 */
function normalizePairItem(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj.en === "string") return obj.en;
    return JSON.stringify(val);
  }
  return String(val);
}

/**
 * Scores a match question by calculating the share of correct pairs.
 */
function scoreMatchQuestion(
  question: QuestionLike,
  answer: unknown,
): { score: number; verdict: "correct" | "partial" | "incorrect" } {
  // Case 1: question.pairs array
  if (Array.isArray(question.pairs) && question.pairs.length > 0) {
    const total = question.pairs.length;
    let correctCount = 0;

    if (answer && typeof answer === "object" && !Array.isArray(answer)) {
      const ansMap = answer as Record<string, unknown>;
      for (const pair of question.pairs) {
        const leftKey = normalizePairItem(pair.left);
        const rightExpected = normalizePairItem(pair.right);
        if (normalizePairItem(ansMap[leftKey]) === rightExpected) {
          correctCount++;
        }
      }
    } else if (Array.isArray(answer)) {
      for (const pair of question.pairs) {
        const leftKey = normalizePairItem(pair.left);
        const rightExpected = normalizePairItem(pair.right);
        const matched = answer.some((ansItem: unknown) => {
          if (Array.isArray(ansItem)) {
            return (
              normalizePairItem(ansItem[0]) === leftKey &&
              normalizePairItem(ansItem[1]) === rightExpected
            );
          }
          if (ansItem && typeof ansItem === "object") {
            const item = ansItem as Record<string, unknown>;
            return (
              normalizePairItem(item.left) === leftKey &&
              normalizePairItem(item.right) === rightExpected
            );
          }
          return false;
        });
        if (matched) correctCount++;
      }
    }

    const score = Math.round((correctCount / total) * 1000) / 1000;
    const verdict = score === 1 ? "correct" : score > 0 ? "partial" : "incorrect";
    return { score, verdict };
  }

  // Case 2: question.correct is a record / map of left -> right
  if (
    question.correct &&
    typeof question.correct === "object" &&
    !Array.isArray(question.correct)
  ) {
    const correctMap = question.correct as Record<string, unknown>;
    const keys = Object.keys(correctMap);
    const total = keys.length;
    if (total === 0) return { score: 1, verdict: "correct" };

    const answerMap =
      answer && typeof answer === "object" && !Array.isArray(answer)
        ? (answer as Record<string, unknown>)
        : {};

    let correctCount = 0;
    for (const k of keys) {
      if (String(answerMap[k]) === String(correctMap[k])) {
        correctCount++;
      }
    }

    const score = Math.round((correctCount / total) * 1000) / 1000;
    const verdict = score === 1 ? "correct" : score > 0 ? "partial" : "incorrect";
    return { score, verdict };
  }

  return { score: 0, verdict: "incorrect" };
}

/**
 * Evaluates deterministic answer keys for choice, sequence, match, and spot-the-error mechanics.
 */
export function keyVerdict(question: QuestionLike, answer: unknown): Verdict {
  const qId = question.id || "q1";
  const cId = question.conceptKey || question.concept || "concept";
  const kind = question.kind || question.type;

  let score = 0;
  let verdict: "correct" | "partial" | "incorrect" | "not_an_answer" = "incorrect";
  let misconception: string | null = null;
  let feedback = "Incorrect.";

  const isSequence =
    kind === "sequence" ||
    Boolean(question.sequence) ||
    Array.isArray(question.correctOrder) ||
    (Array.isArray(question.correct) && Array.isArray(answer));

  const isMatch =
    kind === "match" ||
    Boolean(question.pairs) ||
    (Boolean(question.correct) &&
      typeof question.correct === "object" &&
      !Array.isArray(question.correct) &&
      answer !== null &&
      typeof answer === "object" &&
      !Array.isArray(answer));

  const isSpotError =
    kind === "spot_error" ||
    kind === "spot-the-error" ||
    Boolean(question.passage?.errorSentenceId) ||
    Boolean(question.errorSentenceId);

  if (isSequence) {
    const correctOrder =
      question.sequence?.correctOrder ??
      question.correctOrder ??
      (Array.isArray(question.correct) ? (question.correct as string[]) : []);

    const answerOrder = Array.isArray(answer) ? answer.map(String) : [];
    score = kendallTauScore(correctOrder, answerOrder);
    score = Math.round(score * 1000) / 1000;

    const isExact =
      answerOrder.length === correctOrder.length &&
      answerOrder.every((val, idx) => val === correctOrder[idx]);

    if (isExact && score === 1) {
      verdict = "correct";
      feedback = "All steps placed in the correct sequence.";
    } else if (score > 0) {
      verdict = "partial";
      feedback = "Partially correct sequence order.";
    } else {
      verdict = "incorrect";
      feedback = "Sequence order is incorrect.";
    }
  } else if (isMatch) {
    const matchResult = scoreMatchQuestion(question, answer);
    score = matchResult.score;
    verdict = matchResult.verdict;
    feedback =
      verdict === "correct"
        ? "All pairs matched correctly."
        : verdict === "partial"
          ? "Some pairs matched correctly."
          : "Matches are incorrect.";
  } else if (isSpotError) {
    const targetId =
      question.passage?.errorSentenceId ??
      question.errorSentenceId ??
      (typeof question.correct === "string" ? question.correct : undefined);

    const targetMisconception =
      question.passage?.misconceptionId ?? question.misconceptionId ?? null;

    const chosenId = typeof answer === "string" ? answer : String(answer ?? "");

    if (targetId && chosenId === targetId) {
      score = 1;
      verdict = "correct";
      feedback = "Error identified correctly.";
    } else {
      score = 0;
      verdict = "incorrect";
      misconception = targetMisconception;
      feedback = "Identified sentence does not contain the target error.";
    }
  } else {
    // Choice / decision question
    const ansStr = typeof answer === "string" ? answer : String(answer ?? "");

    if (Array.isArray(question.options) && question.options.length > 0) {
      const selectedOption = question.options.find(
        (opt) =>
          opt.id === ansStr ||
          (opt.label &&
            typeof opt.label === "object" &&
            (opt.label as Record<string, unknown>).en === ansStr),
      );

      if (selectedOption?.correct) {
        score = 1;
        verdict = "correct";
        feedback = selectedOption.consequence || "Correct answer.";
      } else {
        score = 0;
        verdict = "incorrect";
        misconception = selectedOption?.misconceptionId ?? null;
        feedback = selectedOption?.consequence || "Incorrect answer.";
      }
    } else if (question.correct !== undefined) {
      if (ansStr === String(question.correct)) {
        score = 1;
        verdict = "correct";
        feedback = "Correct answer.";
      } else {
        score = 0;
        verdict = "incorrect";
        feedback = "Incorrect answer.";
      }
    }
  }

  const lang = (question.lang as Lang) || "en";
  const validLang: "en" | "ur" | "ur-Latn" | "mixed" =
    lang === "en" || lang === "ur" || lang === "ur-Latn" || lang === "mixed" ? lang : "en";

  return {
    verdict,
    score,
    question: qId,
    concept: cId,
    misconception,
    self_correction: false,
    help_request: false,
    out_of_source: false,
    lang: validLang,
    confidence_cue: "none",
    feedback,
    kind: kind ? String(kind) : undefined,
  };
}

/**
 * Executes a model grading turn in separate mode using the shared engine prefix.
 * Validates the @@g output against GradeLine, retrying once on malformed output,
 * and falls back cleanly to not_an_answer.
 */
export async function modelVerdict(
  question: QuestionLike,
  answer: unknown,
  context?: ModelVerdictContext,
  deps?: ModelVerdictDeps,
): Promise<Verdict> {
  const qId = question.id || "q1";
  const cId = question.conceptKey || question.concept || "concept";
  const lang = context?.language || (question.lang as Lang) || "en";
  const validLang: "en" | "ur" | "ur-Latn" | "mixed" =
    lang === "en" || lang === "ur" || lang === "ur-Latn" || lang === "mixed" ? lang : "en";

  const fallbackVerdict: Verdict = {
    verdict: "not_an_answer",
    question: qId,
    concept: cId,
    misconception: null,
    score: 0,
    self_correction: false,
    help_request: false,
    out_of_source: false,
    lang: validLang,
    confidence_cue: "none",
    feedback: "Unable to grade answer. Please clarify.",
    kind: question.kind ? String(question.kind) : undefined,
  };

  const llmClient = deps?.llm ?? defaultLlm;
  const learnerInput = typeof answer === "string" ? answer : JSON.stringify(answer ?? "");

  const personaStr = typeof context?.persona === "string" ? context.persona : context?.persona?.id;

  const engineReq = buildEngineRequest({
    task: "GRADE",
    session: context?.session,
    config: context?.config,
    pack: context?.pack,
    history: context?.history,
    persona: personaStr,
    language: validLang,
    register: context?.register,
    speechMode: context?.speechMode,
    missionId: context?.missionId,
    missionTitle: context?.missionTitle,
    beat: context?.beat,
    mechanic: context?.mechanic,
    questionId: qId,
    attempts: context?.attempts,
    hintLevel: context?.hintLevel,
    allowedFactIds: context?.allowedFactIds,
    excerptsForThisTurn: context?.excerptsForThisTurn,
    learnerInput,
    deploymentId: context?.deploymentId,
  });

  const runAttempt = async (): Promise<Verdict | null> => {
    try {
      const handle = await llmClient.stream(
        "turn.grade",
        {
          system: engineReq.system,
          packBlocks: [engineReq.packBlock],
          history: (engineReq.history || []).map((h) => ({
            role: h.role,
            text: h.content,
          })),
          final: engineReq.final,
          orgId: engineReq.orgId,
          sessionId: engineReq.sessionId,
          contentId: engineReq.contentId,
          lang: validLang,
        },
        {},
      );

      for await (const event of parseTurnStream(handle.textStream)) {
        if (event.type === "verdict") {
          const parsed = GradeLine.safeParse(event.data);
          if (parsed.success) {
            return {
              ...parsed.data,
              kind: question.kind ? String(question.kind) : undefined,
            };
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  // Attempt 1
  const result1 = await runAttempt();
  if (result1) {
    return result1;
  }

  // Attempt 2: one retry for @@g in separate mode
  const result2 = await runAttempt();
  if (result2) {
    return result2;
  }

  // Fallback to not_an_answer
  return fallbackVerdict;
}
