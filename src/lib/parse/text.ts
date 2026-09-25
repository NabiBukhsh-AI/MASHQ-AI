import { ParseError } from "./errors";
import type { ParsedBlock, ParsedDoc } from "./types";

export function parseText(bytes: Uint8Array, mimeType = "text/plain"): ParsedDoc {
  // Check for NUL bytes which indicate binary content rather than valid text
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      throw new ParseError(
        "This text file contains binary data. Save it as plain UTF-8 text and try again.",
      );
    }
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let rawText = "";
  try {
    rawText = decoder.decode(bytes);
  } catch {
    throw new ParseError("This text file is not UTF-8. Save it as UTF-8 text and try again.");
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      sourceType: mimeType === "text/markdown" ? "md" : "txt",
      blocks: [],
      text: "",
    };
  }

  const lines = trimmed.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];
  let sectionIndex = 1;
  let docTitle: string | undefined;

  const flushBlock = () => {
    const text = currentLines.join("\n").trim();
    if (text || currentHeading) {
      blocks.push({
        kind: "section",
        ref: String(sectionIndex++),
        heading: currentHeading,
        text: text || currentHeading || "",
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushBlock();
      currentHeading = headingMatch[2]?.trim();
      if (!docTitle && headingMatch[1] === "#") {
        docTitle = currentHeading;
      }
    } else {
      currentLines.push(line);
    }
  }
  flushBlock();

  // If no markdown headings were found, group by paragraphs
  if (blocks.length === 0) {
    const paragraphs = trimmed
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (let i = 0; i < paragraphs.length; i++) {
      blocks.push({
        kind: "section",
        ref: String(i + 1),
        text: paragraphs[i]!,
      });
    }
    if (!docTitle && paragraphs.length > 0) {
      docTitle = paragraphs[0]?.slice(0, 60);
    }
  }

  const isMd = mimeType === "text/markdown" || lines.some((l) => /^#{1,6}\s+/.test(l));

  return {
    title: docTitle,
    sourceType: isMd ? "md" : "txt",
    blocks,
    text: trimmed,
    meta: {
      paragraphsCount: blocks.length,
    },
  };
}
