import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A reset removes demo activity and restores config version 1 as a new version, audited. The restore and the audit row were both missing: the only record was a
 * pino line, and the admin audit page reads config_audit, so a demo reset never appeared there.
 */

const mockResolveSession = vi.fn();
vi.mock("@/server/auth/guards", () => ({
  resolveSession: (req: Request) => mockResolveSession(req),
}));

vi.mock("@/server/security/ratelimit", () => ({
  limit: async () => ({ ok: true, remaining: 10, reset: 0 }),
}));

vi.mock("@/server/obs/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGetOrgConfig = vi.fn();
const mockRollback = vi.fn();
vi.mock("@/server/config/service", () => ({
  getOrgConfig: (...a: unknown[]) => mockGetOrgConfig(...(a as [string])),
  rollbackConfig: (...a: unknown[]) => mockRollback(...(a as [string, string, number])),
}));

const mockClear = vi.fn();
const mockSeed = vi.fn();
const mockSummary = vi.fn();
const order: string[] = [];
vi.mock("@/server/db/demo-seed", () => ({
  clearDemoData: (...a: unknown[]) => {
    order.push("clear");
    return mockClear(...(a as [string]));
  },
  demoDataSummary: (...a: unknown[]) => mockSummary(...(a as [string])),
  seedDemoData: (...a: unknown[]) => {
    order.push("seed");
    return mockSeed(...(a as [string]));
  },
}));

const audited: Array<Record<string, unknown>> = [];
vi.mock("@/server/db/client", () => ({
  db: {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        audited.push(v);
      },
    }),
  },
}));

const post = async (body: Record<string, unknown> = {}) => {
  const { POST } = await import("./reset/route");
  const res = await POST(
    new Request("http://localhost/api/admin/demo/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) } as never,
  );
  return res;
};

describe("demo reset route", () => {
  beforeEach(() => {
    audited.length = 0;
    order.length = 0;
    vi.clearAllMocks();
    mockResolveSession.mockResolvedValue({ orgId: "org-1", userId: "admin-1", role: "admin" });
    mockSummary.mockResolvedValue({ learners: 40, sessions: 3 });
    mockClear.mockResolvedValue(3);
    mockSeed.mockResolvedValue({ sessions: 300 });
    mockGetOrgConfig.mockResolvedValue({ config: {}, version: 4 });
    mockRollback.mockResolvedValue({ version: 5 });
  });

  it("restores settings to version 1 as a new version", async () => {
    const res = await post();
    expect(res.status).toBe(200);

    // A new version, never an edit of history: the audit trail still shows what was changed
    // and when it was put back.
    expect(mockRollback).toHaveBeenCalledWith("org-1", "admin-1", 1);
    expect(await res.json()).toMatchObject({ configVersion: 5 });
  });

  it("restores settings before reseeding, so the reseed uses the restored values", async () => {
    await post();
    expect(order).toEqual(["clear", "seed"]);
    // rollbackConfig resolved before seedDemoData was entered.
    expect(mockRollback.mock.invocationCallOrder[0]).toBeLessThan(
      mockSeed.mock.invocationCallOrder[0]!,
    );
  });

  it("writes a config_audit row, so the reset shows on the admin audit page", async () => {
    await post();
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      orgId: "org-1",
      actorId: "admin-1",
      entity: "demo",
      action: "reset",
      toVersion: 5,
    });
    expect(String(audited[0]!.reason)).toContain("3 session(s) removed");
  });

  it("does not roll back when the org is already on version 1", async () => {
    mockGetOrgConfig.mockResolvedValue({ config: {}, version: 1 });
    const res = await post();

    expect(mockRollback).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ configVersion: 1 });
  });

  it("leaves settings alone when the caller asks it to", async () => {
    await post({ restoreConfig: false });
    expect(mockRollback).not.toHaveBeenCalled();
    // The reset is still audited: what happened has to be explainable either way.
    expect(audited[0]).toMatchObject({ entity: "demo", action: "reset", toVersion: null });
  });

  it("refuses a caller who is not an admin", async () => {
    mockResolveSession.mockResolvedValue({ orgId: "org-1", userId: "learner-1", role: "learner" });
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockClear).not.toHaveBeenCalled();
  });
});
