#!/usr/bin/env tsx
// Runs every dashboard widget against the seeded data and times it.
// Target: every widget query under 300 ms p95 on the seeded dataset.

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");
  const { runWidget, WIDGETS, summarySentence, kpis } =
    await import("../src/server/analytics/queries");
  const { parseFilters } = await import("../src/server/analytics/filters");

  const [org] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, "demo-bank"))
    .limit(1);
  if (!org) throw new Error("No demo-bank org. Run pnpm db:seed first.");

  const filters = parseFilters(new URLSearchParams(""));
  const runs = 20;
  const rows: Array<Record<string, unknown>> = [];

  // The first query of a process pays for the Neon HTTP connection and the plan cache, about
  // 180 ms of it. Charging that to whichever widget happens to be first in WIDGETS reads as a
  // slow query and is not one: it is the cold start that pnpm warmup measures on its own.
  await runWidget(WIDGETS[0]!, org.id, filters);

  for (const widget of WIDGETS) {
    const times: number[] = [];
    let sample: unknown;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      sample = await runWidget(widget, org.id, filters);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = Math.round(times[Math.ceil(0.95 * times.length) - 1]!);
    rows.push({
      widget,
      p50: Math.round(times[Math.floor(times.length / 2)]!),
      p95,
      overBudget: p95 > 300,
      rows: Array.isArray(sample) ? sample.length : 1,
    });
  }

  console.table(rows);

  const k = await kpis(org.id, filters);
  console.log("\nsummary line the manager sees:");
  console.log(`  ${summarySentence(k)}`);

  // The dashboard contract is that changing a filter updates every widget. The e2e suite mocks
  // the analytics API, so it can only assert that a request went out, not that the answer
  // changed. This runs the real queries against the real data and shows the magnitude each
  // widget reports, so a widget that quietly ignores a filter is visible as an equal number.
  const cases: Array<[string, string]> = [
    ["no filter", ""],
    ["languages=ur", "languages=ur"],
    ["modalities=voice", "modalities=voice"],
    ["last 7 days", `from=${new Date(Date.now() - 7 * 86_400_000).toISOString()}`],
  ];
  const narrowing: Array<Record<string, unknown>> = [];
  const ignored: string[] = [];
  for (const widget of WIDGETS) {
    const out: Record<string, unknown> = { widget };
    const totals: number[] = [];
    for (const [label, qs] of cases) {
      const r = await runWidget(widget, org.id, parseFilters(new URLSearchParams(qs)));
      const total = Array.isArray(r)
        ? (r as Array<Record<string, unknown>>).reduce(
            (n, row) =>
              n +
              Number(
                row.abandoned_sessions ?? row.evidence_count ?? row.sessions ?? row.calls ?? 1,
              ),
            0,
          )
        : (() => {
            // summary wraps its numbers in kpis; funnel and kpis carry theirs at the top.
            const o = (r ?? {}) as Record<string, unknown>;
            const inner = (o.kpis ?? o) as Record<string, unknown>;
            return Number(inner.sessions ?? o.started ?? 1);
          })();
      out[label] = total;
      totals.push(total);
    }
    narrowing.push(out);
    // cost and latency read llm_calls, which carries no learner dimension, so they are exempt.
    if (!["cost", "latency"].includes(widget) && new Set(totals).size === 1) {
      ignored.push(widget);
    }
  }
  console.log("\nwhat each widget reports as the filters narrow:");
  console.table(narrowing);

  const slow = rows.filter((r) => r.overBudget);
  if (slow.length > 0) {
    console.error(`over 300 ms: ${slow.map((r) => r.widget).join(", ")}`);
    process.exitCode = 1;
  }
  if (ignored.length > 0) {
    console.error(
      `unchanged under every filter, so the filter is not reaching: ${ignored.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

export {};
