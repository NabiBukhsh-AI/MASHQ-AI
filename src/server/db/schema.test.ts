import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema";

const tables = Object.values(schema).filter(
  (v): v is (typeof schema)["contents"] =>
    typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in v,
);

describe("schema definition", () => {
  it("covers every table in the schema", () => {
    const names = tables.map(getTableName).sort();
    expect(names).toEqual(
      [
        "organizations",
        "user",
        "session",
        "account",
        "verification",
        "roles",
        "contents",
        "content_chunks",
        "ingest_jobs",
        "glossary_terms",
        "concepts",
        "concept_edges",
        "facts",
        "journeys",
        "missions",
        "learning_sessions",
        "turns",
        "evidence_events",
        "mastery_states",
        "learner_profiles",
        "adaptation_events",
        "xp_ledger",
        "badges",
        "user_badges",
        "streaks",
        "configs",
        "config_audit",
        "llm_calls",
        "media_usage",
        "spend_daily",
        "feedback",
        "report_exports",
        "data_deletions",
      ].sort(),
    );
  });

  it("puts org_id on every tenant table", () => {
    const exempt = new Set([
      "organizations",
      "user",
      "session",
      "account",
      "verification",
      "roles",
      "badges",
      "user_badges",
      "streaks",
      "learner_profiles",
      "concept_edges",
      "facts",
      "missions",
      "glossary_terms",
      "mastery_states",
    ]);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      if (exempt.has(cfg.name)) continue;
      expect(
        cfg.columns.map((c) => c.name),
        cfg.name,
      ).toContain("org_id");
    }
  });
});

// Live check against the migrated database. Skipped without a real DATABASE_URL (CI).
describe.skipIf(!process.env.LIVE_DB)("migrated database", () => {
  it("has every table and index the schema declares", async () => {
    const { db } = await import("./client");
    const live = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const liveTables = new Set(live.rows.map((r) => r.table_name as string));
    for (const t of tables) expect(liveTables.has(getTableName(t)), getTableName(t)).toBe(true);

    const idx = await db.execute(sql`select indexname from pg_indexes where schemaname = 'public'`);
    const liveIndexes = new Set(idx.rows.map((r) => r.indexname as string));
    for (const t of tables) {
      for (const i of getTableConfig(t).indexes) {
        expect(liveIndexes.has(i.config.name!), `${getTableName(t)}.${i.config.name}`).toBe(true);
      }
    }
    expect(liveIndexes.has("content_chunks_embedding_idx")).toBe(true);
    expect(liveIndexes.has("content_chunks_tsv_idx")).toBe(true);
  }, 30_000);

  it("has pgvector and the halfvec column", async () => {
    const { db } = await import("./client");
    const ext = await db.execute(sql`select extversion from pg_extension where extname = 'vector'`);
    expect(ext.rows.length).toBe(1);
    const col = await db.execute(
      sql`select udt_name from information_schema.columns where table_name = 'content_chunks' and column_name = 'embedding'`,
    );
    expect(col.rows[0]?.udt_name).toBe("halfvec");
  }, 30_000);
});
