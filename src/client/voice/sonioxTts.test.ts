import { describe, it, expect, vi, beforeEach } from "vitest";
import { synthesizeSonioxBrowser } from "./sonioxTts";

const mockGenerate = vi.fn();
const mockSonioxClient = vi.fn((config?: unknown) => {
  void config;
  return {
    tts: {
      generate: mockGenerate,
    },
  };
});

vi.mock("@soniox/client", () => ({
  SonioxClient: class {
    constructor(config?: unknown) {
      mockSonioxClient(config);
    }
    tts = {
      generate: (opts?: unknown) => mockSonioxClient().tts.generate(opts),
    };
  },
}));

const signedItem = {
  text: "Hello from Mashq",
  lang: "en",
  sig: "a".repeat(64),
  exp: 1800000000,
  sessionId: "00000000-0000-0000-0000-0000000000b1",
  turnId: "turn-1",
};

describe("synthesizeSonioxBrowser", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  it("sends the signed speech item to the key route and synthesizes the audio", async () => {
    mockGenerate.mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4]));
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ apiKey: "fetched-key-999", model: "tts-rt-v2" }),
    });

    try {
      const result = await synthesizeSonioxBrowser({ ...signedItem, voice: "custom-voice" });

      expect(result).toBeInstanceOf(Blob);
      expect((result as Blob).type).toBe("audio/mpeg");

      // The key is only ever issued against a signature, never on a bare POST.
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe("/api/voice/tts-key");
      expect(JSON.parse(init.body as string)).toEqual({
        text: signedItem.text,
        lang: signedItem.lang,
        sig: signedItem.sig,
        exp: signedItem.exp,
        turnId: signedItem.turnId,
        sessionId: signedItem.sessionId,
      });

      expect(mockSonioxClient).toHaveBeenCalledWith({
        config: { api_key: "fetched-key-999" },
      });
      // The model comes from org config, never from a literal in the client.
      expect(mockGenerate).toHaveBeenCalledWith({
        text: signedItem.text,
        voice: "custom-voice",
        model: "tts-rt-v2",
        language: "en",
        audio_format: "mp3",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns the browser fallback when the daily cap is reached, without calling Soniox", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          fallback: "browser",
          reason: "daily_cap_exceeded",
          notice: "Daily voice quota reached. Switching to browser voice.",
        }),
    });

    try {
      const result = await synthesizeSonioxBrowser(signedItem);
      expect(result).toEqual({
        fallback: "browser",
        notice: "Daily voice quota reached. Switching to browser voice.",
      });
      expect(mockGenerate).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws a clear error when the key route rejects the request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 403 });

    try {
      await expect(synthesizeSonioxBrowser(signedItem)).rejects.toThrow(
        "Failed to obtain temporary Soniox TTS key: 403",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
