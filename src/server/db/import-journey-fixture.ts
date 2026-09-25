import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { uuidv7 } from "@/lib/ids";
import { db as defaultDb, type Db } from "./client";
import {
  contents,
  contentChunks,
  concepts,
  facts,
  glossaryTerms,
  journeys,
  missions,
  user,
} from "./schema";

/**
 * Loads a journey exported by `pnpm fixtures:export` into an empty database.
 *
 * The demo seed needs a ready journey to attach sessions to, and on a fresh database it threw
 * "Run pnpm pipeline:live first", which costs model calls, and seeding must
 * make no LLM calls. The design work was done once through the live
 * pipeline and committed as JSON, so seeding is now deterministic and free.
 *
 * Ids are regenerated on import and cross references are rebuilt from the stable keys, so a
 * fixture can be loaded into any database without carrying its old ids in.
 */

const DIR = path.resolve(process.cwd(), "eval/fixtures/seed/journeys");

interface Fixture {
  version: number;
  content: Record<string, unknown>;
  chunks: Array<Record<string, unknown>>;
  journey: Record<string, unknown>;
  concepts: Array<Record<string, unknown> & { key: string; chunkOrdinals: number[] }>;
  facts: Array<Record<string, unknown> & { conceptKey: string | null }>;
  missions: Array<Record<string, unknown> & { conceptKeys: string[]; ordinal: number }>;
  glossary: Array<Record<string, unknown>>;
}

export function listJourneyFixtures(): string[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export interface ImportResult {
  slug: string;
  contentId: string;
  journeyId: string;
  chunks: number;
  concepts: number;
  facts: number;
  missions: number;
  glossary: number;
}

/** Imports one fixture file. Returns null if this content is already present in the org. */
export async function importJourneyFixture(
  file: string,
  orgId: string,
  ownerId: string,
  deps: { db?: Db } = {},
): Promise<ImportResult | null> {
  const db = deps.db ?? defaultDb;
  const slug = path.basename(file, ".json");
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as Fixture;

  const sourceHash = String(fx.content.sourceHash);
  // contents has a unique index on (org_id, source_hash), so this is the idempotency key.
  const [existing] = await db
    .select({ id: contents.id })
    .from(contents)
    .where(and(eq(contents.orgId, orgId), eq(contents.sourceHash, sourceHash)))
    .limit(1);
  if (existing) return null;

  const contentId = uuidv7();
  await db.insert(contents).values({
    id: contentId,
    orgId,
    ownerId,
    title: String(fx.content.title),
    sourceType: fx.content.sourceType as "md",
    sourceHash,
    parserVersion: String(fx.content.parserVersion),
    langPrimary: (fx.content.langPrimary as string | null) ?? null,
    status: fx.content.status as "ready",
    stats: fx.content.stats as never,
    warnings: (fx.content.warnings as string[]) ?? [],
    isSeeded: true,
  });

  // Chunks first: concepts and facts point at them by ordinal.
  const chunkIdByOrdinal = new Map<number, string>();
  if (fx.chunks.length > 0) {
    const rows = fx.chunks.map((c) => {
      const id = uuidv7();
      chunkIdByOrdinal.set(Number(c.ordinal), id);
      return {
        id,
        contentId,
        orgId,
        ordinal: Number(c.ordinal),
        anchorKind: c.anchorKind as "section",
        anchorRef: String(c.anchorRef),
        charStart: Number(c.charStart),
        charEnd: Number(c.charEnd),
        headingPath: (c.headingPath as string[]) ?? [],
        text: String(c.text),
        tokenCount: Number(c.tokenCount),
        lang: (c.lang as string | null) ?? null,
        injectionFlag: Boolean(c.injectionFlag),
      };
    });
    await db.insert(contentChunks).values(rows);
  }

  const journeyId = uuidv7();
  await db.insert(journeys).values({
    id: journeyId,
    orgId,
    contentId,
    title: String(fx.journey.title),
    outline: fx.journey.outline as never,
    story: fx.journey.story as never,
    designHash: String(fx.journey.designHash),
    status: fx.journey.status as "ready",
    promptVersion: String(fx.journey.promptVersion ?? "1"),
  });

  const conceptIdByKey = new Map<string, string>();
  if (fx.concepts.length > 0) {
    const rows = fx.concepts.map((c) => {
      const id = uuidv7();
      conceptIdByKey.set(c.key, id);
      return {
        id,
        contentId,
        orgId,
        key: c.key,
        name: String(c.name),
        nameUr: (c.nameUr as string | null) ?? null,
        summary: String(c.summary),
        difficulty: Number(c.difficulty),
        importance: Number(c.importance),
        misconceptions: (c.misconceptions as never) ?? [],
        chunkIds: c.chunkOrdinals
          .map((o) => chunkIdByOrdinal.get(o))
          .filter((v): v is string => Boolean(v)),
      };
    });
    await db.insert(concepts).values(rows);
  }

  // A fact whose concept did not survive is dropped rather than re-pointed: an arbitrary
  // citation is worse than a missing one.
  const factRows = fx.facts
    .filter((f) => f.conceptKey && conceptIdByKey.has(f.conceptKey))
    .map((f) => ({
      id: uuidv7(),
      contentId,
      conceptId: conceptIdByKey.get(f.conceptKey!)!,
      key: (f.key as string | null) ?? null,
      statement: String(f.statement),
      anchors: (f.anchors as never) ?? [],
      quoteVerified: Boolean(f.quoteVerified),
      groundingStatus: f.groundingStatus as "supported",
      groundingNote: (f.groundingNote as string | null) ?? null,
      checkedAt: new Date(),
      promptVersion: String(f.promptVersion),
    }));
  if (factRows.length > 0) await db.insert(facts).values(factRows);

  if (fx.missions.length > 0) {
    await db.insert(missions).values(
      fx.missions.map((m) => ({
        id: uuidv7(),
        journeyId,
        orgId,
        ordinal: m.ordinal,
        chapterKey: String(m.chapterKey),
        title: String(m.title),
        primaryMechanic: m.primaryMechanic as never,
        alternates: (m.alternates as never) ?? [],
        packStatus: m.packStatus as "ready",
        pack: (m.pack as never) ?? null,
        promptVersion: String(m.promptVersion),
        conceptIds: m.conceptKeys
          .map((k) => conceptIdByKey.get(k))
          .filter((v): v is string => Boolean(v)),
      })),
    );
  }

  if (fx.glossary.length > 0) {
    await db.insert(glossaryTerms).values(
      fx.glossary.map((g) => ({
        id: uuidv7(),
        contentId,
        orgId,
        termEn: String(g.termEn),
        termUr: (g.termUr as string | null) ?? null,
        termRoman: (g.termRoman as string | null) ?? null,
        definition: String(g.definition),
        speechHint: (g.speechHint as string | null) ?? null,
      })),
    );
  }

  return {
    slug,
    contentId,
    journeyId,
    chunks: fx.chunks.length,
    concepts: fx.concepts.length,
    facts: factRows.length,
    missions: fx.missions.length,
    glossary: fx.glossary.length,
  };
}

/**
 * Makes sure the org has at least one ready journey, importing the committed fixtures if not.
 * Idempotent: a second run imports nothing and returns an empty list.
 */
export async function ensureSeedJourneys(
  orgId: string,
  deps: { db?: Db } = {},
): Promise<ImportResult[]> {
  const db = deps.db ?? defaultDb;
  const [ready] = await db
    .select({ id: journeys.id })
    .from(journeys)
    .where(and(eq(journeys.orgId, orgId), eq(journeys.status, "ready")))
    .limit(1);
  if (ready) return [];

  const files = listJourneyFixtures();
  if (files.length === 0) return [];

  // Fixtures are owned by whoever the org's first admin is; the column is not nullable.
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.orgId, orgId), eq(user.role, "admin")))
    .limit(1);
  if (!owner) return [];

  const out: ImportResult[] = [];
  for (const file of files) {
    const res = await importJourneyFixture(file, orgId, owner.id, { db });
    if (res) out.push(res);
  }
  return out;
}
