import { db as defaultDb, type Db } from "../db/client";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import type { Config } from "../config/schema";
import { retrieve, isInSource, type RetrievedChunk } from "./hybrid";
import { rewriteQuery, type GlossaryEntry, type RewrittenQuery } from "./rewrite";

// In-turn retrieval for questions outside the mission.
// Detects questions in English, Urdu (Arabic script), and Roman Urdu.
// Retrieves scoped chunks with cross-lingual query rewrite.

const QUESTION_MARK_REGEX = /[?؟]/;

// English interrogatives at sentence start (when no question mark is present)
const EN_WH_START_REGEX =
  /^(?:(?:hi|hello|please|sir|madam|dear|assalam(?:\s+o\s+alaikum)?)[,.]?\s*)?(?:what|what's|whats|why|how|how's|when|when's|where|where's|who|who's|whom|whose|which)\b/i;
const EN_AUX_START_REGEX =
  /^(?:(?:hi|hello|please|sir|madam|dear|assalam(?:\s+o\s+alaikum)?)[,.]?\s*)?(?:can|could|would|should|is|are|am|do|does|did|may|might|will|shall|have|has|had)\b/i;
const EN_PHRASE_REGEX =
  /\b(?:tell me|can you tell|could you tell|i have a question|wondering if|do you know)\b/i;

// Urdu script interrogatives
const UR_WORDS = [
  "کیا", // kya
  "کیوں", // kyun
  "کیسے", // kaise
  "کیسی", // kaisi
  "کیسا", // kaisa
  "کب", // kab
  "کہاں", // kahan
  "کون", // kaun
  "کونسا", // kaunsa
  "کونسی", // kaunsi
  "کونسے", // kaunse
  "کس", // kis
  "کسے", // kise
  "کس کو", // kisko
  "کس کا", // kiska
  "کس کی", // kiski
  "کس کے", // kiske
  "کتنا", // kitna
  "کتنی", // kitni
  "کتنے", // kitne
  "آیا", // aaya
  "بتائیں", // bataen
  "بتائیے", // bataiye
  "بتا سکتے", // bata sakte
];
const UR_REGEX = new RegExp(`(?:^|\\s)(?:${UR_WORDS.join("|")})(?:\\s|$)`, "u");

// Roman Urdu interrogatives
const ROMAN_UR_REGEX =
  /\b(?:kya|kiya|kyaa|kyun|kyu|kiun|kaise|kese|kesy|kaisa|kaisi|kab|kahan|khan|kaha|kon|koun|konsa|konsi|konse|kis|kise|kisko|kiska|kiski|kiske|kitna|kitni|kitne|batao|bataen|batayein|bataiye|bata do|bata sakte|bata sakty)\b/i;

/**
 * Detects whether a learner input is a question in English, Urdu, or Roman Urdu.
 */
export function isLearnerQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Question mark in Latin or Arabic script
  if (QUESTION_MARK_REGEX.test(trimmed)) return true;

  // English Wh-words or auxiliaries at start of utterance, or explicit request phrases
  if (EN_WH_START_REGEX.test(trimmed)) return true;
  if (EN_AUX_START_REGEX.test(trimmed)) return true;
  if (EN_PHRASE_REGEX.test(trimmed)) return true;

  // Urdu script interrogatives
  if (UR_REGEX.test(trimmed)) return true;

  // Roman Urdu interrogatives
  if (ROMAN_UR_REGEX.test(trimmed)) return true;

  return false;
}

export interface InTurnRetrievalParams {
  text: string;
  orgId: string;
  contentId: string;
  sessionId?: string;
  glossary: GlossaryEntry[];
  retrievalConfig: Config["grounding"]["retrieval"];
}

export interface InTurnRetrievalResult {
  isQuestion: boolean;
  retrievalRan: boolean;
  inSource: boolean;
  rewrittenQuery?: RewrittenQuery;
  chunks: RetrievedChunk[];
  excerptsForThisTurn?: string;
  excerptTexts: string[];
  latencyMs: number;
}

/**
 * Executes the in-turn retrieval pipeline:
 * 1. Checks if the learner input is a question.
 * 2. Rewrites the query across languages (glossary first, fast tier fallback).
 * 3. Runs scoped hybrid retrieval on content_chunks.
 * 4. Determines whether retrieved chunks meet the in-source threshold.
 * 5. Formats excerpts for inclusion in the un-cached final message.
 */
export async function runInTurnRetrieval(
  params: InTurnRetrievalParams,
  deps: {
    db?: Db;
    llm?: Llm | Pick<Llm, "stream" | "object"> | Pick<Llm, "stream">;
    now?: () => number;
  } = {},
): Promise<InTurnRetrievalResult> {
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const text = params.text.trim();

  if (!text || !isLearnerQuestion(text)) {
    return {
      isQuestion: false,
      retrievalRan: false,
      inSource: false,
      chunks: [],
      excerptTexts: [],
      latencyMs: 0,
    };
  }

  const db = deps.db ?? defaultDb;
  const llmClient = deps.llm && "object" in deps.llm ? (deps.llm as Llm) : defaultLlm;

  const rewritten = await rewriteQuery(
    text,
    params.glossary,
    { orgId: params.orgId, contentId: params.contentId, sessionId: params.sessionId },
    llmClient,
  );

  const chunks = await retrieve(
    {
      orgId: params.orgId,
      contentId: params.contentId,
      query: rewritten.englishQuery,
      retrieval: params.retrievalConfig,
    },
    db,
  );

  const inSource = isInSource(chunks, null, params.retrievalConfig.minSemantic);
  const excerptTexts = inSource ? chunks.map((c) => c.text) : [];
  const excerptsForThisTurn =
    inSource && chunks.length > 0
      ? chunks
          .map(
            (c) =>
              `<chunk id="${c.chunkId}" anchor="${c.anchor.kind}:${c.anchor.ref}">\n${c.text}\n</chunk>`,
          )
          .join("\n")
      : undefined;

  const latencyMs = Math.round(now() - started);

  return {
    isQuestion: true,
    retrievalRan: true,
    inSource,
    rewrittenQuery: rewritten,
    chunks,
    excerptsForThisTurn,
    excerptTexts,
    latencyMs,
  };
}
