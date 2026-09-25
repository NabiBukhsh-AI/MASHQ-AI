import mammoth from "mammoth";
import { ParseError } from "./errors";
import type { ParsedBlock, ParsedDoc } from "./types";

// mammoth's HTML is small and regular: headings, paragraphs, lists, tables.
// We read structure from it and keep the text exactly as written (no markdown
// escaping, which would break quotes, hashes and PII patterns). Images are dropped.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export async function parseDocx(bytes: Uint8Array): Promise<ParsedDoc> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    );
    html = result.value ?? "";
  } catch {
    throw new ParseError(
      "This Word file could not be opened. Export it again as .docx or paste the text.",
    );
  }

  // Walk block-level elements in order; a heading starts a new section.
  const blocks: ParsedBlock[] = [];
  let heading: string | undefined;
  let lines: string[] = [];
  let section = 0;
  let title: string | undefined;

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text || heading) {
      section++;
      blocks.push({ kind: "section", ref: String(section), heading, text });
    }
    lines = [];
  };

  const re = /<(h[1-6]|p|li|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[1]!.toLowerCase();
    const text = tag === "tr" ? decode(m[2]!.replace(/<\/t[dh]>/gi, " | ")) : decode(m[2]!);
    if (!text) continue;
    if (tag.startsWith("h")) {
      flush();
      heading = text;
      title ??= text;
    } else {
      lines.push(tag === "li" ? `- ${text}` : text);
    }
  }
  flush();

  const fullText = blocks
    .map((b) => (b.heading && b.text ? `${b.heading}\n${b.text}` : b.heading || b.text))
    .join("\n\n");
  return {
    title,
    sourceType: "docx",
    blocks,
    text: fullText,
    meta: { sectionsCount: blocks.length },
  };
}
