import { describe, it, expect, vi } from "vitest";
import { purgeExpired } from "./retention";
import { baseConfig } from "../config/service";
import type { Db } from "../db/client";

/**
 * The purge is bounded by age only. A fake clock is the whole point of these tests: a purge
 * that deletes by "everything older than the newest row" would wipe an org's history the first
 * time it ran after a quiet month.
 */
function recordingDb(now: Date) {
  const cutoffs: Record<string, Date> = {};
  let table = "";
  const db = {
    delete: (t: unknown) => {
      // Drizzle tables carry their name on a symbol; the string form is enough here.
      table = String((t as { _: { name?: string } })?._?.name ?? Object.keys(cutoffs).length);
      return {
        where: (clause: unknown) => {
          // The clause carries the bound value as a param; capture it by walking the query.
          const value = findDate(clause);
          if (value) cutoffs[table] = value;
          return { returning: async () => [{ id: "1" }] };
        },
      };
    },
  } as unknown as Db;
  void now;
  return { db, cutoffs };
}

/** Pulls the first Date out of a drizzle SQL fragment, however it is nested. */
function findDate(node: unknown, depth = 0): Date | null {
  if (depth > 6 || node === null || node === undefined) return null;
  if (node instanceof Date) return node;
  if (typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findDate(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

describe("retention purge", () => {
  it("uses a different window per table, since turn text is the sensitive part", () => {
    const config = baseConfig();
    expect(config.privacy.retentionDays.turns).toBeLessThan(config.privacy.retentionDays.evidence);
    expect(config.privacy.retentionDays.turns).toBe(30);
    expect(config.privacy.retentionDays.evidence).toBe(180);
    expect(config.privacy.retentionDays.llmCalls).toBe(90);
  });

  it("computes each cutoff from the supplied clock, not from the newest row", async () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const { db, cutoffs } = recordingDb(now);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await purgeExpired(baseConfig(), { db, now });

    const dates = Object.values(cutoffs);
    expect(dates.length).toBeGreaterThanOrEqual(3);
    // Every cutoff is in the past relative to the clock we passed in.
    for (const d of dates) {
      expect(d.getTime()).toBeLessThan(now.getTime());
    }
    // And the earliest is the 180 day evidence window.
    const oldest = Math.min(...dates.map((d) => d.getTime()));
    const days = (now.getTime() - oldest) / 86_400_000;
    expect(Math.round(days)).toBe(180);
  });

  it("reports what it deleted, so the cron response is auditable", async () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const { db } = recordingDb(now);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const counts = await purgeExpired(baseConfig(), { db, now });
    expect(counts).toHaveProperty("turns");
    expect(counts).toHaveProperty("evidence");
    expect(counts).toHaveProperty("llmCalls");
  });
});
