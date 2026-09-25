#!/usr/bin/env tsx
// Counts the rows that a re-ingest must not destroy. Used to prove the concept upsert in
// src/server/design/outline.ts keeps learner progress across a re-design.

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const [row] = (
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM mastery_states)::int   AS mastery,
        (SELECT count(*) FROM evidence_events)::int  AS evidence,
        (SELECT count(*) FROM concepts)::int         AS concepts
    `)
  ).rows as Array<Record<string, unknown>>;
  console.log(
    `mastery=${row?.mastery ?? 0} evidence=${row?.evidence ?? 0} concepts=${row?.concepts ?? 0}`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

export {};
