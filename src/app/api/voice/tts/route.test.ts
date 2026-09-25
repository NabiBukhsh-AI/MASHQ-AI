import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as ttsHandler } from "./route";
import { signSpeech } from "@/server/voice/speech-token";
import { errors } from "@/server/http/errors";
const mockResolveSession = vi.fn();
vi.mock("@/server/auth/guards", () => ({
  resolveSession: (req: Request) => mockResolveSession(req),
}));

const mockLimit = vi.fn(async (req?: unknown, rule?: unknown, cost?: unknown) => {
  void req;
  void rule;
  void cost;
  return {
    ok: true,
    remaining: 89,
    resetMs: 60_000,
  };
});
vi.mock("@/server/security/ratelimit", () => ({
  limit: (req: unknown, rule?: unknown, cost?: unknown) => mockLimit(req, rule, cost),
}));

const mockRouteTts = vi.fn((input?: unknown, opts?: unknown) => {
  void input;
  void opts;
  return Promise.resolve({});
});
vi.mock("@/server/voice/tts-router", () => ({
  routeTts: (input: unknown, opts?: unknown) => mockRouteTts(input, opts),
}));

describe("POST /api/voice/tts endpoint", () => {
  const sessionId = "00000000-0000-0000-0000-0000000000b1";
  const scope = { orgId: "org-5678", userId: "usr-1234", sessionId };
  const dummySession = {
    userId: "usr-1234",
    orgId: "org-5678",
    role: "learner",
    name: "Tariq Mahmood",
    email: "tariq@example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSession.mockResolvedValue(dummySession);
    mockLimit.mockResolvedValue({ ok: true, remaining: 89, resetMs: 60_000 });
  });

  it("returns 401 when user session is not authenticated", async () => {
    mockResolveSession.mockResolvedValueOnce(null);

    const token = signSpeech("Salam", "ur", "turn-1", scope);
    const req = new Request("http://localhost/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Salam",
        lang: "ur",
        sig: token.sig,
        exp: token.exp,
        turnId: "turn-1",
        sessionId,
      }),
    });

    const res = await ttsHandler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockLimit.mockResolvedValueOnce({ ok: false, remaining: 0, resetMs: 45_000 });

    const token = signSpeech("Salam", "ur", "turn-1", scope);
    const req = new Request("http://localhost/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Salam",
        lang: "ur",
        sig: token.sig,
        exp: token.exp,
        turnId: "turn-1",
        sessionId,
      }),
    });

    const res = await ttsHandler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(429);
  });

  it("returns 403 when signature is rejected by router", async () => {
    mockRouteTts.mockRejectedValueOnce(errors.forbidden("Speech request is not valid."));

    const req = new Request("http://localhost/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Tampered text",
        lang: "ur",
        sig: "fake-sig-1234",
        exp: 1800000000,
        turnId: "turn-1",
        sessionId,
      }),
    });

    const res = await ttsHandler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    const body = await res.json();
    // the standard error envelope, not a raw internal message
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.requestId).toBeDefined();
  });

  it("returns 200 with audio buffer and headers when synthesis succeeds", async () => {
    const fakeAudio = Buffer.from("audio-stream-bytes");
    mockRouteTts.mockResolvedValueOnce({
      status: "audio",
      audio: fakeAudio,
      provider: "uplift",
      voice: "v_meklc281",
      contentType: "audio/mpeg",
      ttfbMs: 140,
      totalMs: 280,
      failover: false,
      estimatedSeconds: 2.1,
    });

    const token = signSpeech("Khushamdeed", "ur", "turn-1", scope);
    const req = new Request("http://localhost/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Khushamdeed",
        lang: "ur",
        sig: token.sig,
        exp: token.exp,
        turnId: "turn-1",
        sessionId,
      }),
    });

    const res = await ttsHandler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("x-tts-provider")).toBe("uplift");
    expect(res.headers.get("x-tts-failover")).toBe("false");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf).toEqual(fakeAudio);
  });

  it("returns 200 with fallback JSON when cap is exceeded", async () => {
    mockRouteTts.mockResolvedValueOnce({
      status: "fallback",
      fallbackTo: "browser",
      reason: "daily_cap_exceeded",
      notice: "Daily voice quota reached. Switching to browser voice.",
    });

    const token = signSpeech("Testing cap fallback", "en", "turn-1", scope);
    const req = new Request("http://localhost/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Testing cap fallback",
        lang: "en",
        sig: token.sig,
        exp: token.exp,
        turnId: "turn-1",
        sessionId,
      }),
    });

    const res = await ttsHandler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-tts-fallback")).toBe("browser");
    const body = await res.json();
    expect(body.fallback).toBe("browser");
    expect(body.reason).toBe("daily_cap_exceeded");
  });
});
