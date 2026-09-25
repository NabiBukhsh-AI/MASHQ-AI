import { ParseError } from "@/lib/parse/errors";

// ZIP guard: read the central directory (the record every
// extractor trusts) before anything is inflated. Local file headers are not
// consulted because an attacker controls them independently. Caps are the
// security limits from the design, not tunables.

export const ZIP_LIMITS = {
  maxEntries: 2_000,
  maxTotalUncompressed: 60 * 1024 * 1024,
  maxEntryUncompressed: 20 * 1024 * 1024,
  maxRatio: 100,
} as const;

const NESTED_ARCHIVE = /\.(zip|jar|7z|rar|gz|tgz|bz2|xz|docx|pptx|xlsx|odt|odp)$/i;
const REQUIRED_PARTS: Record<"docx" | "pptx", string[]> = {
  docx: ["[Content_Types].xml", "word/document.xml"],
  pptx: ["[Content_Types].xml", "ppt/presentation.xml"],
};

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
}

export interface ZipSummary {
  entries: ZipEntry[];
  totalUncompressed: number;
  totalCompressed: number;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const ZIP64_MARK = 0xffffffff;

/** Parse the central directory. Throws ParseError on malformed or ZIP64 archives. */
export function readCentralDirectory(bytes: Uint8Array): ZipSummary {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22)
    throw new ParseError("This file is not a valid Office document (archive too small).");

  // EOCD sits in the last 22 bytes plus an optional comment of at most 65,535 bytes.
  const minEocd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new ParseError("This file is not a valid Office document (archive directory missing).");

  const totalEntries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || cdSize === ZIP64_MARK || cdOffset === ZIP64_MARK) {
    throw new ParseError(
      "This file uses ZIP64, which is too large to accept. Split the document or paste the text.",
    );
  }
  if (totalEntries > ZIP_LIMITS.maxEntries) {
    throw new ParseError(
      `This file has too many internal parts (${totalEntries}). Split the document or paste the text.`,
    );
  }
  if (cdOffset + cdSize > bytes.length) {
    throw new ParseError(
      "This file is not a valid Office document (archive directory out of range).",
    );
  }

  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (let n = 0; n < totalEntries; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CD_SIG) {
      throw new ParseError("This file is not a valid Office document (corrupt archive directory).");
    }
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    if (compressedSize === ZIP64_MARK || uncompressedSize === ZIP64_MARK) {
      throw new ParseError(
        "This file uses ZIP64, which is too large to accept. Split the document or paste the text.",
      );
    }
    const name = new TextDecoder("utf-8").decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    entries.push({ name, compressedSize, uncompressedSize, method });
    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, totalUncompressed, totalCompressed };
}

/**
 * Reject archives that would be dangerous to inflate: too many parts, too
 * large in total or per part, absurd compression ratios, nested archives and
 * path traversal. For Office files, also require the parts a real file has.
 */
export function validateZipFile(bytes: Uint8Array, kind?: "docx" | "pptx"): ZipSummary {
  if (bytes.length === 0) throw new ParseError("This file is empty.");
  const summary = readCentralDirectory(bytes);

  if (summary.totalUncompressed > ZIP_LIMITS.maxTotalUncompressed) {
    throw new ParseError(
      `This file expands to ${Math.round(summary.totalUncompressed / 1048576)} MB, which looks like a zip bomb. It was rejected before extraction.`,
    );
  }
  for (const e of summary.entries) {
    if (e.uncompressedSize > ZIP_LIMITS.maxEntryUncompressed) {
      throw new ParseError(
        `One part of this file (${e.name}) is over 20 MB, which looks like a zip bomb. It was rejected before extraction.`,
      );
    }
    if (e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > ZIP_LIMITS.maxRatio) {
      throw new ParseError(
        `One part of this file (${e.name}) compresses beyond 100:1, which looks like a zip bomb. It was rejected before extraction.`,
      );
    }
    if (/^([a-zA-Z]:)?[\\/]/.test(e.name) || e.name.split(/[\\/]/).includes("..")) {
      throw new ParseError("This file contains an unsafe internal path and was rejected.");
    }
    if (NESTED_ARCHIVE.test(e.name)) {
      throw new ParseError(`This file contains a nested archive (${e.name}) and was rejected.`);
    }
  }
  if (
    summary.totalCompressed > 0 &&
    summary.totalUncompressed / summary.totalCompressed > ZIP_LIMITS.maxRatio
  ) {
    throw new ParseError(
      "This file compresses beyond 100:1 overall, which looks like a zip bomb. It was rejected before extraction.",
    );
  }

  if (kind) {
    const names = new Set(summary.entries.map((e) => e.name));
    const missing = REQUIRED_PARTS[kind].filter((p) => !names.has(p));
    if (missing.length) {
      throw new ParseError(
        `This file is not a valid ${kind.toUpperCase()} document (missing ${missing.join(", ")}). Export it again from Word or PowerPoint, or paste the text.`,
      );
    }
  }
  return summary;
}
