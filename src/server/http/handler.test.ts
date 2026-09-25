import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "./handler";
import { AppError, errors } from "./errors";
import { env } from "@/env";
import { log } from "../obs/logger";
import { getRequestId } from "../obs/request-context";

// Unit tests never touch Upstash or the database: the limiter and the session
// resolver have their own tests (guards.test.ts).
vi.mock("../security/ratelimit", () => ({
  limit: vi.fn(async () => ({ ok: true, remaining: 9, resetMs: 1000 })),
}));
const resolveSession = vi.fn<(req: Request) => Promise<Record<string, unknown> | null>>(
  async () => null,
);
vi.mock("../auth/guards", () => ({ resolveSession: (req: Request) => resolveSession(req) }));

const ok = async () => NextResponse.json({ ok: true });
const url = "http://localhost/api/test";

describe("withHandler", () => {
  beforeEach(() => {
    vi.spyOn(log, "info").mockImplementation(() => undefined);
    vi.spyOn(log, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.HEALTH_TOKEN = undefined;
    env.CRON_SECRET = undefined;
  });

  it("sets x-request-id on every response and reuses a safe incoming id", async () => {
    const handler = withHandler({ auth: "public" }, ok);
    const fresh = await handler(new Request(url));
    expect(fresh.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await handler(
      new Request(url, { headers: { "x-request-id": "client-abc-12345" } }),
    );
    expect(reused.headers.get("x-request-id")).toBe("client-abc-12345");

    const unsafe = await handler(new Request(url, { headers: { "x-request-id": "<script>" } }));
    expect(unsafe.headers.get("x-request-id")).not.toBe("<script>");
  });

  it("exposes the request id to code running inside the handler", async () => {
    let seen: string | undefined;
    const handler = withHandler({ auth: "public" }, async (_req, ctx) => {
      seen = getRequestId();
      return NextResponse.json({ id: ctx.requestId });
    });
    const res = await handler(new Request(url));
    expect(seen).toBe(res.headers.get("x-request-id"));
  });

  it("maps AppError to { error: { code, message, requestId } } with its status and headers", async () => {
    const handler = withHandler({ auth: "public" }, async () => {
      throw errors.tooManyRequests(30);
    });
    const res = await handler(new Request(url));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("hides unexpected error messages and stacks from the client", async () => {
    const handler = withHandler({ auth: "public" }, async () => {
      throw new Error("db password is hunter2");
    });
    const res = await handler(new Request(url));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("at ");
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("never logs request bodies", async () => {
    const handler = withHandler({ auth: "public", body: z.object({ answer: z.string() }) }, ok);
    await handler(
      new Request(url, {
        method: "POST",
        body: JSON.stringify({ answer: "CNIC 42101-1234567-1" }),
      }),
    );
    const logged = JSON.stringify(vi.mocked(log.info).mock.calls);
    expect(logged).toContain("request_start");
    expect(logged).toContain("request_end");
    expect(logged).not.toContain("42101");
    expect(logged).not.toContain("answer");
  });

  it("validates the body and reports field paths", async () => {
    const handler = withHandler(
      { auth: "public", body: z.object({ answer: z.string(), n: z.number().int() }) },
      async (_req, ctx) => NextResponse.json(ctx.body),
    );
    const bad = await handler(
      new Request(url, { method: "POST", body: JSON.stringify({ n: 1.5 }) }),
    );
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["answer", "n"]);

    const notJson = await handler(new Request(url, { method: "POST", body: "nope" }));
    expect(notJson.status).toBe(400);

    const good = await handler(
      new Request(url, { method: "POST", body: JSON.stringify({ answer: "x", n: 2 }) }),
    );
    expect(await good.json()).toEqual({ answer: "x", n: 2 });
  });

  it("validates the query string", async () => {
    const handler = withHandler(
      { auth: "public", query: z.object({ deep: z.enum(["0", "1"]).default("0") }) },
      async (_req, ctx) => NextResponse.json(ctx.query),
    );
    expect(await (await handler(new Request(`${url}?deep=1`))).json()).toEqual({ deep: "1" });
    expect((await handler(new Request(`${url}?deep=2`))).status).toBe(400);
  });

  it("health mode requires the exact token", async () => {
    const handler = withHandler({ auth: "health" }, ok);
    env.HEALTH_TOKEN = "secret-token-123";
    expect((await handler(new Request(url))).status).toBe(401);
    expect(
      (await handler(new Request(url, { headers: { "x-health-token": "wrong" } }))).status,
    ).toBe(401);
    expect(
      (await handler(new Request(url, { headers: { "x-health-token": "secret-token-123" } })))
        .status,
    ).toBe(200);
  });

  it("health and cron modes fail closed when the secret is not configured", async () => {
    env.HEALTH_TOKEN = undefined;
    env.CRON_SECRET = undefined;
    const health = withHandler({ auth: "health" }, ok);
    const cron = withHandler({ auth: "cron" }, ok);
    expect((await health(new Request(url, { headers: { "x-health-token": "" } }))).status).toBe(
      401,
    );
    expect((await cron(new Request(url, { headers: { authorization: "Bearer " } }))).status).toBe(
      401,
    );
  });

  it("cron mode requires the bearer secret", async () => {
    env.CRON_SECRET = "cron-secret-xyz";
    const handler = withHandler({ auth: "cron" }, ok);
    expect((await handler(new Request(url))).status).toBe(401);
    expect(
      (await handler(new Request(url, { headers: { authorization: "Bearer cron-secret-xyz" } })))
        .status,
    ).toBe(200);
  });

  it("session mode: 401 without a session, 403 for a disallowed role, 200 otherwise", async () => {
    const handler = withHandler(
      { auth: "session", roles: ["admin", "ld_manager"] },
      async (_req, ctx) => NextResponse.json({ user: ctx.session?.userId }),
    );
    resolveSession.mockResolvedValueOnce(null);
    expect((await handler(new Request(url))).status).toBe(401);

    resolveSession.mockResolvedValueOnce({ userId: "u1", orgId: "o1", role: "learner" });
    const forbidden = await handler(new Request(url));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("FORBIDDEN");

    resolveSession.mockResolvedValueOnce({ userId: "u2", orgId: "o1", role: "ld_manager" });
    const allowed = await handler(new Request(url));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ user: "u2" });
  });

  it("passes route params through and records guard metadata", async () => {
    const handler = withHandler({ auth: "public", rateLimit: "chat" }, async (_req, ctx) => {
      const { id } = await ctx.params;
      return NextResponse.json({ id });
    });
    const res = await handler(new Request(url), { params: Promise.resolve({ id: "s1" }) });
    expect(await res.json()).toEqual({ id: "s1" });
    expect(handler.guard).toEqual({ auth: "public", rateLimit: "chat" });
  });

  it("maps a refused rate limit to 429 with Retry-After", async () => {
    const { limit } = await import("../security/ratelimit");
    vi.mocked(limit).mockResolvedValueOnce({ ok: false, remaining: 0, resetMs: 30_000 });
    const handler = withHandler({ auth: "public", rateLimit: "login" }, ok);
    const res = await handler(new Request(url, { headers: { "x-real-ip": "198.51.100.5" } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(vi.mocked(limit)).toHaveBeenCalledWith("login", "198.51.100.5");
  });

  it("AppError keeps public message separate from the Error message", () => {
    const e = new AppError("X", 418, "public");
    expect(e.publicMessage).toBe("public");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("withHandler options", () => {
  it("rejects roles without session auth at wrap time", () => {
    expect(() => withHandler({ auth: "public", roles: ["admin"] }, ok)).toThrowError(/roles/);
  });
});
