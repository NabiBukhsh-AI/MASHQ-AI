import type { ParsedBlock, ParsedDoc } from "@/lib/parse";

// NFC (not NFKC: Urdu presentation forms must not be folded),
// strip invisible controls that hide text or flip direction, keep the joiners
// Urdu typography needs (ZWNJ U+200C, ZWJ U+200D, LRM, RLM), and neutralize
// our own prompt delimiters.

// Built from code points so the source file holds no invisible characters.
const cls = (...ranges: [number, number][]) =>
  ranges
    .map(([a, b]) =>
      a === b ? String.fromCodePoint(a) : `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`,
    )
    .join("");
// Tag characters, zero-width space, word joiner, BOM, bidi embeddings, overrides and isolates.
const STRIP = new RegExp(
  `[${cls([0xe0000, 0xe007f], [0x200b, 0x200b], [0x2060, 0x2060], [0xfeff, 0xfeff], [0x202a, 0x202e], [0x2066, 0x2069])}]`,
  "gu",
);
// C0 and C1 controls except tab, newline and carriage return.
const CONTROLS = new RegExp(`[${cls([0, 8], [0xb, 0xc], [0xe, 0x1f], [0x7f, 0x9f])}]`, "g");
const PROMPT_TAGS = /<(?=\/?(?:content_pack|learner_input|turn_context|excerpt)\b)/gi;

export function normalizeText(input: string): string {
  return (
    input
      .normalize("NFC")
      .replace(STRIP, "")
      .replace(CONTROLS, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\u00A0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      // Line-start markers, also when a kept invisible (LRM, RLM, ZWNJ, ZWJ, ALM) precedes them.
      .replace(/^([\u200C-\u200F\u061C]*)@@/gm, "$1@ @")
      .replace(PROMPT_TAGS, "\uFF1C")
  );
}

export function normalize(doc: ParsedDoc): ParsedDoc {
  const blocks: ParsedBlock[] = doc.blocks
    .map((b) => ({
      ...b,
      heading: b.heading ? normalizeText(b.heading) : undefined,
      notes: b.notes ? normalizeText(b.notes) : undefined,
      text: normalizeText(b.text),
    }))
    .filter((b) => b.text.length > 0 || (b.notes?.length ?? 0) > 0);
  const text = blocks
    .map((b) => [b.heading, b.text, b.notes ? `Notes: ${b.notes}` : ""].filter(Boolean).join("\n"))
    .join("\n\n");
  return { ...doc, title: doc.title ? normalizeText(doc.title) : doc.title, blocks, text };
}
