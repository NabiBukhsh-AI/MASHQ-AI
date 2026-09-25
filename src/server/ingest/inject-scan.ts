// Step 1 of injection defence: cheap heuristics at ingest, in English, Urdu and
// Roman Urdu. Hits flag the chunk (injection_flag) and add a warning to the
// ingestion report; flagged chunks go to the model classifier (scan_classify).
// Ordinary training text ("tell the customer", "verify the CNIC") must not trip it.

export interface InjectionSpan {
  start: number;
  end: number;
  rule: string;
  text: string;
}

export interface InjectionScan {
  flagged: boolean;
  /** 0 to 1: strongest single rule weight plus a little for extra distinct rules. */
  score: number;
  spans: InjectionSpan[];
  reasons: string[];
}

interface Rule {
  id: string;
  re: RegExp;
  weight: number;
  reason: string;
}

const RULES: Rule[] = [
  // Instruction override, English
  {
    id: "override_en",
    re: /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|the|your|any)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?|policy|policies|source|document)\b/gi,
    weight: 0.9,
    reason: "asks to ignore or override instructions",
  },
  // Role or identity hijack
  {
    id: "role_hijack_en",
    re: /\byou are now\b|\bact as (?:a |an )?(?:system|developer|admin|root|dan)\b|\bdeveloper mode\b|\bjailbreak\b|\bno restrictions?\b|\bwithout (?:any )?restrictions?\b/gi,
    weight: 0.85,
    reason: "tries to change the assistant's role or remove limits",
  },
  // Prompt or hidden content disclosure
  {
    id: "reveal_en",
    re: /\b(?:reveal|print|show|display|output|repeat|leak|dump)\b[^.\n]{0,40}\b(?:system prompt|hidden (?:instructions?|text|note|prompt)|your (?:instructions?|prompt|rules)|content_pack|confidential|secret)\b|\bsystem prompt\b/gi,
    weight: 0.85,
    reason: "asks to reveal hidden instructions or the system prompt",
  },
  // Grading and reward manipulation
  {
    id: "grading_en",
    re: /\b(?:award|give|grant|add)\b[^.\n]{0,30}\b\d+\s*(?:xp|points?)\b|\bmark(?:ed)?\b[^.\n]{0,40}\b(?:as\s+)?(?:correct|mastered|proficient|complete|passed)\b|\b(?:set|raise|increase)\b[^.\n]{0,30}\bmastery\b|\bunlock\b[^.\n]{0,30}\b(?:final challenge|all (?:missions|chapters|content))\b|\bgrade (?:generously|everything as correct)\b|\bfull marks\b/gi,
    weight: 0.85,
    reason: "tries to change grading, XP or mastery",
  },
  // Standing instructions to the answering machine
  {
    id: "standing_instruction_en",
    re: /\b(?:when(?:ever)? (?:asked|the learner asks|a learner asks|you are asked)|from now on|in (?:all|every) (?:your )?(?:responses?|answers?|turns?))\b[^.\n]{0,40}\b(?:respond|reply|answer|say|tell|claim|state)\b/gi,
    weight: 0.75,
    reason: "gives the assistant a standing instruction on how to answer",
  },
  // Chat transcript role prefixes and model control tokens
  {
    id: "role_prefix",
    re: /(?:^|\n)\s*(?:system|assistant|human|user|ai)\s*:\s/gi,
    weight: 0.6,
    reason: "contains chat role prefixes",
  },
  {
    id: "control_tokens",
    re: /\[INST\]|\[\/INST\]|<<SYS>>|<\|im_start\|>|<\|system\|>|<\|endoftext\|>/g,
    weight: 0.9,
    reason: "contains model control tokens",
  },
  // Our own protocol markers and tags (normalization neutralizes them, but flag the attempt)
  {
    id: "protocol_markers",
    re: /(?:^|\n)\s*@\s?@\s?(?:end|m|f|d|s|v|x)\b|[<＜]\/?(?:content_pack|learner_input|turn_context|excerpt)\b/gi,
    weight: 0.9,
    reason: "contains Mashq protocol markers or tags",
  },
  // Text broken up one letter at a time. Normalization collapses the wider gap between the
  // words, so by the time a chunk is scanned the words cannot be put back. The technique
  // itself is the signal: ordinary prose never runs eight single letters together.
  {
    id: "spaced_letters",
    re: /(?:\b\p{L}[\s.·*_|-]){8,}\p{L}\b/gu,
    weight: 0.7,
    reason: "text broken up one letter at a time, which hides it from a reader and a filter",
  },
  // Exfiltration vectors
  {
    id: "markdown_image",
    re: /!\[[^\]]*\]\([^)]*\)/g,
    weight: 0.7,
    reason: "contains a markdown image",
  },
  {
    id: "data_url",
    re: /\bdata:[a-z]+\/[a-z0-9.+-]+;base64,/gi,
    weight: 0.8,
    reason: "contains a data URL",
  },
  {
    id: "long_base64",
    re: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{120,}={0,2}(?![A-Za-z0-9+/=])/g,
    weight: 0.6,
    reason: "contains a long base64-like run",
  },
  // Hidden text markers that survived normalization (tag chars are stripped there; ZWSP inside words is suspicious)
  {
    id: "hidden_note",
    re: /\b(?:hidden|secret) (?:note|message|instruction)s? (?:for|to) (?:the )?(?:ai|assistant|model|tutor|grader)\b|\bnote (?:for|to) the (?:ai|assistant|model|tutor|grader)\b/gi,
    weight: 0.85,
    reason: "addresses the AI directly",
  },
  // Urdu script
  {
    id: "override_ur",
    re: /(?:پچھلی|سابقہ|اوپر کی|تمام|ساری)\s+(?:تمام\s+)?(?:ہدایات|ہدایت|اصول|قواعد)[^۔\n]{0,30}(?:نظر\s?انداز|بھول|رد|ختم)|نظر\s?انداز\s+کر(?:یں|و|نا)[^۔\n]{0,30}(?:ہدایات|ہدایت|اصول)/g,
    weight: 0.9,
    reason: "asks in Urdu to ignore previous instructions",
  },
  {
    id: "reveal_ur",
    re: /سسٹم\s+پرامپٹ|(?:خفیہ|پوشیدہ)\s+(?:ہدایات|ہدایت|پیغام)|(?:ظاہر|افشا)\s+کر(?:یں|و)/g,
    weight: 0.85,
    reason: "asks in Urdu to reveal the system prompt or hidden text",
  },
  {
    id: "role_ur",
    re: /آپ\s+اب\s+(?:ایک\s+)?(?:ایسا|ایسی)?\s*(?:اسسٹنٹ|سسٹم|ماڈل)|کوئی\s+پابندی\s+نہیں/g,
    weight: 0.85,
    reason: "tries in Urdu to change the assistant's role",
  },
  {
    id: "grading_ur",
    re: /(?:پورے|مکمل)\s+(?:نمبر|پوائنٹس)|(?:\d+|ایک\s+ہزار|پانچ\s+سو)\s+(?:پوائنٹس|ایکس\s?پی)|ہر\s+جواب\s+(?:کو\s+)?(?:درست|صحیح)|ماسٹر\s+(?:قرار|مان)/g,
    weight: 0.85,
    reason: "tries in Urdu to change grading or points",
  },
  // Roman Urdu
  {
    id: "override_urlatn",
    re: /\b(?:pichli|pichhli|purani|saari|sari|tamam|upar ki)\b[^.\n]{0,20}\b(?:hidayat|hidayaat|hidaayat|rules?|instructions?)\b[^.\n]{0,30}\b(?:nazar\s?andaz|bhool|chhor|ignore)\b|\bnazar\s?andaz\s+kar(?:o|ein|en|na)\b/gi,
    weight: 0.9,
    reason: "asks in Roman Urdu to ignore instructions",
  },
  {
    id: "reveal_urlatn",
    re: /\b(?:apna|apni|apne)\s+(?:system\s+)?prompt\s+(?:dikhao|dikhaiye|batao|bataiye|print karo)\b|\bsystem\s+ho\b/gi,
    weight: 0.85,
    reason: "asks in Roman Urdu to reveal the prompt or claims system role",
  },
  {
    id: "grading_urlatn",
    re: /\b\d+\s*(?:xp|points?)\s+(?:de\s+do|dedo|dein|do)\b|\b(?:har|sab)\s+jawab\s+(?:ko\s+)?(?:sahi|theek|correct)\b|\bmaster\s+ho\s+gaya\b/gi,
    weight: 0.85,
    reason: "tries in Roman Urdu to change grading or points",
  },
];

const FLAG_THRESHOLD = 0.6;

/**
 * Characters that read as another letter. Cyrillic and Greek lookalikes step around the
 * English rules; Arabic letter forms step around the Urdu ones, because Urdu spells the same
 * sounds with its own codepoints.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  һ: "h",
  А: "A",
  Е: "E",
  О: "O",
  Р: "P",
  С: "C",
  У: "Y",
  Х: "X",
  α: "a",
  ε: "e",
  ο: "o",
  ρ: "p",
  υ: "u",
  ν: "v",
  ι: "i",
  Α: "A",
  Ε: "E",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Β: "B",
  ه: "ہ",
  ة: "ہ",
  ي: "ی",
  ى: "ی",
  ك: "ک",
};

const CONFUSABLE_RE = /[Α-ωЀ-ӿةكهىي]/g;

/** A separator sitting between two single letters, as in "I G N O R E" or "I.g.n.o.r.e". */
const LETTER_SEPARATOR = /(?<=\b\p{L})[\s.·*_|-]+(?=\p{L}\b)/gu;

/** A base64 run long enough to carry a sentence. The scanner decodes it and reads it. */
const BASE64_RUN = /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])/g;

function decodedBase64(text: string): string {
  const parts: string[] = [];
  for (const m of text.matchAll(BASE64_RUN)) {
    try {
      const decoded = Buffer.from(m[0], "base64").toString("utf8");
      // Base64 of arbitrary bytes decodes to mojibake. Words with spaces mean it was text.
      if (/\s/.test(decoded) && !/[\u0000-\u0008\u000e-\u001f�]/.test(decoded)) {
        parts.push(decoded);
      }
    } catch {
      // Not base64 after all.
    }
  }
  return parts.join("\n");
}

/**
 * The text as written, rewritten to undo the cheap tricks that step around a literal rule
 * list. Each variant is scanned in its own right. Roman Urdu has no fixed spelling, so the
 * last variant collapses the vowel padding that "hidaayaat" adds to "hidayat".
 */
function deobfuscated(text: string): string[] {
  const out: string[] = [];
  const folded = text.replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c);
  if (folded !== text) out.push(folded);

  // One separator between two letters is padding inside a word; a longer run is the gap
  // between two words, so it collapses to a single space rather than disappearing.
  const unspaced = folded.replace(LETTER_SEPARATOR, (run) => (run.length === 1 ? "" : " "));
  if (unspaced !== folded) out.push(unspaced);

  const roman = folded
    .toLowerCase()
    .replaceAll("-", " ")
    .replaceAll("ee", "i")
    .replaceAll("oo", "u")
    .replace(/([a-z])\1+/g, "$1");
  if (roman !== folded.toLowerCase()) out.push(roman);

  const decoded = decodedBase64(text);
  if (decoded) out.push(decoded);

  return out;
}

export function scanChunk(text: string): InjectionScan {
  const spans: InjectionSpan[] = [];
  const rulesHit = new Map<string, Rule>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      if (!m[0].trim()) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, rule: rule.id, text: m[0] });
      rulesHit.set(rule.id, rule);
    }
  }

  // The same rules again over the de-obfuscated variants. A hit there is still a hit, but it
  // gets no span: an offset into a rewritten string points nowhere in the text as written.
  for (const variant of deobfuscated(text)) {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (rule.re.test(variant)) rulesHit.set(rule.id, rule);
      rule.re.lastIndex = 0;
    }
  }

  spans.sort((a, b) => a.start - b.start);
  const weights = [...rulesHit.values()].map((r) => r.weight);
  const strongest = weights.length ? Math.max(...weights) : 0;
  const score = Math.min(1, strongest + Math.max(0, weights.length - 1) * 0.05);
  return {
    flagged: score >= FLAG_THRESHOLD,
    score: Math.round(score * 100) / 100,
    spans,
    reasons: [...new Set([...rulesHit.values()].map((r) => r.reason))],
  };
}

/** Ingestion-report line for a document: counts plus the first few anchors. */
export function injectionWarning(
  hits: { ordinal: number; anchor: { kind: string; ref: string }; scan: InjectionScan }[],
): string | null {
  if (!hits.length) return null;
  const where = hits
    .slice(0, 3)
    .map((h) => `${h.anchor.kind} ${h.anchor.ref} (chunk ${h.ordinal + 1})`)
    .join(", ");
  const more = hits.length > 3 ? ` and ${hits.length - 3} more` : "";
  return `${hits.length} passage${hits.length === 1 ? "" : "s"} contain text that tries to instruct an AI (${where}${more}). They are excluded from facts until checked.`;
}
