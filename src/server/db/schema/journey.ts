import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tz } from "./common";
import { contents } from "./content";
import { organizations } from "./identity";

export const GROUNDING_STATUSES = [
  "pending",
  "supported",
  "partial",
  "unsupported",
  "unchecked",
] as const;
export const PACK_STATUSES = ["pending", "generating", "ready", "failed"] as const;

export interface Misconception {
  id: string;
  belief: string;
  correction: string;
  factIds: string[];
}

export interface FactAnchor {
  chunkId: string;
  quote: string;
  start: number;
  end: number;
}

export const concepts = pgTable(
  "concepts",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    nameUr: text("name_ur"),
    summary: text("summary").notNull(),
    difficulty: smallint("difficulty").notNull(),
    importance: smallint("importance").notNull(),
    chunkIds: uuid("chunk_ids").array().notNull().default([]),
    misconceptions: jsonb("misconceptions").$type<Misconception[]>().notNull().default([]),
    applications: jsonb("applications").$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("concepts_content_key_uq").on(t.contentId, t.key)],
);

export const conceptEdges = pgTable(
  "concept_edges",
  {
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    fromConceptId: uuid("from_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    toConceptId: uuid("to_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["prerequisite", "related"] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromConceptId, t.toConceptId, t.kind] }),
    index("concept_edges_content_idx").on(t.contentId),
  ],
);

export const facts = pgTable(
  "facts",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    /** The id the design model used (f_...), so mission packs can reference facts by it. */
    key: text("key"),
    statement: text("statement").notNull(),
    anchors: jsonb("anchors").$type<FactAnchor[]>().notNull().default([]),
    quoteVerified: boolean("quote_verified").notNull().default(false),
    groundingStatus: text("grounding_status", { enum: GROUNDING_STATUSES })
      .notNull()
      .default("pending"),
    groundingNote: text("grounding_note"),
    checkedAt: tz("checked_at"),
    promptVersion: text("prompt_version").notNull(),
  },
  (t) => [
    index("facts_concept_idx").on(t.conceptId),
    index("facts_content_grounding_idx").on(t.contentId, t.groundingStatus),
    // Unique, not just indexed. A fact key is what a mission pack cites and what the source
    // chip resolves, so two rows sharing one key means "show source" can open the quote of
    // the wrong one. Concepts stopped being deleted on a re-design, so nothing else clears
    // the previous generation's facts any more.
    uniqueIndex("facts_content_key_uq").on(t.contentId, t.key),
  ],
);

export const journeys = pgTable(
  "journeys",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    designHash: text("design_hash").notNull(),
    title: text("title").notNull(),
    story: jsonb("story").$type<Record<string, unknown>>().notNull(),
    outline: jsonb("outline").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["designing", "ready", "failed"] })
      .notNull()
      .default("designing"),
    promptVersion: text("prompt_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("journeys_content_design_hash_uq").on(t.contentId, t.designHash)],
);

export const missions = pgTable(
  "missions",
  {
    id: id(),
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    chapterKey: text("chapter_key").notNull(),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull(),
    conceptIds: uuid("concept_ids").array().notNull().default([]),
    primaryMechanic: text("primary_mechanic").notNull(),
    alternates: text("alternates").array().notNull().default([]),
    pack: jsonb("pack").$type<Record<string, unknown>>(),
    packStatus: text("pack_status", { enum: PACK_STATUSES }).notNull().default("pending"),
    groundingSummary: jsonb("grounding_summary").$type<Record<string, unknown>>(),
    promptVersion: text("prompt_version"),
    generatedAt: tz("generated_at"),
  },
  (t) => [
    uniqueIndex("missions_journey_ordinal_uq").on(t.journeyId, t.ordinal),
    index("missions_pending_idx")
      .on(t.journeyId)
      .where(sql`${t.packStatus} in ('pending', 'generating')`),
  ],
);
