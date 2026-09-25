import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const fixtures = path.resolve(process.cwd(), "eval/fixtures/intake");
const session = {
  userId: "user-1",
  orgId: "org-1",
  role: "ld_manager",
  name: "M",
  email: "m@x.demo",
};

vi.mock("@/server/auth/guards", () => ({ resolveSession: vi.fn(async () => session) }));
vi.mock("@/server/security/ratelimit", () => ({
  limit: vi.fn(async () => ({ ok: true, remaining: 9, resetMs: 1000 })),
}));
vi.mock("@/server/config/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/config/service")>();
  return {
    ...real,
    getOrgConfig: async () => ({ config: real.baseConfig(), version: 1, hash: "x" }),
  };
});
vi.mock("@/server/ingest/url-fetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ingest/url-fetch")>();
  return { ...real, safeFetch: vi.fn(real.safeFetch) };
});
const intake = vi.fn(async (..._args: unknown[]) => ({
  contentId: "c-1",
  jobId: "j-1",
  stats: { chars: 10, tokens: 3, chunks: 0, redactions: 0, injectionFlags: 0, scanned: false },
  warnings: [],
  reused: false,
}));
vi.mock("@/server/ingest/intake", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/ingest/intake")>();
  return { ...real, intake: (...args: unknown[]) => intake(...args) };
});

import { POST } from "./route";

const url = "http://localhost:3100/api/content";
const post = (init: RequestInit) => POST(new Request(url, { method: "POST", ...init }), {});

describe("POST /api/content", () => {
  beforeEach(() => intake.mockClear());

  it("accepts a multipart file and hands bytes, type and name to intake with the session actor", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([fs.readFileSync(path.join(fixtures, "tiny.pdf"))], "tiny.pdf", {
        type: "application/pdf",
      }),
    );
    const res = await post({ body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ contentId: "c-1", jobId: "j-1", reused: false });
    const [input, actor] = intake.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(input).toMatchObject({
      kind: "upload",
      mimeType: "application/pdf",
      filename: "tiny.pdf",
    });
    expect(actor).toEqual({ orgId: "org-1", userId: "user-1", role: "ld_manager" });
  });

  it("rejects an oversized multipart file with 413 and guidance before reading it", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" }),
    );
    const res = await post({ body: form });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.message).toMatch(/Paste the text instead/);
    expect(body.error.requestId).toBeTruthy();
    expect(intake).not.toHaveBeenCalled();
  });

  it("validates JSON kinds with Zod and reports field paths", async () => {
    const res = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "paste" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.details.map((d: { path: string }) => d.path)).toContain("text");

    const unknown = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "magic" }),
    });
    expect(unknown.status).toBe(400);
  });

  it("routes paste and parsed kinds to intake", async () => {
    await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "paste", title: "T", text: "hello" }),
    });
    expect(intake.mock.calls[0]?.[0]).toEqual({ kind: "paste", text: "hello", title: "T" });

    const doc = {
      title: "W",
      sourceType: "pdf",
      blocks: [{ kind: "page", ref: "1", text: "Parsed." }],
      text: "Parsed.",
    };
    const res = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "parsed", doc }),
    });
    expect(res.status).toBe(200);
    expect(intake.mock.calls[1]?.[0]).toMatchObject({ kind: "parsed", doc });
  });

  it("rejects a malformed parsed doc instead of trusting the client", async () => {
    const res = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "parsed", doc: { sourceType: "pdf", blocks: [], text: 5 } }),
    });
    expect(res.status).toBe(400);
    expect(intake).not.toHaveBeenCalled();
  });

  it("imports a public URL through safeFetch, parses it and hands the doc to intake", async () => {
    const { safeFetch } = await import("@/server/ingest/url-fetch");
    vi.mocked(safeFetch).mockResolvedValueOnce({
      finalUrl: "https://example.com/guide",
      contentType: "text/html",
      bytes: new TextEncoder().encode(
        "<html><head><title>Guide</title></head><body><article><h2>Step</h2><p>" +
          "Verify the customer identity before anything else. ".repeat(20) +
          "</p></article></body></html>",
      ),
    });
    const res = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "url", url: "https://example.com/guide" }),
    });
    expect(res.status).toBe(200);
    const [input] = intake.mock.calls[0] as unknown as [
      { kind: string; sourceUrl: string; doc: { title: string } },
    ];
    expect(input.kind).toBe("parsed");
    expect(input.sourceUrl).toBe("https://example.com/guide");
    expect(input.doc.title).toBe("Guide");
    expect(vi.mocked(safeFetch).mock.calls[0]?.[1]).toMatchObject({
      maxRedirects: 3,
      timeoutMs: 8000,
    });
  });

  it("turns an unreadable page into a 400 with the parser message", async () => {
    const { safeFetch } = await import("@/server/ingest/url-fetch");
    vi.mocked(safeFetch).mockResolvedValueOnce({
      finalUrl: "https://example.com/spa",
      contentType: "text/html",
      bytes: new TextEncoder().encode("<html><body><div id='root'></div></body></html>"),
    });
    const res = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "url", url: "https://example.com/spa" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/no readable article text/);
    expect(intake).not.toHaveBeenCalled();
  });

  it("returns the safeFetch message when a link is blocked", async () => {
    const { safeFetch } = await import("@/server/ingest/url-fetch");
    const real = await vi.importActual<typeof import("@/server/ingest/url-fetch")>(
      "@/server/ingest/url-fetch",
    );
    vi.mocked(safeFetch).mockImplementationOnce(real.safeFetch);
    const res = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "url", url: "http://169.254.169.254/latest" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/private or internal network/);
    expect(intake).not.toHaveBeenCalled();
  });

  it("rejects other content types with a message", async () => {
    const res = await post({ headers: { "content-type": "text/plain" }, body: "hi" });
    expect(res.status).toBe(400);
  });

  it("requires a session", async () => {
    const { resolveSession } = await import("@/server/auth/guards");
    vi.mocked(resolveSession).mockResolvedValueOnce(null);
    const res = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "paste", text: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
