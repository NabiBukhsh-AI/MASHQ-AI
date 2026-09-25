import { z } from "zod";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { detectLang } from "../ingest/lang";
import { normalizeDigits } from "@/lib/text/digits";

// Urdu or Roman Urdu questions first try the glossary
// (term_ur and term_roman map to term_en); only when nothing matches does the
// fast tier write an English query. English questions pass through untouched.

export interface GlossaryEntry {
  termEn: string;
  termUr?: string | null;
  termRoman?: string | null;
}

export interface RewrittenQuery {
  englishQuery: string;
  keywords: string[];
  source: "passthrough" | "glossary" | "model";
}

export const RewriteSchema = z.object({
  englishQuery: z.string().min(1).max(200),
  keywords: z.array(z.string().min(1).max(40)).max(6),
});

const REWRITE_SYSTEM = `<task>
The learner asked a question in Urdu, Roman Urdu or a mix. Write a short English search query and up to 6 English keywords that would find the answer in an English training document. Use the glossary to map terms. Do not answer the question.
</task>`;

function glossaryHits(text: string, glossary: GlossaryEntry[]): string[] {
  const hay = normalizeDigits(text).toLowerCase();
  const hits: string[] = [];
  for (const g of glossary) {
    const forms = [g.termUr, g.termRoman]
      .filter((f): f is string => !!f)
      .map((f) => f.toLowerCase());
    if (forms.some((f) => f.length >= 2 && hay.includes(f))) hits.push(g.termEn);
  }
  return [...new Set(hits)];
}

export async function rewriteQuery(
  text: string,
  glossary: GlossaryEntry[],
  ctx: { orgId: string; contentId?: string; sessionId?: string },
  llm: Llm = defaultLlm,
): Promise<RewrittenQuery> {
  const lang = detectLang(text);
  if (lang === "en") {
    return { englishQuery: text, keywords: keywordsOf(text), source: "passthrough" };
  }

  const fromGlossary = glossaryHits(text, glossary);
  // Latin words in a mixed question are usually the English terms themselves.
  // Roman Urdu function words are dropped so the English search query stays clean.
  const latinWords = (text.match(/[A-Za-z][A-Za-z-]{2,}/g) ?? []).filter(
    (w) => !STOP.has(w.toLowerCase()) && !ROMAN_STOP.has(w.toLowerCase()),
  );
  const keywords = [...new Set([...fromGlossary, ...latinWords])].slice(0, 6);
  if (fromGlossary.length) {
    return { englishQuery: keywords.join(" "), keywords, source: "glossary" };
  }

  const glossaryBlock = glossary.length
    ? `<glossary>\n${glossary.map((g) => `${g.termEn} | ${g.termUr ?? ""} | ${g.termRoman ?? ""}`).join("\n")}\n</glossary>`
    : "";
  const { value } = await llm.object("query.rewrite", RewriteSchema, {
    system: REWRITE_SYSTEM,
    packBlocks: glossaryBlock ? [glossaryBlock] : [],
    history: [],
    final: `<learner_input>\n${text}\n</learner_input>`,
    orgId: ctx.orgId,
    contentId: ctx.contentId,
    sessionId: ctx.sessionId,
    lang,
  });
  return {
    englishQuery: value.englishQuery,
    keywords: [...new Set([...value.keywords, ...keywords])].slice(0, 6),
    source: "model",
  };
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "what",
  "how",
  "why",
  "when",
  "does",
  "are",
  "is",
  "can",
  "you",
  "your",
  "about",
]);

const ROMAN_STOP = new Set([
  "hai",
  "hain",
  "ka",
  "ki",
  "ke",
  "ko",
  "nahi",
  "nahin",
  "nhi",
  "aur",
  "mein",
  "kya",
  "aap",
  "raha",
  "rahi",
  "rahe",
  "tha",
  "thi",
  "se",
  "par",
  "pe",
  "ho",
  "hoga",
  "hogi",
  "hota",
  "hoti",
  "hote",
  "karein",
  "karen",
  "karo",
  "kar",
  "karna",
  "karne",
  "kiya",
  "ye",
  "yeh",
  "wo",
  "woh",
  "bhi",
  "ab",
  "tum",
  "hum",
  "apna",
  "apni",
  "apne",
  "liye",
  "lie",
  "sath",
  "saath",
  "kyun",
  "kaise",
  "kahan",
  "kab",
  "jab",
  "tab",
  "agar",
  "magar",
  "lekin",
  "phir",
  "kuch",
  "sab",
  "bohat",
  "bahut",
  "acha",
  "theek",
  "pehle",
  "baad",
  "wala",
  "wali",
  "walay",
  "chahiye",
  "sakta",
  "sakti",
  "sakte",
  "gaya",
  "gayi",
  "gaye",
  "hua",
  "hui",
  "hue",
  "mujhe",
  "tumhe",
  "unhe",
  "unko",
  "usko",
  "iska",
  "iski",
  "uska",
  "uski",
  "humein",
  "hamein",
  "na",
  "toh",
  "kaun",
  "kis",
  "kisi",
  "sirf",
  "zaroor",
  "zaroori",
  "matlab",
  "shukriya",
  "janab",
  "sahab",
  "bilkul",
  "samajh",
  "aaya",
  "aayi",
  "aaye",
  "dekho",
  "dekhein",
  "batao",
  "bataiye",
  "zara",
]);

export function keywordsOf(text: string): string[] {
  return [
    ...new Set((text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w))),
  ].slice(0, 6);
}
