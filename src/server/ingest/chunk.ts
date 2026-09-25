import type { ParsedDoc } from "@/lib/parse";
import { estimateTokens } from "@/lib/text/tokens";
import type { Lang } from "../config/schema";
import { detectLang } from "./lang";

export interface ChunkAnchor {
  kind: "page" | "slide" | "section" | "url";
  ref: string;
  start: number;
  end: number;
}

export interface Chunk {
  ordinal: number;
  anchor: ChunkAnchor;
  headingPath: string[];
  text: string;
  tokenCount: number;
  lang: Lang;
}

export interface ChunkOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

/** The text a block contributes to chunking: body plus speaker notes when present. */
export function blockText(block: ParsedDoc["blocks"][number]): string {
  return block.notes ? `${block.text}\n\nNotes: ${block.notes}` : block.text;
}

// Sentence ends in English and Urdu (U+06D4 full stop, U+061F question mark).
const SENTENCE = /[^.!?۔؟\n]+(?:[.!?۔؟]+|\n|$)/gu;

function trimmedSpan(text: string, start: number, end: number): [number, number] | null {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return end > start ? [start, end] : null;
}

/** Character spans of blank-line separated paragraphs, start inclusive, end exclusive. */
function paragraphSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  for (const m of text.matchAll(/\n[ \t]*\n/g)) {
    const span = trimmedSpan(text, start, m.index);
    if (span) spans.push(span);
    start = m.index + m[0].length;
  }
  const last = trimmedSpan(text, start, text.length);
  if (last) spans.push(last);
  return spans;
}

function sentenceSpans(text: string, from: number, to: number): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of text.slice(from, to).matchAll(SENTENCE)) {
    const span = trimmedSpan(text, from + m.index, from + m.index + m[0].length);
    if (span) spans.push(span);
  }
  return spans.length ? spans : [[from, to]];
}

/** Split an over-long span into pieces of at most maxTokens, breaking on spaces where possible. */
/** Never cut inside a surrogate pair or before a combining mark. */
function safeCut(text: string, idx: number, floor: number): number {
  while (idx > floor && /[\uDC00-\uDFFF\p{M}]/u.test(text[idx] ?? "")) idx--;
  return idx;
}

function hardSplit(text: string, from: number, to: number, maxTokens: number): [number, number][] {
  const out: [number, number][] = [];
  let start = from;
  while (start < to) {
    // Linear bound: a token is at least a quarter of a character in the estimator.
    let end = Math.min(to, start + maxTokens * 4);
    while (end > start + 1 && estimateTokens(text.slice(start, end)) > maxTokens) {
      const cut = Math.floor(start + (end - start) * 0.8);
      const space = text.lastIndexOf(" ", cut);
      end = safeCut(text, space > start + 20 ? space : cut, start + 1);
    }
    const span = trimmedSpan(text, start, end);
    if (span) out.push(span);
    start = end;
  }
  return out;
}

/**
 * Expects a normalized document (normalize() first: paragraphs are blank-line
 * separated with newline breaks). Structure first (one anchor kind and ref per
 * block), then a token budget with overlap. A chunk's text is exactly `blockText(block).slice(start, end)`, so
 * "show source" can highlight it and quote checks can match it.
 */
export function chunkDocument(doc: ParsedDoc, opts: ChunkOptions): Chunk[] {
  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const block of doc.blocks) {
    const text = blockText(block);
    if (!text.trim()) continue;
    const headingPath = block.heading ? [block.heading] : [];

    // Units: paragraphs; over-budget paragraphs become sentences, then hard pieces.
    const units: [number, number][] = [];
    for (const [ps, pe] of paragraphSpans(text)) {
      if (estimateTokens(text.slice(ps, pe)) <= opts.maxTokens) {
        units.push([ps, pe]);
        continue;
      }
      for (const [ss, se] of sentenceSpans(text, ps, pe)) {
        if (estimateTokens(text.slice(ss, se)) <= opts.maxTokens) units.push([ss, se]);
        else units.push(...hardSplit(text, ss, se, opts.maxTokens));
      }
    }

    let start = -1;
    let end = -1;
    const flush = () => {
      if (start < 0) return;
      const slice = text.slice(start, end);
      chunks.push({
        ordinal: ordinal++,
        anchor: { kind: block.kind, ref: block.ref, start, end },
        headingPath,
        text: slice,
        tokenCount: estimateTokens(slice),
        lang: detectLang(slice),
      });
    };

    for (const [us, ue] of units) {
      if (start < 0) {
        start = us;
        end = ue;
        continue;
      }
      if (estimateTokens(text.slice(start, ue)) <= opts.targetTokens) {
        end = ue;
        continue;
      }
      flush();
      // Overlap: start the next chunk a little before this unit, on a word boundary,
      // as long as the result still fits under maxTokens.
      let overlapStart = us;
      if (opts.overlapTokens > 0) {
        let probe = us;
        while (probe > start && estimateTokens(text.slice(probe, us)) < opts.overlapTokens) probe--;
        const space = text.indexOf(" ", probe);
        const candidate = safeCut(text, space >= 0 && space < us ? space + 1 : probe, start);
        if (estimateTokens(text.slice(candidate, ue)) <= opts.maxTokens) overlapStart = candidate;
      }
      start = overlapStart;
      end = ue;
    }
    flush();
  }
  return chunks;
}
