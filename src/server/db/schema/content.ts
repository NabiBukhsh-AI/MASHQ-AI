import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, halfvec, id, tsvector, tz, updatedAt } from "./common";
import { organizations, user } from "./identity";

export const SOURCE_TYPES = ["pdf", "docx", "pptx", "txt", "md", "paste", "url", "image"] as const;
export const CONTENT_STATUSES = ["intake", "designing", "ready", "failed"] as const;
export const ANCHOR_KINDS = ["page", "slide", "section", "url"] as const;
export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;

export interface ContentStats {
  bytes?: number;
  pages?: number;
  slides?: number;
  chars: number;
  tokens: number;
  chunks: number;
  redactions: number;
  injectionFlags: number;
  scanned: boolean;
}

export const contents = pgTable(
  "contents",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    sourceType: text("source_type", { enum: SOURCE_TYPES }).notNull(),
    sourceUrl: text("source_url"),
    sourceHash: text("source_hash").notNull(),
    parserVersion: text("parser_version").notNull(),
    langPrimary: text("lang_primary"),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("intake"),
    stats: jsonb("stats").$type<ContentStats>(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    visibility: text("visibility", { enum: ["org", "private"] })
      .notNull()
      .default("org"),
    configOverride: jsonb("config_override").$type<Record<string, unknown>>(),
    isSeeded: boolean("is_seeded").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz("deleted_at"),
  },
  (t) => [
    uniqueIndex("contents_org_source_hash_uq")
      .on(t.orgId, t.sourceHash)
      .where(sql`${t.deletedAt} is null`),
    index("contents_org_created_idx").on(t.orgId, t.createdAt.desc()),
  ],
);

export const contentChunks = pgTable(
  "content_chunks",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    ordinal: integer("ordinal").notNull(),
    anchorKind: text("anchor_kind", { enum: ANCHOR_KINDS }).notNull(),
    anchorRef: text("anchor_ref").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    headingPath: text("heading_path").array().notNull().default([]),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull(),
    lang: text("lang"),
    injectionFlag: boolean("injection_flag").notNull().default(false),
    embedding: halfvec("embedding"),
    tsv: tsvector("tsv").generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`setweight(to_tsvector('english', "text"), 'A') || to_tsvector('simple', "text")`,
    ),
  },
  (t) => [
    uniqueIndex("content_chunks_content_ordinal_uq").on(t.contentId, t.ordinal),
    index("content_chunks_embedding_idx").using("hnsw", t.embedding.op("halfvec_cosine_ops")),
    index("content_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    stage: text("stage").notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    attempts: smallint("attempts").notNull().default(0),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    timings: jsonb("timings").$type<Record<string, number>>(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ingest_jobs_content_idx").on(t.contentId),
    index("ingest_jobs_org_status_idx").on(t.orgId, t.status),
  ],
);

export const glossaryTerms = pgTable(
  "glossary_terms",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    termEn: text("term_en").notNull(),
    termUr: text("term_ur"),
    termRoman: text("term_roman"),
    definition: text("definition").notNull(),
    speechHint: text("speech_hint"),
    chunkIds: uuid("chunk_ids").array().notNull().default([]),
  },
  (t) => [index("glossary_terms_content_idx").on(t.contentId)],
);
