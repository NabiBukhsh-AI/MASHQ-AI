#!/usr/bin/env tsx
// Lists the analytics views and times each one, so a view that needs promoting to
// materialized (p95 over 300 ms) shows up rather than being assumed.

const VIEWS = [
  "v_session_facts",
  "v_mastery_matrix",
  "v_mastery_gain",
  "v_funnel",
  "v_mission_dropoff",
  "v_content_health",
  "v_language_voice_usage",
  "v_latency",
  "v_cost_daily",
  "v_cache_efficiency",
];

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");

  const present = await db.execute(
    sql`select table_name from information_schema.views where table_schema = 'public' order by table_name`,
  );
  const names = present.rows.map((r) => String(r.table_name));
  console.log(`views present: ${names.length}`);

  const missing = VIEWS.filter((v) => !names.includes(v));
  if (missing.length > 0) {
    throw new Error(`missing views: ${missing.join(", ")}. Run pnpm db:views.`);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const view of VIEWS) {
    const t0 = performance.now();
    const res = await db.execute(sql.raw(`select count(*) as n from ${view}`));
    const ms = Math.round(performance.now() - t0);
    rows.push({ view, rows: Number(res.rows[0]?.n ?? 0), ms, overBudget: ms > 300 });
  }
  console.table(rows);

  const slow = rows.filter((r) => r.overBudget);
  if (slow.length > 0) {
    console.warn(
      `over the 300 ms budget: ${slow.map((r) => r.view).join(", ")}. Consider a materialized view.`,
    );
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

export {};
