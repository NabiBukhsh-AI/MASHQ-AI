import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { listJourneyFixtures } from "./import-journey-fixture";

/**
 * Seeded content journeys are instantly playable, with no LLM calls at seed time.
 * Until these fixtures existed, a fresh database threw "Run pnpm pipeline:live first", which
 * is a model call, and the seed could not run at all.
 *
 * These assert the shape the importer relies on, so a bad export is caught before a demo day
 * rather than during one. The round trip against a real database is proved by
 * `pnpm db:seed --demo` on an empty org.
 */

const DIR = path.resolve(process.cwd(), "eval/fixtures/seed/journeys");

describe("seed journey fixtures", () => {
  const files = listJourneyFixtures();

  it("ships at least one journey, or the demo seed cannot run", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is playable: it has a ready mission pack", (file) => {
    const fx = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    expect(fx.journey.status).toBe("ready");
    expect(fx.concepts.length).toBeGreaterThan(0);
    // A journey with no ready pack cannot be started, which is the whole point of seeding it.
    const ready = fx.missions.filter(
      (m: { packStatus: string; pack: unknown }) => m.packStatus === "ready" && m.pack,
    );
    expect(ready.length).toBeGreaterThan(0);
  });

  it.each(files)("%s has no reference the importer cannot resolve", (file) => {
    const fx = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    const ordinals = new Set(fx.chunks.map((c: { ordinal: number }) => c.ordinal));
    const conceptKeys = new Set(fx.concepts.map((c: { key: string }) => c.key));

    for (const c of fx.concepts) {
      for (const o of c.chunkOrdinals) {
        expect(ordinals.has(o), `${c.key} cites chunk ordinal ${o}, which is not exported`).toBe(
          true,
        );
      }
    }
    // A fact whose concept is missing is dropped on import, so catch it at export time.
    for (const f of fx.facts) {
      expect(conceptKeys.has(f.conceptKey), `fact ${f.key} has no concept in this fixture`).toBe(
        true,
      );
    }
    for (const m of fx.missions) {
      for (const k of m.conceptKeys) {
        expect(conceptKeys.has(k), `mission ${m.ordinal} cites unknown concept ${k}`).toBe(true);
      }
    }
  });

  it.each(files)("%s carries the source hash the importer uses for idempotency", (file) => {
    const fx = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    expect(typeof fx.content.sourceHash).toBe("string");
    expect(String(fx.content.sourceHash).length).toBeGreaterThan(8);
    expect(typeof fx.journey.designHash).toBe("string");
  });

  it("carries no embeddings, which would bloat the repository for nothing", () => {
    for (const file of files) {
      const raw = fs.readFileSync(path.join(DIR, file), "utf8");
      expect(raw).not.toContain('"embedding"');
      // A fixture is a document, not a dataset: keep them reviewable in a diff.
      expect(raw.length).toBeLessThan(400_000);
    }
  });
});
