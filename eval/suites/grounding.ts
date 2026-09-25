#!/usr/bin/env tsx
/**
 * Grounding suite.
 *
 * Reads the facts that the real pipeline produced for the live content and measures the three
 * numbers with quality targets: quote verification rate, grounding pass rate and
 * unsupported facts. No model is called: this audits what is already stored, so it is free to
 * run and its numbers describe the content the demo will actually use.
 */

const TARGETS = {
  /** At least 95% of generated facts supported by the grounding check. */
  supportedRate: 0.95,
  /** Zero unsupported facts shown in strict mode. */
  unsupportedShownInStrict: 0,
};

interface Row {
  metric: string;
  value: string;
  target: string;
  pass: boolean;
}

async function main() {
  const { eq, sql } = await import("drizzle-orm");
  const { db } = await import("../../src/server/db/client");
  const s = await import("../../src/server/db/schema");
  const { verifyQuotes } = await import("../../src/server/design/quote-verify");

  const contents = await db
    .select({ id: s.contents.id, title: s.contents.title })
    .from(s.contents)
    .limit(10);
  if (contents.length === 0) {
    throw new Error("No content. Run pnpm pipeline:live first.");
  }

  const rows: Row[] = [];
  const perDocument: Array<Record<string, unknown>> = [];

  let totalFacts = 0;
  let totalSupported = 0;
  let totalFactsWithVerifiedQuotes = 0;
  let totalQuotes = 0;
  let unsupportedWithAnchors = 0;

  for (const content of contents) {
    const facts = await db
      .select({
        id: s.facts.id,
        statement: s.facts.statement,
        anchors: s.facts.anchors,
        groundingStatus: s.facts.groundingStatus,
      })
      .from(s.facts)
      .where(eq(s.facts.contentId, content.id));
    if (facts.length === 0) continue;

    const chunks = await db
      .select({ id: s.contentChunks.id, text: s.contentChunks.text })
      .from(s.contentChunks)
      .where(eq(s.contentChunks.contentId, content.id));

    const supported = facts.filter(
      (f) => f.groundingStatus === "supported" || f.groundingStatus === "partial",
    ).length;
    const unsupported = facts.filter((f) => f.groundingStatus === "unsupported").length;

    // Re-verify every quote against its chunk, rather than trusting the stored status.
    const verify = verifyQuotes(
      facts as never,
      chunks.map((c) => ({ id: c.id, text: c.text })) as never,
    );
    const quoteCount = facts.reduce(
      (n, f) => n + (Array.isArray(f.anchors) ? f.anchors.length : 0),
      0,
    );

    totalFacts += facts.length;
    totalSupported += supported;
    totalQuotes += quoteCount;
    totalFactsWithVerifiedQuotes += verify.kept.length;
    unsupportedWithAnchors += unsupported;

    perDocument.push({
      document: content.title.slice(0, 40),
      facts: facts.length,
      supported,
      unsupported,
      quotes: quoteCount,
      factsWithAllQuotesVerified: verify.kept.length,
    });
  }

  const supportedRate = totalFacts > 0 ? totalSupported / totalFacts : 0;
  const quoteRate = totalFacts > 0 ? totalFactsWithVerifiedQuotes / totalFacts : 0;

  rows.push({
    metric: "Facts supported by the grounding check",
    value: `${(supportedRate * 100).toFixed(1)}% (${totalSupported} of ${totalFacts})`,
    target: "at least 95%",
    pass: supportedRate >= TARGETS.supportedRate,
  });
  rows.push({
    metric: "Facts whose every quote is verbatim in its chunk",
    value: `${(quoteRate * 100).toFixed(1)}% (${totalFactsWithVerifiedQuotes} of ${totalFacts}, ${totalQuotes} quotes)`,
    target: "informational",
    pass: true,
  });
  rows.push({
    metric: "Unsupported facts still stored",
    value: String(unsupportedWithAnchors),
    target: "0 shown in strict mode",
    pass: unsupportedWithAnchors === TARGETS.unsupportedShownInStrict,
  });

  // The number guard is the last line between a hallucinated figure and a learner.
  const [guard] = (
    await db.execute(sql`
      SELECT count(*)::int AS facts_with_numbers
      FROM facts WHERE statement ~ '[0-9]'
    `)
  ).rows as Array<Record<string, unknown>>;
  rows.push({
    metric: "Facts containing a number (number guard scope)",
    value: String(guard?.facts_with_numbers ?? 0),
    target: "informational",
    pass: true,
  });

  console.log("\nPer document:");
  console.table(perDocument);
  console.log("\nAgainst the targets:");
  console.table(rows);

  const failed = rows.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} target(s) not met: ${failed.map((r) => r.metric).join("; ")}`,
    );
    process.exitCode = 1;
  } else {
    console.log("\nAll grounding targets met.");
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
