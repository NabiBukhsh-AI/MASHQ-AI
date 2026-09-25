import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveSession = vi.fn();
vi.mock("@/server/auth/guards", () => ({
  resolveSession: (req: Request) => mockResolveSession(req),
}));

const mockLimit = vi.fn();
vi.mock("@/server/security/ratelimit", () => ({
  limit: (...args: unknown[]) => mockLimit(...(args as [unknown])),
}));

const mockRunWidget = vi.fn();
vi.mock("@/server/analytics/queries", async () => {
  const actual = await vi.importActual<typeof import("@/server/analytics/queries")>(
    "@/server/analytics/queries",
  );
  return { ...actual, runWidget: (...a: unknown[]) => mockRunWidget(...(a as [unknown])) };
});

// The route reads analytics.defaultRangeDays and analytics.includeSeeded, so the filter
// defaults come from config rather than from a literal.
vi.mock("@/server/config/service", () => ({
  resolveOrgConfig: async () => ({
    config: { analytics: { defaultRangeDays: 14, includeSeeded: true } },
    version: 1,
  }),
}));

const insertedExports: Array<Record<string, unknown>> = [];
vi.mock("@/server/db/client", () => ({
  db: {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        insertedExports.push(v);
      },
    }),
  },
}));

const { GET: exportHandler } = await import("./[widget]/route");

const manager = { userId: "usr-mgr", orgId: "org-1", role: "ld_manager" };

function req(widget: string, query = "") {
  return new Request(`http://localhost/api/export/${widget}${query}`);
}
const ctx = (widget: string) => ({ params: Promise.resolve({ widget }) });

describe("CSV export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedExports.length = 0;
    mockLimit.mockResolvedValue({ ok: true, remaining: 10, resetMs: 60_000 });
    mockResolveSession.mockResolvedValue(manager);
  });

  it("refuses a learner, who must not read other people's rows", async () => {
    mockResolveSession.mockResolvedValue({ ...manager, role: "learner" });
    const res = await exportHandler(req("masteryMatrix"), ctx("masteryMatrix"));
    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated request", async () => {
    mockResolveSession.mockResolvedValue(null);
    const res = await exportHandler(req("masteryMatrix"), ctx("masteryMatrix"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for a widget that does not exist, rather than an empty file", async () => {
    const res = await exportHandler(req("secrets"), ctx("secrets"));
    expect(res.status).toBe(404);
  });

  it("serves CSV as an attachment that a browser will not sniff", async () => {
    mockRunWidget.mockResolvedValue([
      {
        pseudonym: "Learner 001",
        concept_key: "k1",
        concept_label: "Greeting",
        band: "proficient",
      },
    ]);
    const res = await exportHandler(req("masteryMatrix"), ctx("masteryMatrix"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("escapes a formula that came through the data", async () => {
    // A concept label is content derived, so it is attacker influenceable.
    mockRunWidget.mockResolvedValue([
      { pseudonym: "Learner 001", concept_key: "k1", concept_label: "=HYPERLINK(1)" },
    ]);
    const res = await exportHandler(req("masteryMatrix"), ctx("masteryMatrix"));
    const body = await res.text();
    expect(body).toContain("'=HYPERLINK(1)");
    expect(body).not.toMatch(/,=HYPERLINK/);
  });

  it("records every export with the filters and the row count", async () => {
    mockRunWidget.mockResolvedValue([{ a: 1 }, { a: 2 }]);
    await exportHandler(req("contentHealth", "?includeSeeded=false"), ctx("contentHealth"));
    expect(insertedExports).toHaveLength(1);
    expect(insertedExports[0]!.reportType).toBe("contentHealth");
    expect(insertedExports[0]!.format).toBe("csv");
    expect(insertedExports[0]!.rowCount).toBe(2);
    expect(insertedExports[0]!.actorId).toBe("usr-mgr");
  });

  it("rejects a bad filter instead of exporting everything", async () => {
    const res = await exportHandler(
      req("masteryMatrix", "?languages=klingon"),
      ctx("masteryMatrix"),
    );
    expect(res.status).toBe(400);
    expect(mockRunWidget).not.toHaveBeenCalled();
  });

  it("passes the caller's own org, never one from the query string", async () => {
    mockRunWidget.mockResolvedValue([]);
    await exportHandler(req("personas", "?orgId=someone-else"), ctx("personas"));
    expect(mockRunWidget).toHaveBeenCalledWith("personas", "org-1", expect.any(Object));
  });
});
