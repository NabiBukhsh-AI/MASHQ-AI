import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./common";
import { organizations, user } from "./identity";

export const AUDIT_ENTITIES = ["config", "role", "content", "demo", "privacy", "preset"] as const;

export const configs = pgTable(
  "configs",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    version: integer("version").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    isActive: boolean("is_active").notNull().default(false),
  },
  (t) => [
    uniqueIndex("configs_org_version_uq").on(t.orgId, t.version),
    uniqueIndex("configs_org_active_uq")
      .on(t.orgId)
      .where(sql`${t.isActive}`),
  ],
);

/** Append-only. `diff` is an RFC 6902 JSON Patch. */
export const configAudit = pgTable(
  "config_audit",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    actorId: text("actor_id").references(() => user.id),
    entity: text("entity", { enum: AUDIT_ENTITIES }).notNull(),
    action: text("action").notNull(),
    fromVersion: integer("from_version"),
    toVersion: integer("to_version"),
    diff: jsonb("diff").$type<unknown[]>(),
    reason: text("reason"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("config_audit_org_created_idx").on(t.orgId, t.createdAt.desc())],
);
