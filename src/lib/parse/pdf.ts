import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { ParseError } from "./errors";
import type { ParsedBlock, ParsedDoc, ParseLimits } from "./types";

// unpdf "processing untrusted PDFs": bounded image memory, no font faces, and the page
// count checked against the configured cap before any text is extracted.
const MAX_IMAGE_PIXELS = 4 * 1024 * 1024;
const PASSWORD_MESSAGE = "This PDF is password protected. Remove the password or paste the text.";

export async function parsePdf(bytes: Uint8Array, limits: ParseLimits = {}): Promise<ParsedDoc> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js takes ownership of (detaches) the buffer it is given; hand it a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      maxImageSize: MAX_IMAGE_PIXELS,
      disableFontFace: true,
    });
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
    if (name === "PasswordException" || /password/i.test(String((err as Error).message))) {
      throw new ParseError(PASSWORD_MESSAGE);
    }
    throw new ParseError("This PDF could not be opened. Export it again or paste the text.");
  }

  if (limits.maxPages && pdf.numPages > limits.maxPages) {
    throw new ParseError(
      `This PDF has ${pdf.numPages} pages; the limit is ${limits.maxPages}. Split it or paste the section you need.`,
    );
  }

  let pages: string[];
  let totalPages: number;
  try {
    const result = await extractText(pdf, { mergePages: false });
    pages = result.text;
    totalPages = result.totalPages;
  } catch {
    throw new ParseError("This PDF could not be read. Export it again or paste the text.");
  }

  let title: string | undefined;
  try {
    const meta = await getMeta(pdf);
    const t = meta.info?.Title;
    if (typeof t === "string" && t.trim()) title = t.trim();
  } catch {
    // Metadata is optional.
  }

  const blocks: ParsedBlock[] = [];
  let totalChars = 0;
  for (let i = 0; i < pages.length; i++) {
    const pageText = (pages[i] ?? "").trim();
    totalChars += pageText.length;
    blocks.push({ kind: "page", ref: String(i + 1), text: pageText });
  }

  const avgCharsPerPage = totalPages > 0 ? totalChars / totalPages : 0;
  return {
    title,
    sourceType: "pdf",
    blocks,
    text: blocks
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n\n"),
    meta: {
      totalPages,
      totalChars,
      avgCharsPerPage,
      scanned: totalPages > 0 && avgCharsPerPage < 30,
    },
  };
}
