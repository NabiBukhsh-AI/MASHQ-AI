import type { ParsedDoc, ParseLimits } from "./types";
import { parsePdf } from "./pdf";
import { parseDocx } from "./docx";
import { parsePptx } from "./pptx";
import { parseText } from "./text";

export * from "./types";
export { parsePdf } from "./pdf";
export { parseDocx } from "./docx";
export { parsePptx } from "./pptx";
export { parseText } from "./text";
export { parseHtml } from "./html";
export { ParseError } from "./errors";

export async function parseFile(
  bytes: Uint8Array,
  mimeType: string,
  filename?: string,
  limits: ParseLimits = {},
): Promise<ParsedDoc> {
  const ext = filename?.toLowerCase().split(".").pop() || "";
  const type = mimeType.toLowerCase();

  if (type === "application/pdf" || ext === "pdf") {
    return parsePdf(bytes, limits);
  }

  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return parseDocx(bytes);
  }

  if (
    type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  ) {
    return parsePptx(bytes, limits);
  }

  if (type === "text/markdown" || ext === "md") {
    return parseText(bytes, "text/markdown");
  }

  // Default to text parser for text/plain and other text files
  return parseText(bytes, type);
}
