#!/usr/bin/env tsx
/**
 * Exports the journeys generated through the live pipeline to JSON fixtures.
 *
 * The demo seed needs a ready journey to attach sessions to, and without these files it threw
 * "No ready journey to attach demo sessions to. Run pnpm pipeline:live first." on a fresh
 * database. The task is explicit that there are to be no LLM calls at seed time, so the design
 * work is done once, here, and committed.
 *
 *   pnpm fixtures:export            exports every ready journey in the demo org
 *   pnpm fixtures:export --slug x   just one, by content slug
 */

import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "eval/fixtures/seed/journeys");

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { and, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const s = await import("../src/server/db/schema");

  const [org] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, "demo-bank"))
    .limit(1);
  if (!org) throw new Error("No demo-bank org. Run pnpm db:seed first.");

  const wanted = argValue("--slug");
  const journeyRows = await db
    .select()
    .from(s.journeys)
    .where(and(eq(s.journeys.orgId, org.id), eq(s.journeys.status, "ready")));

  if (journeyRows.length === 0) throw new Error("No ready journey to export.");

  fs.mkdirSync(OUT, { recursive: true });
  const written: Array<Record<string, unknown>> = [];

  for (const journey of journeyRows) {
    const [content] = await db
      .select()
      .from(s.contents)
      .where(eq(s.contents.id, journey.contentId))
      .limit(1);
    if (!content) continue;
    // contents has no slug column, so the file name comes from the title. It is stable for a
    // given document and is only ever a file name, never an identifier the import relies on.
    const slug = content.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    if (wanted && slug !== wanted) continue;

    const [chunks, conceptRows, missionRows, glossary] = await Promise.all([
      db.select().from(s.contentChunks).where(eq(s.contentChunks.contentId, content.id)),
      db.select().from(s.concepts).where(eq(s.concepts.contentId, content.id)),
      db.select().from(s.missions).where(eq(s.missions.journeyId, journey.id)),
      db.select().from(s.glossaryTerms).where(eq(s.glossaryTerms.contentId, content.id)),
    ]);
    const factRows = conceptRows.length
      ? await db
          .select()
          .from(s.facts)
          .where(
            inArray(
              s.facts.conceptId,
              conceptRows.map((c) => c.id),
            ),
          )
      : [];

    // Ids are dropped on import and regenerated, so the fixture refers to things by their
    // stable keys instead. Embeddings are not exported: they are large, and the ingest path
    // recomputes them. A fixture journey is playable by text without them.
    const fixture = {
      version: 1,
      exportedAt: new Date().toISOString(),
      content: {
        title: content.title,
        sourceType: content.sourceType,
        sourceHash: content.sourceHash,
        parserVersion: content.parserVersion,
        langPrimary: content.langPrimary,
        status: content.status,
        stats: content.stats,
        warnings: content.warnings,
      },
      chunks: chunks
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((c) => ({
          ordinal: c.ordinal,
          text: c.text,
          anchorKind: c.anchorKind,
          anchorRef: c.anchorRef,
          charStart: c.charStart,
          charEnd: c.charEnd,
          headingPath: c.headingPath,
          tokenCount: c.tokenCount,
          lang: c.lang,
          injectionFlag: c.injectionFlag,
        })),
      journey: {
        title: journey.title,
        outline: journey.outline,
        story: journey.story,
        designHash: journey.designHash,
        status: journey.status,
        promptVersion: journey.promptVersion,
      },
      concepts: conceptRows.map((c) => ({
        key: c.key,
        name: c.name,
        nameUr: c.nameUr,
        summary: c.summary,
        difficulty: c.difficulty,
        importance: c.importance,
        misconceptions: c.misconceptions,
        // Chunk ids become ordinals, so they survive reimport into a new database.
        chunkOrdinals: (c.chunkIds ?? [])
          .map((id) => chunks.find((ch) => ch.id === id)?.ordinal)
          .filter((n): n is number => typeof n === "number"),
      })),
      facts: factRows.map((f) => ({
        key: f.key,
        conceptKey: conceptRows.find((c) => c.id === f.conceptId)?.key ?? null,
        statement: f.statement,
        anchors: f.anchors,
        quoteVerified: f.quoteVerified,
        groundingStatus: f.groundingStatus,
        groundingNote: f.groundingNote,
        promptVersion: f.promptVersion,
      })),
      missions: missionRows
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((m) => ({
          ordinal: m.ordinal,
          chapterKey: m.chapterKey,
          title: m.title,
          primaryMechanic: m.primaryMechanic,
          alternates: m.alternates,
          packStatus: m.packStatus,
          pack: m.pack,
          promptVersion: m.promptVersion,
          conceptKeys: (m.conceptIds ?? [])
            .map((id) => conceptRows.find((c) => c.id === id)?.key)
            .filter((k): k is string => typeof k === "string"),
        })),
      glossary: glossary.map((g) => ({
        termEn: g.termEn,
        termUr: g.termUr,
        termRoman: g.termRoman,
        definition: g.definition,
        speechHint: g.speechHint,
      })),
    };

    const file = path.join(OUT, `${slug}.json`);
    fs.writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
    written.push({
      slug,
      chunks: fixture.chunks.length,
      concepts: fixture.concepts.length,
      facts: fixture.facts.length,
      missions: fixture.missions.length,
      packs: fixture.missions.filter((m) => m.packStatus === "ready").length,
      glossary: fixture.glossary.length,
      kb: Math.round(fs.statSync(file).size / 1024),
    });
  }

  if (written.length === 0) throw new Error("Nothing matched, so nothing was written.");
  console.table(written);
  console.log(`\nwritten to ${path.relative(process.cwd(), OUT).replaceAll("\\", "/")}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

export {};
