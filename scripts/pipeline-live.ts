#!/usr/bin/env tsx
// Live end-to-end design run against Neon and the real provider:
//   pnpm tsx --env-file-if-exists=.env.local scripts/pipeline-live.ts eval/fixtures/seed/welcoming-customers.md
// Prints every pipeline event with elapsed time, then the llm_calls rows it produced.

import fs from "node:fs";
import path from "node:path";

async function main() {
  const file = process.argv[2] ?? "eval/fixtures/seed/welcoming-customers.md";
  const { eq, sql } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { intake } = await import("../src/server/ingest/intake");
  const { runPipeline } = await import("../src/server/ingest/pipeline");

  const [org] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, "demo-bank"));
  const [admin] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(eq(s.user.role, "admin"))
    .limit(1);
  if (!org || !admin) throw new Error("Seed the database first (pnpm db:seed).");

  const text = fs.readFileSync(path.resolve(file), "utf8");
  const started = performance.now();
  const t = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;

  const result = await intake(
    { kind: "paste", text, title: path.basename(file, ".md") },
    { orgId: org.id, userId: admin.id, role: "admin" },
  );
  console.log(
    `[${t()}] intake: content ${result.contentId} job ${result.jobId} reused=${result.reused} chars=${result.stats.chars}`,
  );

  const out = await runPipeline(result.contentId, org.id, {
    send: (event, data) => {
      const d = JSON.stringify(data);
      console.log(`[${t()}] ${event} ${d.length > 300 ? d.slice(0, 300) + "..." : d}`);
    },
  });
  console.log(`[${t()}] pipeline returned ${JSON.stringify(out)}`);

  const calls = await db.execute(sql`
    select task, status, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, error_code
    from llm_calls where content_id = ${result.contentId} order by created_at`);
  console.table(calls.rows);
  const counts = await db.execute(sql`
    select (select count(*) from content_chunks where content_id = ${result.contentId}) as chunks,
           (select count(*) from concepts where content_id = ${result.contentId}) as concepts,
           (select count(*) from facts where content_id = ${result.contentId}) as facts,
           (select count(*) from missions m join journeys j on j.id = m.journey_id where j.content_id = ${result.contentId} and m.pack_status = 'ready') as ready_missions,
           (select count(*) from glossary_terms where content_id = ${result.contentId}) as glossary`);
  console.log(counts.rows[0]);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
