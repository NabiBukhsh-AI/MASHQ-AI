import { and, desc, eq, isNull } from "drizzle-orm";
import type { ParsedDoc } from "@/lib/parse";
import { uuidv7 } from "@/lib/ids";
import { db as defaultDb, type Db } from "../db/client";
import { contents, ingestJobs, type ContentStats, type SOURCE_TYPES } from "../db/schema";

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface ExistingContent {
  contentId: string;
  jobId: string | null;
  stats: ContentStats | null;
  warnings: string[];
}

export interface NewContentInput {
  orgId: string;
  ownerId: string;
  title: string;
  sourceType: SourceType;
  sourceUrl?: string;
  sourceHash: string;
  parserVersion: string;
  langPrimary?: string;
  stats: ContentStats;
  warnings: string[];
  doc: ParsedDoc;
}

/** The database side of intake, kept apart so intake logic is testable with a fake. */
export interface IntakeRepo {
  findByHash(orgId: string, sourceHash: string): Promise<ExistingContent | null>;
  create(
    input: NewContentInput,
  ): Promise<{ contentId: string; jobId: string | null; reused: boolean }>;
}

function isUniqueViolation(e: unknown): boolean {
  const code =
    (e as { code?: string; cause?: { code?: string } })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export function dbIntakeRepo(db: Db = defaultDb): IntakeRepo {
  return {
    async findByHash(orgId, sourceHash) {
      const [row] = await db
        .select({ id: contents.id, stats: contents.stats, warnings: contents.warnings })
        .from(contents)
        .where(
          and(
            eq(contents.orgId, orgId),
            eq(contents.sourceHash, sourceHash),
            isNull(contents.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return null;
      const [job] = await db
        .select({ id: ingestJobs.id })
        .from(ingestJobs)
        .where(eq(ingestJobs.contentId, row.id))
        .orderBy(desc(ingestJobs.createdAt))
        .limit(1);
      return {
        contentId: row.id,
        jobId: job?.id ?? null,
        stats: row.stats,
        warnings: row.warnings,
      };
    },

    async create(input) {
      // Two identical uploads can pass findByHash together; the unique index
      // decides and the loser returns the winner's rows as a reuse.
      const contentId = uuidv7();
      const jobId = uuidv7();
      try {
        await db.batch([
          db.insert(contents).values({
            id: contentId,
            orgId: input.orgId,
            ownerId: input.ownerId,
            title: input.title,
            sourceType: input.sourceType,
            sourceUrl: input.sourceUrl,
            sourceHash: input.sourceHash,
            parserVersion: input.parserVersion,
            langPrimary: input.langPrimary,
            status: "intake",
            stats: input.stats,
            warnings: input.warnings,
          }),
          // The parsed document rides in the job cursor until the chunker runs.
          db.insert(ingestJobs).values({
            id: jobId,
            contentId,
            orgId: input.orgId,
            stage: "parsed",
            status: "queued",
            cursor: { doc: input.doc },
          }),
        ]);
        return { contentId, jobId, reused: false };
      } catch (e) {
        if (isUniqueViolation(e)) {
          const existing = await this.findByHash(input.orgId, input.sourceHash);
          if (existing)
            return { contentId: existing.contentId, jobId: existing.jobId ?? jobId, reused: true };
        }
        throw e;
      }
    },
  };
}
