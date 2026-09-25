import { normalizeDigits } from "@/lib/text/digits";

export type PiiKind = "cnic" | "phone" | "iban" | "card" | "email";
export type RedactCounts = Record<PiiKind, number>;
export interface RedactResult {
  text: string;
  counts: RedactCounts;
}

const LABEL: Record<PiiKind, string> = {
  cnic: "CNIC",
  phone: "PHONE",
  iban: "IBAN",
  card: "CARD",
  email: "EMAIL",
};

// Patterns run on the digit-normalized shadow (same length as the original), in
// priority order. Later kinds never override an earlier match on the same span.
const PATTERNS: { kind: PiiKind; re: RegExp; valid?: (m: string) => boolean }[] = [
  { kind: "iban", re: /\bPK\d{2}\s?[A-Z]{4}(?:\s?\d{4}){4}\b/g, valid: ibanOk },
  { kind: "cnic", re: /(?<!\d)\d{5}-\d{7}-\d(?!\d)/g },
  // Phones before cards: no card BIN starts with 0, and two adjacent mobiles must
  // not be swallowed as one Luhn-valid "card".
  { kind: "phone", re: /(?<!\d)(?:\+92|0092)[\s-]?3\d{2}[\s-]?\d{7}(?!\d)/g },
  { kind: "phone", re: /(?<!\d)03\d{2}[\s-]?\d{7}(?!\d)/g },
  { kind: "card", re: /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g, valid: cardOk },
  { kind: "cnic", re: /(?<!\d)\d{13}(?!\d)/g },
  // Anchored and bounded local part: a long alphanumeric run must not be re-scanned at every offset.
  {
    kind: "email",
    re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
];

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function cardOk(match: string): boolean {
  const digits = match.replace(/[ -]/g, "");
  return digits.length >= 13 && digits.length <= 19 && luhn(digits);
}

/** ISO 13616: move the first four characters to the end, letters to numbers, mod 97 is 1. */
function ibanOk(match: string): boolean {
  const iban = match.replace(/\s/g, "");
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const piece = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of piece) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

function keyFor(kind: PiiKind, match: string): string {
  if (kind === "email") return match.toLowerCase();
  const compact = match.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  // One subscriber, one placeholder: +92 300..., 0092 300... and 0300... share a key.
  return kind === "phone" ? compact.replace(/^(?:0092|92)3/, "03") : compact;
}

/**
 * A redactor numbers placeholders consistently across calls, so `[CNIC-1]` in a
 * later paragraph refers to the same value as in an earlier one. The value map
 * lives only in memory for the life of the redactor and is never stored.
 */
export function createRedactor() {
  const numbers = new Map<string, number>();
  const counters: RedactCounts = { cnic: 0, phone: 0, iban: 0, card: 0, email: 0 };

  function placeholder(kind: PiiKind, match: string): string {
    const key = `${kind}:${keyFor(kind, match)}`;
    let n = numbers.get(key);
    if (n === undefined) {
      n = ++counters[kind];
      numbers.set(key, n);
    }
    return `[${LABEL[kind]}-${n}]`;
  }

  function redact(text: string): RedactResult {
    const shadow = normalizeDigits(text);
    const taken: boolean[] = new Array<boolean>(shadow.length).fill(false);
    const spans: { start: number; end: number; kind: PiiKind; match: string }[] = [];

    for (const { kind, re, valid } of PATTERNS) {
      re.lastIndex = 0;
      for (const m of shadow.matchAll(re)) {
        const start = m.index;
        const end = start + m[0].length;
        if (valid && !valid(m[0])) continue;
        let free = true;
        for (let i = start; i < end; i++) if (taken[i]) free = false;
        if (!free) continue;
        for (let i = start; i < end; i++) taken[i] = true;
        spans.push({ start, end, kind, match: m[0] });
      }
    }

    spans.sort((a, b) => a.start - b.start);
    const counts: RedactCounts = { cnic: 0, phone: 0, iban: 0, card: 0, email: 0 };
    let out = "";
    let cursor = 0;
    for (const s of spans) {
      out += text.slice(cursor, s.start) + placeholder(s.kind, s.match);
      counts[s.kind]++;
      cursor = s.end;
    }
    out += text.slice(cursor);
    return { text: out, counts };
  }

  return { redact };
}

/** One-shot redaction with fresh numbering. */
export function redact(text: string): RedactResult {
  return createRedactor().redact(text);
}

export function totalRedactions(counts: RedactCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
