import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tz } from "./common";
import { contents } from "./content";
import { organizations, user } from "./identity";
import { learningSessions, turns } from "./learning";

export const LLM_CALL_STATUSES = ["ok", "error", "timeout", "retracted"] as const;

/** One row per model call. No prompt or output text, ever. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    sessionId: uuid("session_id").references(() => learningSessions.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    task: text("task").notNull(),
    tier: text("tier").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    latencyMs: integer("latency_ms"),
    ttftMs: integer("ttft_ms"),
    status: text("status", { enum: LLM_CALL_STATUSES }).notNull(),
    fallback: boolean("fallback").notNull().default(false),
    errorCode: text("error_code"),
    traceId: text("trace_id"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("llm_calls_org_created_idx").on(t.orgId, t.createdAt),
    index("llm_calls_session_created_idx").on(t.sessionId, t.createdAt),
    index("llm_calls_task_created_idx").on(t.task, t.createdAt),
  ],
);

export const mediaUsage = pgTable(
  "media_usage",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    sessionId: uuid("session_id").references(() => learningSessions.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["stt", "tts"] }).notNull(),
    provider: text("provider").notNull(),
    lang: text("lang"),
    seconds: real("seconds"),
    chars: integer("chars"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    ttfbMs: integer("ttfb_ms"),
    failover: boolean("failover").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("media_usage_org_created_idx").on(t.orgId, t.createdAt)],
);

/** `day` is the Asia/Karachi calendar date. */
export const spendDaily = pgTable(
  "spend_daily",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    day: date("day").notNull(),
    provider: text("provider").notNull(),
    usd: numeric("usd", { precision: 10, scale: 4 }).notNull().default("0"),
    tokens: bigint("tokens", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.day, t.provider] })],
);

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references(() => learningSessions.id, { onDelete: "set null" }),
    turnId: uuid("turn_id").references(() => turns.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["reaction", "survey"] }).notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_org_created_idx").on(t.orgId, t.createdAt)],
);

/** No file is stored; this is the audit of who exported what. */
export const reportExports = pgTable(
  "report_exports",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    reportType: text("report_type").notNull(),
    format: text("format", { enum: ["csv", "print"] }).notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    rowCount: integer("row_count"),
    createdAt: createdAt(),
  },
  (t) => [index("report_exports_org_created_idx").on(t.orgId, t.createdAt)],
);

export const dataDeletions = pgTable("data_deletions", {
  id: id(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  pseudonym: text("pseudonym").notNull(),
  requestedAt: tz("requested_at").defaultNow().notNull(),
  completedAt: tz("completed_at"),
  counts: jsonb("counts").$type<Record<string, number>>(),
});
