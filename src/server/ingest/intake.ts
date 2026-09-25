import crypto from "node:crypto";
import { ParseError, parseFile, parseText, type ParsedDoc } from "@/lib/parse";
import type { Config } from "../config/schema";
import { getOrgConfig } from "../config/service";
import type { ContentStats } from "../db/schema";
import { AppError, errors } from "../http/errors";
import { dbIntakeRepo, type IntakeRepo, type SourceType } from "./repo";
import { checkMagicBytes } from "./validate";
import { validateZipFile } from "./zip-guard";

export const PARSER_VERSION = "v1";
// Parsing runs inside the request; well under the 300 s function cap.
const PARSE_TIMEOUT_MS = 20_000;

export type IntakeInput =
  | { kind: "upload"; bytes: Uint8Array; mimeType: string; filename?: string }
  | { kind: "paste"; text: string; title?: string }
  | { kind: "parsed"; doc: ParsedDoc; sourceUrl?: string };

export interface IntakeActor {
  orgId: string;
  userId: string;
  role: "admin" | "ld_manager" | "learner";
}

export interface IntakeResult {
  contentId: string;
  jobId: string | null;
  stats: ContentStats;
  warnings: string[];
  reused: boolean;
}

export interface IntakeDeps {
  repo: IntakeRepo;
  loadConfig: (orgId: string) => Promise<{ config: Config }>;
}

const MIME_TO_TYPE: Record<string, SourceType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/markdown": "md",
  "text/plain": "txt",
};
const EXT_TO_TYPE: Record<string, SourceType> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  md: "md",
  txt: "txt",
};

export function sourceTypeOf(mimeType: string, filename?: string): SourceType | null {
  const ext = filename?.toLowerCase().split(".").pop() ?? "";
  return MIME_TO_TYPE[mimeType.toLowerCase()] ?? EXT_TO_TYPE[ext] ?? null;
}

export function tooLarge(maxMb: number): AppError {
  return new AppError(
    "PAYLOAD_TOO_LARGE",
    413,
    `That is over the ${maxMb} MB limit. Paste the text instead, or use the large-file option in the browser.`,
  );
}

export async function withParseTimeout<T>(promise: Promise<T>, ms = PARSE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          errors.badRequest(
            "This file took too long to read. Try a smaller file or paste the text.",
          ),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Parser failures reach the client as 400s with their message; anything else stays generic. */
export async function readable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof ParseError) throw errors.badRequest(e.message);
    throw errors.badRequest("This file could not be read. Export it again or paste the text.");
  }
}

export function sourceHashOf(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).update(PARSER_VERSION).digest("hex");
}

function statsOf(doc: ParsedDoc, bytes: number): ContentStats {
  const meta = doc.meta ?? {};
  return {
    pages: typeof meta.totalPages === "number" ? meta.totalPages : undefined,
    slides: typeof meta.slideCount === "number" ? meta.slideCount : undefined,
    chars: doc.text.length,
    // Estimate only: the provider measures real prefix tokens later.
    tokens: Math.ceil(doc.text.length / 4),
    chunks: 0,
    redactions: 0,
    injectionFlags: 0,
    scanned: meta.scanned === true,
    bytes,
  };
}

/**
 * Intake: gate by config, cap size, check bytes, guard zips, parse, dedupe by
 * source hash, then store the content row and a queued ingest job that carries
 * the parsed document for chunking. Throws AppError with a message the UI can show.
 */
export async function intake(
  input: IntakeInput,
  actor: IntakeActor,
  deps: IntakeDeps = { repo: dbIntakeRepo(), loadConfig: (orgId) => getOrgConfig(orgId) },
): Promise<IntakeResult> {
  const { config } = await deps.loadConfig(actor.orgId);
  const content = config.content;
  if (actor.role === "learner" && !content.learnerUploads) {
    throw errors.forbidden(
      "Learner uploads are turned off for this organization. Ask an L&D manager to add the content.",
    );
  }
  const maxBytes = Math.floor(content.maxUploadMB * 1024 * 1024);
  const warnings: string[] = [];

  let doc: ParsedDoc;
  let sourceType: SourceType;
  let sourceUrl: string | undefined;
  let bytes = 0;

  if (input.kind === "upload") {
    bytes = input.bytes.length;
    if (bytes > maxBytes) throw tooLarge(content.maxUploadMB);
    const type = sourceTypeOf(input.mimeType, input.filename);
    if (!type || !content.allowedTypes.includes(type)) {
      throw errors.badRequest(
        `That file type is not supported here. Use ${content.allowedTypes.filter((t) => t !== "paste" && t !== "url" && t !== "image").join(", ")}, or paste the text.`,
      );
    }
    sourceType = type;
    if (!checkMagicBytes(input.bytes, input.mimeType, input.filename)) {
      throw errors.badRequest(
        "This file does not look like the type its name says. Export it again and retry, or paste the text.",
      );
    }
    doc = await readable(async () => {
      if (type === "docx" || type === "pptx") validateZipFile(input.bytes, type);
      return withParseTimeout(
        parseFile(input.bytes, input.mimeType, input.filename, {
          maxPages: content.maxPages,
          maxSlides: content.maxSlides,
        }),
      );
    });
  } else if (input.kind === "paste") {
    if (!content.allowedTypes.includes("paste"))
      throw errors.badRequest("Pasted text is turned off for this organization.");
    const encoded = new TextEncoder().encode(input.text);
    bytes = encoded.length;
    if (bytes > maxBytes) throw tooLarge(content.maxUploadMB);
    doc = await readable(async () => parseText(encoded, "text/plain"));
    if (input.title) doc.title = input.title;
    sourceType = "paste";
  } else {
    doc = input.doc;
    bytes = new TextEncoder().encode(doc.text).length;
    if (bytes > maxBytes) throw tooLarge(content.maxUploadMB);
    sourceType = doc.sourceType === "html" ? "url" : (doc.sourceType as SourceType);
    if (!content.allowedTypes.includes(sourceType))
      throw errors.badRequest(
        `Content of type ${sourceType} is not enabled for this organization.`,
      );
    sourceUrl = input.sourceUrl;
  }

  if (!doc.text.trim()) {
    throw errors.badRequest(
      "No readable text was found. If this is a scanned document, ask for a text version.",
    );
  }
  if (doc.text.length > content.maxChars) {
    throw errors.badRequest(
      `This content is longer than the ${content.maxChars.toLocaleString()} character limit. Split it into parts or paste a section.`,
    );
  }
  if (doc.meta?.scanned === true) {
    warnings.push(
      "This document has very little text per page and may be scanned. Facts and questions will be thin; a text version works better.",
    );
  }

  const sourceHash = sourceHashOf(doc.text);
  const existing = await deps.repo.findByHash(actor.orgId, sourceHash);
  if (existing) {
    return {
      contentId: existing.contentId,
      jobId: existing.jobId,
      stats: existing.stats ?? statsOf(doc, bytes),
      warnings: existing.warnings,
      reused: true,
    };
  }

  const title =
    doc.title?.trim() ||
    (input.kind === "upload" && input.filename ? input.filename.replace(/\.[^.]+$/, "") : "") ||
    doc.text.trim().split(/\r?\n/)[0]!.slice(0, 80) ||
    "Untitled";

  const stats = statsOf(doc, bytes);
  const created = await deps.repo.create({
    orgId: actor.orgId,
    ownerId: actor.userId,
    title,
    sourceType,
    sourceUrl,
    sourceHash,
    parserVersion: PARSER_VERSION,
    stats,
    warnings,
    doc,
  });
  return { ...created, stats, warnings };
}
