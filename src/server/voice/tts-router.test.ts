import { describe, it, expect, vi, beforeEach } from "vitest";
import { routeTts, estimateAudioSeconds, karachiStartOfDay } from "./tts-router";
import { signSpeech } from "./speech-token";
import { DEFAULT_CONFIG } from "../config/defaults";
import type { Config } from "../config/schema";

describe("tts-router", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const userId = "00000000-0000-0000-0000-0000000000a1";
  const sessionId = "00000000-0000-0000-0000-0000000000b1";
  const scope = { orgId, userId, sessionId };
  const dummyAudio = Buffer.from("dummy-mp3-audio-content");

  let mockConfig: Config;
  let insertedMediaUsage: Array<Record<string, unknown>> = [];
  let simulatedUsedSeconds = 0;

  beforeEach(() => {
    insertedMediaUsage = [];
    simulatedUsedSeconds = 0;
    mockConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  });

  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ totalSeconds: String(simulatedUsedSeconds) }]),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertedMediaUsage.push(row);
        return Promise.resolve();
      },
    }),
  } as unknown as NonNullable<Parameters<typeof routeTts>[1]>["db"];

  it("rejects unsigned request with error", async () => {
    await expect(
      routeTts(
        {
          text: "Khushamdeed.",
          lang: "ur",
          orgId,
          userId,
          sessionId,
        },
        { config: mockConfig, db: mockDb },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("rejects expired speech token", async () => {
    const text = "Khushamdeed.";
    const token = signSpeech(text, "ur", "turn-1", scope, -10); // Expired 10s ago

    await expect(
      routeTts(
        {
          text,
          lang: "ur",
          turnId: "turn-1",
          sig: token.sig,
          exp: token.exp,
          orgId,
          userId,
          sessionId,
        },
        { config: mockConfig, db: mockDb },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("rejects text exceeding maxChars limit", async () => {
    const text = "a".repeat(450);
    const token = signSpeech(text, "ur", "turn-1", scope);

    await expect(
      routeTts(
        {
          text,
          lang: "ur",
          turnId: "turn-1",
          sig: token.sig,
          exp: token.exp,
          orgId,
          userId,
          sessionId,
        },
        { config: mockConfig, db: mockDb },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("routes Urdu text to Uplift primary provider", async () => {
    const text = "Aap ka account successfully open ho chuka hai.";
    const token = signSpeech(text, "ur", "turn-1", scope);

    const mockUplift = vi.fn().mockResolvedValue({
      audio: dummyAudio,
      ttfbMs: 120,
      totalMs: 240,
      contentType: "audio/mpeg",
    });
    const mockSoniox = vi.fn();

    const result = await routeTts(
      {
        text,
        lang: "ur",
        turnId: "turn-1",
        sig: token.sig,
        exp: token.exp,
        orgId,
        userId,
        sessionId,
      },
      {
        config: mockConfig,
        db: mockDb,
        synthesizers: { uplift: mockUplift, soniox: mockSoniox },
      },
    );

    expect(result.status).toBe("audio");
    if (result.status === "audio") {
      expect(result.provider).toBe("uplift");
      expect(result.audio).toEqual(dummyAudio);
      expect(result.failover).toBe(false);
      expect(result.ttfbMs).toBe(120);
    }
    expect(mockUplift).toHaveBeenCalledTimes(1);
    expect(mockSoniox).not.toHaveBeenCalled();

    // Verify media_usage logged
    expect(insertedMediaUsage.length).toBe(1);
    expect(insertedMediaUsage[0]?.provider).toBe("uplift");
    expect(insertedMediaUsage[0]?.failover).toBe(false);
  });

  it("routes English text to Uplift first, so the tutor keeps one voice", async () => {
    // Nabi's voice is Uplift v_meklc281 in every language (22 Sep). English used to try
    // Soniox first, whose voice is a placeholder that always fails.
    const text = "Welcome to United Bank Limited.";
    const token = signSpeech(text, "en", "turn-2", scope);

    const mockSoniox = vi.fn();
    const mockUplift = vi.fn().mockResolvedValue({
      audio: dummyAudio,
      ttfbMs: 900,
      totalMs: 1400,
      contentType: "audio/mpeg",
    });

    const result = await routeTts(
      {
        text,
        lang: "en",
        turnId: "turn-2",
        sig: token.sig,
        exp: token.exp,
        orgId,
        userId,
        sessionId,
      },
      {
        config: mockConfig,
        db: mockDb,
        synthesizers: { uplift: mockUplift, soniox: mockSoniox },
      },
    );

    expect(result.status).toBe("audio");
    if (result.status === "audio") {
      expect(result.provider).toBe("uplift");
      expect(result.voice).toBe("v_meklc281");
      expect(result.failover).toBe(false);
    }
    expect(mockUplift).toHaveBeenCalledTimes(1);
    expect(mockSoniox).not.toHaveBeenCalled();
  });

  it("fails over from Uplift to Soniox when Uplift errors", async () => {
    const text = "Kripya intezar kijiye.";
    const token = signSpeech(text, "ur", "turn-3", scope);

    const mockUplift = vi.fn().mockRejectedValue(new Error("Uplift 503 Service Unavailable"));
    const mockSoniox = vi.fn().mockResolvedValue({
      audio: dummyAudio,
      ttfbMs: 150,
      totalMs: 300,
      contentType: "audio/mpeg",
    });

    const result = await routeTts(
      {
        text,
        lang: "ur",
        turnId: "turn-3",
        sig: token.sig,
        exp: token.exp,
        orgId,
        userId,
        sessionId,
      },
      {
        config: mockConfig,
        db: mockDb,
        synthesizers: { uplift: mockUplift, soniox: mockSoniox },
      },
    );

    expect(result.status).toBe("audio");
    if (result.status === "audio") {
      expect(result.provider).toBe("soniox");
      expect(result.failover).toBe(true);
    }
    expect(mockUplift).toHaveBeenCalledTimes(1);
    expect(mockSoniox).toHaveBeenCalledTimes(1);

    expect(insertedMediaUsage.length).toBe(1);
    expect(insertedMediaUsage[0]?.provider).toBe("soniox");
    expect(insertedMediaUsage[0]?.failover).toBe(true);
  });

  it("falls back to browser voice when all remote providers fail", async () => {
    const text = "Kuch der baad dobara koshish karein.";
    const token = signSpeech(text, "ur", "turn-4", scope);

    const mockUplift = vi.fn().mockRejectedValue(new Error("Uplift Network Error"));
    const mockSoniox = vi.fn().mockRejectedValue(new Error("Soniox Timeout"));

    const result = await routeTts(
      {
        text,
        lang: "ur",
        turnId: "turn-4",
        sig: token.sig,
        exp: token.exp,
        orgId,
        userId,
        sessionId,
      },
      {
        config: mockConfig,
        db: mockDb,
        synthesizers: { uplift: mockUplift, soniox: mockSoniox },
      },
    );

    expect(result.status).toBe("fallback");
    if (result.status === "fallback") {
      expect(result.fallbackTo).toBe("browser");
      expect(result.reason).toBe("all_providers_failed");
      expect(result.notice).toContain("Falling back to browser");
    }
  });

  it("switches to browser voice when daily seconds cap is exceeded", async () => {
    const text = "Yeh cap check test hai.";
    const token = signSpeech(text, "ur", "turn-5", scope);

    // Simulate 3650 seconds used (cap is 3600)
    simulatedUsedSeconds = 3650;

    const mockUplift = vi.fn();
    const mockSoniox = vi.fn();

    const result = await routeTts(
      {
        text,
        lang: "ur",
        turnId: "turn-5",
        sig: token.sig,
        exp: token.exp,
        orgId,
        userId,
        sessionId,
      },
      {
        config: mockConfig,
        db: mockDb,
        synthesizers: { uplift: mockUplift, soniox: mockSoniox },
      },
    );

    expect(result.status).toBe("fallback");
    if (result.status === "fallback") {
      expect(result.fallbackTo).toBe("browser");
      expect(result.reason).toBe("daily_cap_exceeded");
      expect(result.notice).toContain("Daily voice quota reached");
    }
    expect(mockUplift).not.toHaveBeenCalled();
    expect(mockSoniox).not.toHaveBeenCalled();
  });

  it("maps character profile to configured voice ID", async () => {
    const text = "Aap ka CNIC number kya hai?";
    const token = signSpeech(text, "ur", "turn-6", scope);

    const mockUplift = vi.fn().mockResolvedValue({
      audio: dummyAudio,
      ttfbMs: 100,
      totalMs: 200,
      contentType: "audio/mpeg",
    });

    const result = await routeTts(
      {
        text,
        lang: "ur",
        profile: "elder_customer",
        turnId: "turn-6",
        sig: token.sig,
        exp: token.exp,
        orgId,
        userId,
        sessionId,
      },
      {
        config: mockConfig,
        db: mockDb,
        synthesizers: { uplift: mockUplift },
      },
    );

    expect(result.status).toBe("audio");
    if (result.status === "audio") {
      expect(result.voice).toBe("v_yypgzenx"); // elder_customer in defaults.ts
    }
    expect(mockUplift).toHaveBeenCalledWith(
      "Aap ka CNIC number kya hai?",
      "v_yypgzenx",
      expect.any(Object),
    );
  });

  it("estimates audio seconds proportionally to character count", () => {
    expect(estimateAudioSeconds("Short")).toBeGreaterThanOrEqual(0.5);
    const est = estimateAudioSeconds(
      "This is a longer sentence with roughly forty-five characters in it.",
    );
    expect(est).toBeGreaterThan(2);
  });

  it("karachiStartOfDay returns a valid Date object", () => {
    const start = karachiStartOfDay(new Date("2026-09-20T12:00:00Z"));
    expect(start).toBeInstanceOf(Date);
    expect(isNaN(start.getTime())).toBe(false);
  });
});
