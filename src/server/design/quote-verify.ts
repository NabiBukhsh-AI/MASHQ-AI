import { normalizeDigits } from "@/lib/text/digits";
import type { Fact } from "@/lib/schemas/design";

// Every fact anchor must quote its chunk verbatim, checked by
// code before any model judges entailment. Matching is NFC, digit-shadow,
// whitespace and punctuation insensitive, but the words must appear in order.

export interface ChunkLike {
  id: string;
  text: string;
}

export interface VerifiedAnchor {
  chunkId: string;
  quote: string;
  start: number;
  end: number;
}

export interface VerifiedFact extends Omit<Fact, "anchors"> {
  anchors: VerifiedAnchor[];
}

const PUNCT = /[\p{P}\p{S}]/gu;

/** Lower-cased, digit-normalized, punctuation-free, single-spaced; keeps a map back to original offsets. */
function fold(text: string): { folded: string; map: number[] } {
  const nfc = normalizeDigits(text.normalize("NFC"));
  let folded = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < nfc.length; i++) {
    const ch = nfc[i]!;
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        folded += " ";
        map.push(i);
        lastSpace = true;
      }
      continue;
    }
    if (PUNCT.test(ch)) {
      PUNCT.lastIndex = 0;
      continue;
    }
    PUNCT.lastIndex = 0;
    folded += ch.toLowerCase();
    map.push(i);
    lastSpace = false;
  }
  return { folded: folded.trim(), map };
}

/** Find `quote` inside `text` with the folding above. Returns original offsets or null. */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const hay = fold(text);
  const needle = fold(quote).folded;
  if (needle.length < 3) return null;
  const at = hay.folded.indexOf(needle);
  if (at < 0) return null;
  const start = hay.map[at]!;
  const end = hay.map[at + needle.length - 1]! + 1;
  return { start, end };
}

export interface VerifyResult {
  kept: VerifiedFact[];
  dropped: { fact: Fact; reason: string }[];
}

/** Keep facts whose anchors all point at real chunks with verbatim quotes; drop the rest with a reason. */
export function verifyQuotes(facts: Fact[], chunks: ChunkLike[]): VerifyResult {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const kept: VerifiedFact[] = [];
  const dropped: VerifyResult["dropped"] = [];
  for (const fact of facts) {
    const anchors: VerifiedAnchor[] = [];
    let reason: string | null = null;
    for (const a of fact.anchors) {
      const chunk = byId.get(a.chunkId);
      if (!chunk) {
        reason = `anchor points at unknown chunk ${a.chunkId}`;
        break;
      }
      const words = a.quote.trim().split(/\s+/).length;
      if (words < 5 || words > 30) {
        reason = `quote has ${words} words; 5 to 30 required`;
        break;
      }
      const span = locateQuote(chunk.text, a.quote);
      if (!span) {
        reason = `quote not found verbatim in chunk ${a.chunkId}`;
        break;
      }
      anchors.push({ chunkId: a.chunkId, quote: chunk.text.slice(span.start, span.end), ...span });
    }
    if (reason || anchors.length === 0) dropped.push({ fact, reason: reason ?? "no anchors" });
    else kept.push({ ...fact, anchors });
  }
  return { kept, dropped };
}
