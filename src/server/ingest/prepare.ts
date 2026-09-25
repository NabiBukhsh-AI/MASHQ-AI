import { and, desc, eq } from "drizzle-orm";
import { ParsedDocSchema, type ParsedDoc } from "@/lib/parse";
import type { Config } from "../config/schema";
import { db as defaultDb, type Db } from "../db/client";
import { contentChunks, contents, ingestJobs, type ContentStats } from "../db/schema";
import { errors } from "../http/errors";
import { log } from "../obs/logger";
import { createRedactor } from "../security/redact";
import { chunkDocument } from "./chunk";
import { injectionWarning, scanChunk } from "./inject-scan";
import { detectLang } from "./lang";
import { normalize } from "./normalize";

export interface PrepareResult {
  chunks: number;
  redactions: number;
  injectionFlags: number;
  langPrimary: string;
  warnings: string[];
  reused: boolean;
}

/**
 * The stage between intake and design: take the parsed
 * document from the queued ingest job, normalize, redact, scan for injection,
 * chunk with anchors, store the chunks, and record stats. Idempotent: a content
 * that already has chunks is left alone. Original text never leaves the job row.
 */
export async function prepareContent(
  contentId: string,
  orgId: string,
  config: Config,
  db: Db = defaultDb,
): Promise<PrepareResult> {
  const [content] = await db
    .select({
      id: contents.id,
      stats: contents.stats,
      warnings: contents.warnings,
      status: contents.status,
      langPrimary: contents.langPrimary,
    })
    .from(contents)
    .where(and(eq(contents.id, contentId), eq(contents.orgId, orgId)))
    .limit(1);
  if (!content)
    throw errors.notFound("That content does not exist or is not in your organization.");

  const [existing] = await db
    .select({ id: contentChunks.id })
    .from(contentChunks)
    .where(eq(contentChunks.contentId, contentId))
    .limit(1);
  if (existing) {
    const stats = content.stats ?? ({} as ContentStats);
    return {
      chunks: stats.chunks ?? 0,
      redactions: stats.redactions ?? 0,
      injectionFlags: stats.injectionFlags ?? 0,
      // Was a hardcoded "en", so an Urdu document run a second time reported English.
      langPrimary: content.langPrimary ?? "en",
      warnings: content.warnings,
      reused: true,
    };
  }

  const [job] = await db
    .select({ id: ingestJobs.id, cursor: ingestJobs.cursor })
    .from(ingestJobs)
    .where(and(eq(ingestJobs.contentId, contentId), eq(ingestJobs.orgId, orgId)))
    .orderBy(desc(ingestJobs.createdAt))
    .limit(1);
  const parsed = ParsedDocSchema.safeParse((job?.cursor as { doc?: unknown } | null)?.doc);
  if (!job || !parsed.success) {
    throw errors.badRequest("The uploaded text is no longer available. Upload the file again.");
  }
  await db
    .update(ingestJobs)
    .set({ stage: "prepare", status: "running", attempts: 1 })
    .where(eq(ingestJobs.id, job.id));

  const started = performance.now();
  const doc: ParsedDoc = normalize(parsed.data);
  if (!doc.blocks.length || !doc.text.trim()) {
    await db
      .update(ingestJobs)
      .set({ status: "failed", error: "no text after normalization" })
      .where(eq(ingestJobs.id, job.id));
    await db.update(contents).set({ status: "failed" }).where(eq(contents.id, contentId));
    throw errors.badRequest(
      "No readable text was left after cleaning this document. Try a text version.",
    );
  }

  const raw = chunkDocument(doc, config.content.chunk);
  // One redactor per document keeps placeholder numbers coherent across chunks.
  const redactor = createRedactor();
  let redactions = 0;
  const flagged: {
    ordinal: number;
    anchor: { kind: string; ref: string };
    scan: ReturnType<typeof scanChunk>;
  }[] = [];
  const rows = raw.map((c) => {
    const r = redactor.redact(c.text);
    redactions += Object.values(r.counts).reduce((a, b) => a + b, 0);
    const scan = scanChunk(r.text);
    if (scan.flagged) flagged.push({ ordinal: c.ordinal, anchor: c.anchor, scan });
    return {
      contentId,
      orgId,
      ordinal: c.ordinal,
      anchorKind: c.anchor.kind,
      anchorRef: c.anchor.ref,
      charStart: c.anchor.start,
      charEnd: c.anchor.end,
      headingPath: c.headingPath,
      text: r.text,
      tokenCount: c.tokenCount,
      lang: c.lang,
      injectionFlag: scan.flagged,
    };
  });
  if (!rows.length)
    throw errors.badRequest("This document produced no passages to learn from. Try a longer text.");

  // Neon HTTP: insert in batches to keep each statement small.
  for (let i = 0; i < rows.length; i += 100)
    await db.insert(contentChunks).values(rows.slice(i, i + 100));

  // The uploader's choice wins; detection only fills the gap when they left it on Auto.
  const langPrimary = content.langPrimary ?? detectLang(doc.text.slice(0, 20_000));
  const warnings = [...content.warnings];
  const injectionNote = injectionWarning(flagged);
  if (injectionNote) warnings.push(injectionNote);
  if (redactions > 0)
    warnings.push(
      `${redactions} personal identifier${redactions === 1 ? "" : "s"} (CNIC, phone, IBAN, card or email) were replaced with placeholders before storage.`,
    );

  const prev = content.stats ?? ({} as ContentStats);
  const stats: ContentStats = {
    ...prev,
    chars: doc.text.length,
    tokens: rows.reduce((a, r) => a + r.tokenCount, 0),
    chunks: rows.length,
    redactions,
    injectionFlags: flagged.length,
    scanned: prev.scanned ?? false,
  };
  await db
    .update(contents)
    .set({ stats, warnings, langPrimary, status: "designing" })
    .where(eq(contents.id, contentId));
  await db
    .update(ingestJobs)
    .set({
      stage: "prepare",
      status: "done",
      timings: { prepareMs: Math.round(performance.now() - started) },
    })
    .where(eq(ingestJobs.id, job.id));

  log.info({
    event: "prepare_done",
    contentId,
    chunks: rows.length,
    redactions,
    injectionFlags: flagged.length,
    langPrimary,
  });
  return {
    chunks: rows.length,
    redactions,
    injectionFlags: flagged.length,
    langPrimary,
    warnings,
    reused: false,
  };
}
