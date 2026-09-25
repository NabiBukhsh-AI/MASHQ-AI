import { normalizeDigits } from "@/lib/text/digits";

export const UNVERIFIED_FIGURE_FALLBACK =
  "I am not sure of the exact figure. Please check the source.";

export interface FactAnchorLike {
  quote?: string;
}

export interface FactLike {
  statement?: string;
  quote?: string;
  anchors?: FactAnchorLike[];
}

export interface NumberGuardCheckResult {
  unverified: string[];
}

export interface ApplyNumberGuardResult {
  text: string;
  unverified: string[];
  replaced: boolean;
}

/**
 * Numbers written as words. A figure is a figure whether the model writes "50,000" or "fifty
 * thousand", and the source corpus writes them both ways ("within thirty seconds", "a minimum
 * balance of five thousand rupees"), so a digits-only guard misses exactly the sentences that
 * sound most authoritative.
 */
const NUMBER_WORDS_EN =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|lakh|lac|crore|dozen|half|quarter";

/** Roman Urdu, which the tutor uses in mixed and ur-Latn sessions. */
const NUMBER_WORDS_UR_LATN =
  "aik|ek|do|teen|char|paanch|panch|chay|che|saat|aath|nau|das|gyarah|barah|bees|tees|chalis|pachas|sau|hazaar|hazar|lakh|karor";

/** Urdu script. */
const NUMBER_WORDS_UR =
  "صفر|ایک|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|دس|بیس|تیس|چالیس|پچاس|سو|ہزار|لاکھ|کروڑ";

/**
 * Scale words, and the units a figure attaches to. A worded number only counts as a figure
 * when it carries one of these. Without that test "one" fires on "as one would expect" and the
 * guard replaces ordinary prose with the not-sure line, which is worse than the miss it fixes.
 */
const SCALE_WORDS =
  /\b(?:hundred|thousand|million|billion|lakh|lac|crore|sau|hazaar|hazar|karor)\b|سو|ہزار|لاکھ|کروڑ/i;

const UNITS =
  "rupees?|rs\\.?|pkr|percent|per cent|seconds?|minutes?|hours?|days?|weeks?|months?|years?|working days?|times|copies|branches|documents?|روپے|سیکنڈ|منٹ|گھنٹے|دن|فیصد";

/** One or more number words in a row, so "five thousand" is one token, not two. */
const WORDED_NUMBER = new RegExp(
  `\\b(?:${NUMBER_WORDS_EN}|${NUMBER_WORDS_UR_LATN})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORDS_EN}|${NUMBER_WORDS_UR_LATN}))*(?:[\\s-]+(?:${UNITS}))?\\b`,
  "gi",
);

const WORDED_NUMBER_UR = new RegExp(
  `(?:${NUMBER_WORDS_UR})(?:\\s+(?:${NUMBER_WORDS_UR}))*(?:\\s+(?:${UNITS}))?`,
  "g",
);

/** Keeps only the worded phrases that read as a figure rather than as ordinary prose. */
function isFigure(phrase: string): boolean {
  if (SCALE_WORDS.test(phrase)) return true;
  return new RegExp(`(?:${UNITS})\\s*$`, "i").test(phrase.trim());
}

/**
 * Extracts numeric tokens (numbers, percentages, dates, amounts) from text.
 * Normalizes digits (including Arabic-Indic / Urdu digits) to standard ASCII.
 */
function extractNumericTokens(text: string): string[] {
  const normalized = normalizeDigits(text);
  // Match currency prefixes, numbers with commas/dots, percentages, ordinals
  const regex = /(?:(?:PKR|Rs\.?|\$|€|£)\s*)?\b\d+(?:[.,/:-]\d+)*(?:%|\b[a-zA-Z]+|\b)/gi;
  const matches = normalized.match(regex) || [];
  const worded = [
    ...(normalized.match(WORDED_NUMBER) ?? []),
    ...(normalized.match(WORDED_NUMBER_UR) ?? []),
  ].filter(isFigure);
  return [...matches, ...worded].map((m) => m.trim()).filter(Boolean);
}

/**
 * Normalizes a number string for comparison (removes currency symbols, commas, trailing ordinals/percent).
 */
function cleanNumberValue(token: string): string {
  return token
    .replace(/(?:PKR|Rs\.?|\$|€|£)\s*/gi, "")
    .replace(/,/g, "")
    .replace(/(?:st|nd|rd|th|%)$/gi, "")
    .trim();
}

/**
 * Checks whether all numbers, dates, amounts, and percentages in a sentence
 * are present in the provided allowed facts or source excerpts.
 */
export function checkNumbers(
  sentence: string,
  allowedFacts: (string | FactLike)[] = [],
  excerpts: string[] = [],
): NumberGuardCheckResult {
  const tokens = extractNumericTokens(sentence);
  if (tokens.length === 0) {
    return { unverified: [] };
  }

  // Build the corpus of allowed source text
  const sourceTexts: string[] = [];
  for (const fact of allowedFacts) {
    if (typeof fact === "string") {
      sourceTexts.push(fact);
    } else if (fact && typeof fact === "object") {
      if (fact.statement) sourceTexts.push(fact.statement);
      if (fact.quote) sourceTexts.push(fact.quote);
      if (Array.isArray(fact.anchors)) {
        for (const a of fact.anchors) {
          if (a?.quote) sourceTexts.push(a.quote);
        }
      }
    }
  }
  for (const excerpt of excerpts) {
    if (excerpt) sourceTexts.push(excerpt);
  }

  const combinedSource = normalizeDigits(sourceTexts.join(" "));
  const combinedSourceClean = combinedSource.replace(/,/g, "");

  const unverified: string[] = [];
  for (const token of tokens) {
    const clean = cleanNumberValue(token);
    if (!clean) continue;

    // Check if original token exists in source, or if clean number value exists in clean source
    const rawPattern = new RegExp(`\\b${escapeRegExp(clean)}\\b`, "i");
    const found =
      combinedSource.includes(token) ||
      rawPattern.test(combinedSourceClean) ||
      combinedSourceClean.includes(clean);

    if (!found) {
      unverified.push(token);
    }
  }

  return { unverified: Array.from(new Set(unverified)) };
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Applies the number guard to a display sentence.
 * In strict mode, an unverified number replaces the sentence with UNVERIFIED_FIGURE_FALLBACK.
 * In assisted mode, the sentence is kept as is, with unverified numbers identified.
 */
export function applyNumberGuard(
  sentence: string,
  allowedFacts: (string | FactLike)[] = [],
  excerpts: string[] = [],
  strictness: "strict" | "assisted" = "strict",
): ApplyNumberGuardResult {
  const { unverified } = checkNumbers(sentence, allowedFacts, excerpts);
  if (unverified.length > 0 && strictness === "strict") {
    return {
      text: UNVERIFIED_FIGURE_FALLBACK,
      unverified,
      replaced: true,
    };
  }

  return {
    text: sentence,
    unverified,
    replaced: false,
  };
}
