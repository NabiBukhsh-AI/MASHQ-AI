import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

// Live test against the migrated database: versions, active flag, audit diffs,
// rollback and the 10 s cache. Skipped without a real DATABASE_URL (CI).
describe.skipIf(!process.env.LIVE_DB)("config service", () => {
  let db: typeof import("../db/client").db;
  let s: typeof import("../db/schema");
  let svc: typeof import("./service");
  let orgId: string;

  beforeAll(async () => {
    db = (await import("../db/client")).db;
    s = await import("../db/schema");
    svc = await import("./service");
    const [org] = await db
      .insert(s.organizations)
      .values({ name: "Config test org", slug: `cfg-test-${Date.now()}` })
      .returning();
    orgId = org!.id;
  }, 30_000);

  afterAll(async () => {
    await db.delete(s.configAudit).where(eq(s.configAudit.orgId, orgId));
    await db.delete(s.configs).where(eq(s.configs.orgId, orgId));
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId));
  });

  it("serves version 0 defaults for an org without rows", async () => {
    const v0 = await svc.getOrgConfig(orgId);
    expect(v0.version).toBe(0);
    expect(v0.config.grounding.strictness).toBe("strict");
    expect(Object.keys(v0.config.presets)).toHaveLength(8);
  });

  it("increments versions, keeps exactly one active row and audits the diff", async () => {
    const r1 = await svc.patchOrgConfig(
      orgId,
      null,
      { grounding: { strictness: "assisted" } },
      "demo: assisted",
    );
    expect(r1.version).toBe(1);
    expect(r1.patch).toEqual([{ op: "replace", path: "/grounding/strictness", value: "assisted" }]);
    expect(r1.summary).toBe('grounding.strictness is now "assisted"');

    const r2 = await svc.patchOrgConfig(orgId, null, { session: { maxMinutes: 20 } }, "shorter");
    expect(r2.version).toBe(2);

    const rows = await db.select().from(s.configs).where(eq(s.configs.orgId, orgId));
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
    expect(rows.filter((r) => r.isActive).map((r) => r.version)).toEqual([2]);

    const audit = await db.select().from(s.configAudit).where(eq(s.configAudit.orgId, orgId));
    expect(audit).toHaveLength(2);
    expect(audit.find((a) => a.toVersion === 1)?.diff).toEqual(r1.patch);
    expect(audit.find((a) => a.toVersion === 2)?.reason).toBe("shorter");

    const active = await svc.getOrgConfig(orgId);
    expect(active.version).toBe(2);
    expect(active.config.grounding.strictness).toBe("assisted");
    expect(active.config.session.maxMinutes).toBe(20);
  });

  it("rejects invalid and semantically wrong writes without creating a version", async () => {
    await expect(
      svc.patchOrgConfig(orgId, null, { limits: { dailySpendCapUsd: 5000 } }, "too high"),
    ).rejects.toThrowError(/limits\.dailySpendCapUsd/);
    await expect(
      svc.patchOrgConfig(orgId, null, { mastery: { bands: { developing: 0.95 } } }, "bands"),
    ).rejects.toThrowError(/strictly increasing/);
    expect((await svc.getOrgConfig(orgId)).version).toBe(2);
  });

  it("rolls back as a new version and audits it", async () => {
    const r = await svc.rollbackConfig(orgId, null, 1);
    expect(r.version).toBe(3);
    const active = await svc.getOrgConfig(orgId);
    expect(active.config.session.maxMinutes).toBe(45);
    expect(active.config.grounding.strictness).toBe("assisted");
    const audit = await db.select().from(s.configAudit).where(eq(s.configAudit.orgId, orgId));
    expect(audit.filter((a) => a.toVersion === 3).map((a) => a.action)).toEqual(["rollback"]);
    await expect(svc.rollbackConfig(orgId, null, 99)).rejects.toThrowError(/does not exist/);
  });

  it("keeps exactly one active row when two writers race", async () => {
    const results = await Promise.allSettled([
      svc.patchOrgConfig(orgId, null, { ui: { textScale: 1.125 } }, "racer a"),
      svc.patchOrgConfig(orgId, null, { ui: { textScale: 1.25 } }, "racer b"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(s.configs).where(eq(s.configs.orgId, orgId));
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
    expect(new Set(rows.map((r) => r.version)).size).toBe(rows.length);
    svc.bustConfigCache(orgId);
    const active = await svc.getOrgConfig(orgId);
    expect(active.version).toBe(Math.max(...rows.map((r) => r.version)));
  });

  it("seedOrgConfig creates version 1 once", async () => {
    const [org] = await db
      .insert(s.organizations)
      .values({ name: "Seed test org", slug: `cfg-seed-${Date.now()}` })
      .returning();
    try {
      expect(await svc.seedOrgConfig(org!.id, null)).toBe(1);
      expect(await svc.seedOrgConfig(org!.id, null)).toBe(1);
      const audit = await db.select().from(s.configAudit).where(eq(s.configAudit.orgId, org!.id));
      expect(audit.map((a) => a.action)).toEqual(["seed"]);
    } finally {
      await db.delete(s.configAudit).where(eq(s.configAudit.orgId, org!.id));
      await db.delete(s.configs).where(eq(s.configs.orgId, org!.id));
      await db.delete(s.organizations).where(eq(s.organizations.id, org!.id));
    }
  });

  it("caches reads and busts on write", async () => {
    const first = await svc.getOrgConfig(orgId);
    await db.update(s.configs).set({ note: "touched" }).where(eq(s.configs.orgId, orgId));
    const cached = await svc.getOrgConfig(orgId);
    expect(cached).toBe(first);
    svc.bustConfigCache(orgId);
    const fresh = await svc.getOrgConfig(orgId);
    expect(fresh).not.toBe(first);
    expect(fresh.version).toBe(first.version);
  });

  it("resolves per session on top of the active version", async () => {
    const r = await svc.resolveOrgConfig({
      orgId,
      presets: ["micro_session"],
      personaId: "senior_manager",
    });
    expect(r.version).toBeGreaterThanOrEqual(3);
    expect(r.config.session.maxMinutes).toBe(5);
    expect(r.config.language.register).toBe("formal");
    expect(r.layers).toEqual(["org", "persona:senior_manager", "preset:micro_session"]);
  });
});
