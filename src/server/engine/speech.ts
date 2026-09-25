import { Lang } from "@/server/config/schema";
import { normalizeDigits } from "@/lib/text/digits";

export interface ToSpeechOptions {
  lang?: Lang | string;
  mode?: "mirror" | "normalize" | "llm";
  glossary?: Array<{
    term: string;
    speechUr?: string;
    speechHint?: string;
  }>;
  mixedStrategy?: "native" | "transliterate" | "split";
}

/**
 * Urdu numbers 0 to 99 mapping.
 */
const URDU_NUMBERS_0_TO_99: Record<number, string> = {
  0: "صفر",
  1: "ایک",
  2: "دو",
  3: "تین",
  4: "چار",
  5: "پانچ",
  6: "چھ",
  7: "سات",
  8: "آٹھ",
  9: "نو",
  10: "دس",
  11: "گیارہ",
  12: "بارہ",
  13: "تیرہ",
  14: "چودہ",
  15: "پندرہ",
  16: "سولہ",
  17: "سترہ",
  18: "اٹھارہ",
  19: "انیس",
  20: "بیس",
  21: "اکیس",
  22: "بائیس",
  23: "تئیس",
  24: "چوبیس",
  25: "پچیس",
  26: "چھبیس",
  27: "ستائیس",
  28: "اٹھائیس",
  29: "انتیس",
  30: "تیس",
  31: "اکتیس",
  32: "بتیس",
  33: "تینتیس",
  34: "چونتیس",
  35: "پینتیس",
  36: "چھتیس",
  37: "سینتیس",
  38: "اڑتیس",
  39: "انتالیس",
  40: "چالیس",
  41: "اکتالیس",
  42: "بیالیس",
  43: "تینتالیس",
  44: "چوالیس",
  45: "پینتالیس",
  46: "چھیالیس",
  47: "سینتالیس",
  48: "اڑتالیس",
  49: "انچاس",
  50: "پچاس",
  51: "اکیاون",
  52: "باون",
  53: "ترپن",
  54: "چون",
  55: "پچپن",
  56: "چھپن",
  57: "ستاون",
  58: "اٹھاون",
  59: "انسٹھ",
  60: "ساٹھ",
  61: "اکسٹھ",
  62: "باسٹھ",
  63: "تریسٹھ",
  64: "چونسٹھ",
  65: "پینسٹھ",
  66: "چھیاسٹھ",
  67: "سڑسٹھ",
  68: "اڑسٹھ",
  69: "انہتر",
  70: "ستر",
  71: "اکہتر",
  72: "بہتر",
  73: "تہتر",
  74: "چوہتر",
  75: "پچہتر",
  76: "چھہتر",
  77: "ستتر",
  78: "اٹھتر",
  79: "اناسی",
  80: "اسی",
  81: "اکیاسی",
  82: "بیاسی",
  83: "تراسی",
  84: "چوراسی",
  85: "پچاسی",
  86: "چھیاسی",
  87: "ستاسی",
  88: "اٹھاسی",
  89: "نواسی",
  90: "نوے",
  91: "اکانوے",
  92: "بانوے",
  93: "ترانوے",
  94: "چورانوے",
  95: "پچانوے",
  96: "چھیانوے",
  97: "ستانوے",
  98: "اٹھانوے",
  99: "ننانوے",
};

/**
 * Converts a positive integer into spoken Urdu words.
 */
export function urduNumberToWords(num: number): string {
  if (num < 0) return `منفی ${urduNumberToWords(-num)}`;
  if (num <= 99) return URDU_NUMBERS_0_TO_99[num] || String(num);

  const parts: string[] = [];

  // Crores (10,000,000)
  if (num >= 10_000_000) {
    const crore = Math.floor(num / 10_000_000);
    parts.push(`${urduNumberToWords(crore)} کروڑ`);
    num %= 10_000_000;
  }

  // Lakhs (100,000)
  if (num >= 100_000) {
    const lakh = Math.floor(num / 100_000);
    parts.push(`${urduNumberToWords(lakh)} لاکھ`);
    num %= 100_000;
  }

  // Thousands (1,000)
  if (num >= 1_000) {
    const thousand = Math.floor(num / 1_000);
    parts.push(`${urduNumberToWords(thousand)} ہزار`);
    num %= 1_000;
  }

  // Hundreds (100)
  if (num >= 100) {
    const hundred = Math.floor(num / 100);
    parts.push(`${urduNumberToWords(hundred)} سو`);
    num %= 100;
  }

  // Remainder (0 to 99)
  if (num > 0) {
    parts.push(URDU_NUMBERS_0_TO_99[num] || String(num));
  }

  return parts.join(" ");
}

/**
 * English numbers dictionary and converter.
 */
const ENGLISH_ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const ENGLISH_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

export function englishNumberToWords(num: number): string {
  if (num < 0) return `minus ${englishNumberToWords(-num)}`;
  if (num < 20) return ENGLISH_ONES[num] ?? String(num);
  if (num < 100) {
    const remainder = num % 10;
    const tenPart = ENGLISH_TENS[Math.floor(num / 10)] ?? "";
    const onePart = ENGLISH_ONES[remainder] ?? "";
    return remainder
      ? `${tenPart}-${onePart}`
      : (ENGLISH_TENS[Math.floor(num / 10)] ?? String(num));
  }
  if (num < 1_000) {
    const remainder = num % 100;
    const hundredPart = `${ENGLISH_ONES[Math.floor(num / 100)] ?? ""} hundred`;
    return remainder ? `${hundredPart} ${englishNumberToWords(remainder)}` : hundredPart;
  }
  if (num < 1_000_000) {
    const remainder = num % 1_000;
    const thousandPart = `${englishNumberToWords(Math.floor(num / 1_000))} thousand`;
    return remainder ? `${thousandPart} ${englishNumberToWords(remainder)}` : thousandPart;
  }
  const remainder = num % 1_000_000;
  const millionPart = `${englishNumberToWords(Math.floor(num / 1_000_000))} million`;
  return remainder ? `${millionPart} ${englishNumberToWords(remainder)}` : millionPart;
}

/**
 * Common banking and customer service terms transliterated into Urdu.
 */
const COMMON_TRANSLITERATIONS: Record<string, string> = {
  customer: "کسٹمر",
  customers: "کسٹمرز",
  ticket: "ٹکٹ",
  tickets: "ٹکٹس",
  meeting: "میٹنگ",
  meetings: "میٹنگز",
  branch: "برانچ",
  branches: "برانچز",
  step: "سٹیپ",
  steps: "سٹیپس",
  check: "چیک",
  checks: "چیکس",
  form: "فارم",
  forms: "فارمز",
  account: "اکاؤنٹ",
  accounts: "اکاؤنٹس",
  update: "اپڈیٹ",
  updates: "اپڈیٹس",
  balance: "بیلنس",
  card: "کارڈ",
  cards: "کارڈز",
  debit: "ڈیبٹ",
  credit: "کریڈٹ",
  manager: "منیجر",
  counter: "کاؤنٹر",
  token: "ٹوکن",
  tokens: "ٹوکنز",
  system: "سسٹم",
  online: "آن لائن",
  app: "ایپ",
  password: "پاس ورڈ",
  login: "لاگ ان",
  transfer: "ٹرانسفر",
  deposit: "ڈپازٹ",
  cash: "کیش",
  biometric: "بائیومیٹرک",
  service: "سروس",
  services: "سروسز",
  call: "کال",
  center: "سینٹر",
  process: "پروسیس",
  stage: "سٹیج",
  stages: "سٹیجز",
  detail: "ڈیٹیل",
  details: "ڈیٹیلز",
  reference: "ریفرنس",
  guideline: "گائیڈ لائن",
  slip: "سلپ",
  cheque: "چیک",
  cheques: "چیکس",
  atm: "اے ٹی ایم",
  pin: "پن",
  sms: "ایس ایم ایس",
  cnic: "سی این آئی سی",
  kyc: "کے وائی سی",
  iban: "آئی بین",
  pkr: "روپے",
  otp: "او ٹی پی",
  nadra: "نادرا",
  sbp: "ایس بی پی",
  fbr: "ایف بی آر",
  it: "آئی ٹی",
  id: "آئی ڈی",
  pos: "پی او ایس",
  sim: "سم",
  faq: "ایف اے کیو",
  verification: "ویریفکیشن",
  verify: "ویریفائی",
};

/**
 * Transliterates English alphabet letters into Urdu phonetic names for acronyms.
 */
const URDU_LETTER_NAMES: Record<string, string> = {
  A: "اے",
  B: "بی",
  C: "سی",
  D: "ڈی",
  E: "ای",
  F: "ایف",
  G: "جی",
  H: "ایچ",
  I: "آئی",
  J: "جے",
  K: "کے",
  L: "ایل",
  M: "ایم",
  N: "این",
  O: "او",
  P: "پی",
  Q: "کیو",
  R: "آر",
  S: "ایس",
  T: "ٹی",
  U: "یو",
  V: "وی",
  W: "ڈبلیو",
  X: "ایکس",
  Y: "وائی",
  Z: "زیڈ",
};

/**
 * Escapes characters for use in a regular expression.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces em and en dashes with a comma. The house style forbids them in any copy, and
 * the model writes them anyway however the prompt is worded, so the engine enforces it.
 * A dash also reads badly in TTS, which pauses on it inconsistently.
 */
export function normalizeDashes(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/**
 * Strips markdown elements so plain text reaches TTS.
 */
export function stripMarkdown(text: string): string {
  let cleaned = text;

  // Code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");

  // Inline code
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // Images
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^\)]*\)/g, "");

  // Links
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]*\)/g, "$1");

  // Headers (lines starting with #, ##, etc.)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");

  // Blockquotes
  cleaned = cleaned.replace(/^>\s+/gm, "");

  // Unordered list bullets
  cleaned = cleaned.replace(/^[\*\-\+]\s+/gm, "");

  // Ordered list numbers at line starts
  cleaned = cleaned.replace(/^\d+[\.\)]\s+/gm, "");

  // Bold / Italics / Strikethrough
  cleaned = cleaned.replace(/\*\*\*(.*?)\*\*\*/g, "$1");
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*(.*?)\*/g, "$1");
  cleaned = cleaned.replace(/___(.*?)___/g, "$1");
  cleaned = cleaned.replace(/__(.*?)__/g, "$1");
  cleaned = cleaned.replace(/_([^_]+)_/g, "$1");
  cleaned = cleaned.replace(/~~(.*?)~~/g, "$1");

  // HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // Collapse excess whitespace and line breaks for continuous speech
  cleaned = cleaned.replace(/[ \t\r\n]+/g, " ");

  return cleaned.trim();
}

/**
 * Expands currency and math symbols into spoken forms.
 */
function expandSymbols(text: string, lang: Lang | string): string {
  let result = text;
  const isUrdu = lang === "ur" || lang === "mixed";
  const isRomanUrdu = lang === "ur-Latn";

  // Percent
  if (isUrdu) {
    result = result.replace(/%/g, " فیصد");
  } else if (isRomanUrdu) {
    result = result.replace(/%/g, " feesad");
  } else {
    result = result.replace(/%/g, " percent");
  }

  // Currency: Rs. or PKR
  if (isUrdu) {
    result = result.replace(/(?:Rs\.?|PKR)\s*(\d+)/gi, "$1 روپے");
    result = result.replace(/\$\s*(\d+)/g, "$1 ڈالر");
  } else if (isRomanUrdu) {
    result = result.replace(/(?:Rs\.?|PKR)\s*(\d+)/gi, "$1 rupay");
    result = result.replace(/\$\s*(\d+)/g, "$1 dollar");
  } else {
    result = result.replace(/(?:Rs\.?|PKR)\s*(\d+)/gi, "$1 rupees");
    result = result.replace(/\$\s*(\d+)/g, "$1 dollars");
  }

  // & (ampersand)
  if (isUrdu) {
    result = result.replace(/&/g, " اور ");
  } else if (isRomanUrdu) {
    result = result.replace(/&/g, " aur ");
  } else {
    result = result.replace(/&/g, " and ");
  }

  // + (plus)
  if (isUrdu) {
    result = result.replace(/\+/g, " جمع ");
  } else if (isRomanUrdu) {
    result = result.replace(/\+/g, " jama ");
  } else {
    result = result.replace(/\+/g, " plus ");
  }

  // = (equals)
  if (isUrdu) {
    result = result.replace(/=/g, " برابر ");
  } else if (isRomanUrdu) {
    result = result.replace(/=/g, " barabar ");
  } else {
    result = result.replace(/=/g, " equals ");
  }

  // @ (at)
  if (isUrdu) {
    result = result.replace(/@/g, " ایٹ ");
  } else {
    result = result.replace(/@/g, " at ");
  }

  return result;
}

/**
 * Expands numbers in text into spoken words.
 */
function expandNumbers(text: string, lang: Lang | string): string {
  const isUrdu = lang === "ur" || lang === "mixed";
  const isEnglish = lang === "en";

  if (isUrdu) {
    // Replace standalone integer sequences up to 7 digits
    return text.replace(/\b\d{1,7}\b/g, (match) => {
      const n = parseInt(match, 10);
      if (!isNaN(n)) {
        return urduNumberToWords(n);
      }
      return match;
    });
  }

  if (isEnglish) {
    // Replace standalone numbers
    return text.replace(/\b\d{1,6}\b/g, (match) => {
      const n = parseInt(match, 10);
      if (!isNaN(n)) {
        return englishNumberToWords(n);
      }
      return match;
    });
  }

  return text;
}

/**
 * Applies mixed strategy transliteration for English words and acronyms in Urdu contexts.
 */
function applyMixedStrategy(text: string, strategy: "native" | "transliterate" | "split"): string {
  if (strategy === "native") {
    return text;
  }

  if (strategy === "split") {
    // Separate Latin script words with pauses / commas for voice switching
    return text.replace(/([a-zA-Z]+)/g, " , $1 , ").replace(/,\s*,/g, ",");
  }

  // strategy === "transliterate"
  let out = text;

  // 1. Replace known common banking and customer service terms
  const terms = Object.keys(COMMON_TRANSLITERATIONS).sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const replacement = COMMON_TRANSLITERATIONS[term];
    if (replacement) {
      const reg = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
      out = out.replace(reg, replacement);
    }
  }

  // 2. Transliterate remaining uppercase acronyms (e.g. AB, PK, SBP) letter-by-letter
  out = out.replace(/\b[A-Z]{2,5}\b/g, (acronym) => {
    const letters = acronym.split("");
    const mapped = letters.map((l) => URDU_LETTER_NAMES[l] || l);
    return mapped.join(" ");
  });

  return out;
}

/**
 * Converts a tutor sentence into its spoken form for TTS synthesis.
 * Handles mirror, normalize, and llm modes.
 */
export function toSpeech(sentence: string, options: ToSpeechOptions = {}): string {
  if (!sentence || !sentence.trim()) {
    return "";
  }

  const mode = options.mode ?? "normalize";
  const lang = options.lang ?? "ur";
  const mixedStrategy = options.mixedStrategy ?? "transliterate";

  // If llm mode: extract @@s line if present
  if (mode === "llm") {
    const lines = sentence.split("\n");
    const speechLine = lines.find((l) => l.trim().startsWith("@@s "));
    if (speechLine) {
      const rawText = speechLine.trim().slice(4).trim();
      return stripMarkdown(rawText);
    }
  }

  // Strip protocol prefixes like @@d or @@s if caller passed a raw protocol line
  let text = sentence.trim();
  if (text.startsWith("@@d ")) {
    text = text.slice(4).trim();
  } else if (text.startsWith("@@s ")) {
    text = text.slice(4).trim();
  }

  // Mirror mode: speech equals display, minus markup that TTS must never read out.
  if (mode === "mirror") {
    return stripMarkdown(text);
  }

  // Normalize mode:
  // 1. Digits normalization (Arabic-Indic / Persian digits to standard 0-9)
  text = normalizeDigits(text);

  // 2. Strip Markdown
  text = stripMarkdown(text);

  // 3. Glossary speech hints, for an Urdu voice only. The design prompt asks for these in
  // Urdu script ("how an Urdu voice should say the English term"), so applying them to an
  // English session puts Urdu words into English speech.
  const urduVoice = lang === "ur" || lang === "ur-Latn" || lang === "mixed";
  if (urduVoice && options.glossary && options.glossary.length > 0) {
    const sortedGlossary = [...options.glossary].sort((a, b) => b.term.length - a.term.length);
    for (const item of sortedGlossary) {
      const hint = item.speechHint || item.speechUr;
      if (hint) {
        // Use word boundary for Latin words, or Unicode/whitespace boundary for others
        const isLatin = /^[A-Za-z0-9\s_-]+$/.test(item.term);
        const pattern = isLatin
          ? new RegExp(`\\b${escapeRegExp(item.term)}\\b`, "gi")
          : new RegExp(
              `(?<=^|\\s|[.,!?;:()،۔])${escapeRegExp(item.term)}(?=$|\\s|[.,!?;:()،۔])`,
              "g",
            );
        text = text.replace(pattern, hint);
      }
    }
  }

  // 4. Symbol expansion (% to percent or فیصد, currency, etc.)
  text = expandSymbols(text, lang);

  // 5. Mixed language strategy for Urdu or mixed sentences
  if (lang === "ur" || lang === "mixed") {
    text = applyMixedStrategy(text, mixedStrategy);
  }

  // 6. Number expansion into words
  text = expandNumbers(text, lang);

  // 7. Cleanup spacing and punctuation
  text = text
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/\s+([.,!?;:،۔])/g, "$1")
    .trim();

  return text;
}
