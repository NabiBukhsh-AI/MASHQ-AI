import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST as sttKeyHandler } from "@/app/api/voice/stt-key/route";
import { POST as ttsKeyHandler } from "@/app/api/voice/tts-key/route";
import { createSonioxTemporaryKey, getSttSessionConfig } from "./soniox";
import { signSpeech } from "./speech-token";
import { env } from "@/env";
import { log } from "../obs/logger";
import { limit } from "../security/ratelimit";

// Mock auth session resolver
const mockResolveSession = vi.fn();
vi.mock("@/server/auth/guards", () => ({
  resolveSession: (req: Request) => mockResolveSession(req),
}));

// Mock ratelimit
vi.mock("@/server/security/ratelimit", () => ({
  limit: vi.fn(async () => ({ ok: true, remaining: 7, resetMs: 60_000 })),
}));

// Mock DB queries for glossary and journeys
const mockDb = {
  select: vi.fn(),
  insert: vi.fn((..._args: unknown[]) => ({ values: vi.fn(async () => undefined) })),
};

vi.mock("@/server/db/client", () => ({
  db: {
    select: (...args: unknown[]) => mockDb.select(...args),
    insert: (...args: unknown[]) => mockDb.insert(...(args as [unknown])),
  },
}));

// Mock getOrgConfig
vi.mock("@/server/config/service", () => ({
  getOrgConfig: vi.fn(async () => ({
    version: 1,
    hash: "test-hash",
    config: {
      branding: {
        guideCharacterName: "Sana",
      },
      personas: [{ label: "Branch New Joiner", labelUr: "برانچ نیا ملازم" }],
      voice: {
        stt: {
          provider: "soniox",
          model: "stt-rt-v5",
          languageHints: ["ur", "en"],
          languageHintsByLang: { en: { hints: ["en"], strict: true } },
          contextFromGlossary: true,
          keyTtlSeconds: 60,
          maxSessionSeconds: 600,
        },
        tts: {
          maxChars: 400,
          dailySecondsCap: 3600,
          model: "tts-rt-v2",
        },
      },
    },
  })),
}));

describe("Voice Key Routes & Soniox Key Management", () => {
  const FAKE_MASTER_KEY = "soniox_live_secret_master_key_xyz987";
  const FAKE_TEMP_STT_KEY = "soniox_temp_stt_token_abc123";
  const FAKE_TEMP_TTS_KEY = "soniox_temp_tts_token_def456";

  const originalFetch = globalThis.fetch;
  const originalSonioxKey = env.SONIOX_API_KEY;

  beforeEach(() => {
    env.SONIOX_API_KEY = FAKE_MASTER_KEY;
    mockResolveSession.mockReset();
    vi.mocked(limit).mockClear();
    vi.spyOn(log, "info").mockImplementation(() => undefined);
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    mockDb.select.mockReturnValue({
      from: () => ({ where: async () => [{ totalSeconds: "0" }] }),
    });
    mockDb.insert.mockReturnValue({ values: vi.fn(async () => undefined) });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    env.SONIOX_API_KEY = originalSonioxKey;
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 for unauthenticated STT key requests", async () => {
      mockResolveSession.mockResolvedValue(null);

      const req = new Request("http://localhost/api/voice/stt-key", { method: "POST" });
      const res = await sttKeyHandler(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 for unauthenticated TTS key requests", async () => {
      mockResolveSession.mockResolvedValue(null);

      const req = new Request("http://localhost/api/voice/tts-key", { method: "POST" });
      const res = await ttsKeyHandler(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("Rate Limiting", () => {
    it("returns 429 when rate limit is exceeded", async () => {
      mockResolveSession.mockResolvedValue({
        userId: "user-test-1",
        orgId: "org-test-1",
        role: "learner",
      });

      vi.mocked(limit).mockResolvedValueOnce({
        ok: false,
        remaining: 0,
        resetMs: 45_000,
      });

      const req = new Request("http://localhost/api/voice/stt-key", { method: "POST" });
      const res = await sttKeyHandler(req);

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("45");
      const json = await res.json();
      expect(json.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("STT Key Route", () => {
    it("mints a temporary WebSocket STT key and returns config with glossary terms", async () => {
      mockResolveSession.mockResolvedValue({
        userId: "user-test-1",
        orgId: "org-test-1",
        role: "learner",
      });

      let capturedUrl = "";
      let capturedBody: Record<string, unknown> = {};
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = input.toString();
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = JSON.parse((init?.body as string) || "{}");

        return new Response(
          JSON.stringify({
            api_key: FAKE_TEMP_STT_KEY,
            expires_at: "2026-09-19T23:59:59Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      // Mock glossary query
      const glossaryRows = [
        { termEn: "CNIC", termUr: "شناختی کارڈ", termRoman: "CNIC" },
        { termEn: "Raast", termUr: "راست", termRoman: "Raast" },
      ];
      mockDb.select.mockReturnValueOnce({
        from: () => ({
          // the glossary is org scoped through a join on contents
          innerJoin: () => ({ where: () => glossaryRows }),
        }),
      });

      const req = new Request(
        "http://localhost/api/voice/stt-key?contentId=a0000000-0000-0000-0000-000000000001",
        { method: "POST" },
      );

      const res = await sttKeyHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.apiKey).toBe(FAKE_TEMP_STT_KEY);
      expect(json.expiresAt).toBe("2026-09-19T23:59:59Z");
      expect(json.config.model).toBe("stt-rt-v5");
      expect(json.config.languageHints).toEqual(["ur", "en"]);
      expect(json.config.enableEndpointDetection).toBe(true);

      // Verify terms contain glossary and character/persona names
      const terms = json.config.context.terms;
      expect(terms).toContain("Sana");
      expect(terms).toContain("Branch New Joiner");
      expect(terms).toContain("CNIC");
      expect(terms).toContain("شناختی کارڈ");
      expect(terms).toContain("Raast");

      // Verify request to Soniox
      expect(capturedUrl).toBe("https://api.soniox.com/v1/auth/temporary-api-key");
      expect(capturedHeaders["Authorization"]).toBe(`Bearer ${FAKE_MASTER_KEY}`);
      expect(capturedBody["usage_type"]).toBe("transcribe_websocket");
      expect(capturedBody["expires_in_seconds"]).toBe(60);
      expect(capturedBody["single_use"]).toBe(true);
      expect(capturedBody["max_session_duration_seconds"]).toBe(600);
      expect(capturedBody["client_reference_id"]).toBe("user-test-1");
    });

    it("listens for English only, strictly, in an English session", async () => {
      // English with a Pakistani accent came back in Urdu script while ur and en were both
      // hinted. An English session hints en alone, strict, and leaves Urdu script out of the
      // context terms; an Urdu session keeps both languages.
      const sessionDb = (language: string) => {
        let call = 0;
        return {
          select: () => ({
            from: () =>
              call++ === 0
                ? {
                    innerJoin: () => ({
                      where: () => ({ limit: async () => [{ contentId: "c-1", language }] }),
                    }),
                  }
                : {
                    innerJoin: () => ({
                      where: async () => [
                        { termEn: "CNIC", termUr: "شناختی کارڈ", termRoman: "CNIC" },
                      ],
                    }),
                  },
          }),
        } as unknown as Parameters<typeof getSttSessionConfig>[0]["db"];
      };
      const opts = { orgId: "org-test-1", userId: "user-test-1", sessionId: "s-1" };

      const en = await getSttSessionConfig({ ...opts, db: sessionDb("en") });
      expect(en.language_hints).toEqual(["en"]);
      expect(en.language_hints_strict).toBe(true);
      expect(en.enable_language_identification).toBe(false);
      expect(en.context.terms).toContain("CNIC");
      expect(en.context.terms).not.toContain("شناختی کارڈ");
      expect(en.context.terms).not.toContain("برانچ نیا ملازم");

      const ur = await getSttSessionConfig({ ...opts, db: sessionDb("ur") });
      expect(ur.language_hints).toEqual(["ur", "en"]);
      expect(ur.language_hints_strict).toBe(false);
      expect(ur.context.terms).toContain("شناختی کارڈ");
    });
  });

  describe("TTS Key Route", () => {
    it("mints a temporary REST TTS key with tts_rt usage type", async () => {
      mockResolveSession.mockResolvedValue({
        userId: "user-test-2",
        orgId: "org-test-1",
        role: "learner",
      });

      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse((init?.body as string) || "{}");
        return new Response(
          JSON.stringify({
            api_key: FAKE_TEMP_TTS_KEY,
            expires_at: "2026-09-19T23:59:59Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      // The key is only issued for a signed speech item, so the body has to carry one.
      const sessionId = "00000000-0000-0000-0000-0000000000b1";
      const text = "Khushamdeed.";
      const token = signSpeech(text, "ur", "turn-1", {
        orgId: "org-test-1",
        userId: "user-test-2",
        sessionId,
      });

      const req = new Request("http://localhost/api/voice/tts-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          lang: "ur",
          sig: token.sig,
          exp: token.exp,
          turnId: "turn-1",
          sessionId,
        }),
      });
      const res = await ttsKeyHandler(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.apiKey).toBe(FAKE_TEMP_TTS_KEY);
      expect(json.expiresAt).toBe("2026-09-19T23:59:59Z");
      expect(capturedBody["usage_type"]).toBe("tts_rt");
      expect(capturedBody["client_reference_id"]).toBe("user-test-2");
    });

    it("refuses to issue a key for text that is not signed", async () => {
      mockResolveSession.mockResolvedValue({
        userId: "user-test-2",
        orgId: "org-test-1",
        role: "learner",
      });
      const sonioxFetch = vi.fn();
      globalThis.fetch = sonioxFetch;

      const req = new Request("http://localhost/api/voice/tts-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Anything I like",
          lang: "ur",
          sig: "f".repeat(64),
          exp: Math.floor(Date.now() / 1000) + 100,
          sessionId: "00000000-0000-0000-0000-0000000000b1",
        }),
      });
      const res = await ttsKeyHandler(req);

      // Otherwise this route is a free text-to-speech oracle on the org account.
      expect(res.status).toBe(403);
      expect(sonioxFetch).not.toHaveBeenCalled();
    });
  });

  describe("Security: Zero Key Logging", () => {
    it("never logs secret or temporary API keys across normal operations and failures", async () => {
      mockResolveSession.mockResolvedValue({
        userId: "user-audit",
        orgId: "org-audit",
        role: "learner",
      });

      // 1. Successful key creation
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            api_key: FAKE_TEMP_STT_KEY,
            expires_at: "2026-09-20T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      await createSonioxTemporaryKey({
        usageType: "transcribe_websocket",
        expiresInSeconds: 60,
      });

      // 2. Failed HTTP response
      globalThis.fetch = vi.fn(async () => {
        return new Response("Unauthorized or invalid credentials", { status: 401 });
      });

      await expect(createSonioxTemporaryKey({ usageType: "tts_rt" })).rejects.toThrow();

      // 3. Network error
      globalThis.fetch = vi.fn(async () => {
        throw new Error("DNS lookup failed");
      });

      await expect(
        createSonioxTemporaryKey({ usageType: "transcribe_websocket" }),
      ).rejects.toThrow();

      // Collect all logged arguments from info, warn, and error
      const infoCalls = vi.mocked(log.info).mock.calls;
      const warnCalls = vi.mocked(log.warn).mock.calls;
      const errorCalls = vi.mocked(log.error).mock.calls;

      const allLoggedText = JSON.stringify({ infoCalls, warnCalls, errorCalls });

      // Assert key material is NEVER found in logs
      expect(allLoggedText).not.toContain(FAKE_MASTER_KEY);
      expect(allLoggedText).not.toContain(FAKE_TEMP_STT_KEY);
      expect(allLoggedText).not.toContain(FAKE_TEMP_TTS_KEY);
      expect(allLoggedText).not.toContain("Authorization");
    });
  });
});
