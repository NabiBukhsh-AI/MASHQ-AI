import { describe, it, expect, beforeEach, vi } from "vitest";
import { limit, rateLimitCheck, resetRatelimitMemory } from "./ratelimit";
import type { Redis } from "@upstash/redis";
import { log } from "../obs/logger";

describe("ratelimit", () => {
  beforeEach(() => {
    resetRatelimitMemory();
    vi.clearAllMocks();
  });

  describe("in-memory sliding window fallback", () => {
    it("allows requests within rule capacity and decrements remaining quota", async () => {
      // rule login allows 10 requests per minute
      const key = "user-123";

      for (let i = 0; i < 5; i++) {
        const res = await limit("login", key, { redis: null });
        expect(res.ok).toBe(true);
        expect(res.remaining).toBe(10 - (i + 1));
        expect(res.resetMs).toBeGreaterThan(0);
      }
    });

    it("blocks requests once capacity is exceeded and provides resetMs", async () => {
      // rule voiceKeys allows 8 per minute
      const key = "learner-voice-1";

      for (let i = 0; i < 8; i++) {
        const res = await limit("voiceKeys", key, { redis: null });
        expect(res.ok).toBe(true);
      }

      // 9th request must be rejected
      const blocked = await limit("voiceKeys", key, { redis: null });
      expect(blocked.ok).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.resetMs).toBeGreaterThan(0);
    });

    it("resets quota after sliding window expires", async () => {
      let currentTime = 1_000_000;
      const key = "timed-user";

      // Exhaust login quota (10 requests)
      for (let i = 0; i < 10; i++) {
        const res = await limit("login", key, { redis: null, now: () => currentTime });
        expect(res.ok).toBe(true);
      }

      // 11th request blocked
      const blocked = await limit("login", key, { redis: null, now: () => currentTime });
      expect(blocked.ok).toBe(false);

      // Advance time by 61 seconds (past the 60 second window)
      currentTime += 61_000;

      // Request now succeeds
      const renewed = await limit("login", key, { redis: null, now: () => currentTime });
      expect(renewed.ok).toBe(true);
      expect(renewed.remaining).toBe(9);
    });

    it("rateLimitCheck returns boolean status", async () => {
      const key = "boolean-check-key";
      const allowed = await rateLimitCheck(key, "login", { redis: null });
      expect(allowed).toBe(true);
    });
  });

  describe("Redis error handling and logging fallback", () => {
    it("engages in-memory fallback when Redis throws an authentication or connection error", async () => {
      const warnSpy = vi.spyOn(log, "warn");

      // Mock a broken Redis client that throws WRONGPASS like local Upstash
      const brokenRedis = {
        eval: vi.fn().mockRejectedValue(new Error("WRONGPASS invalid username-password pair")),
        evalsha: vi.fn().mockRejectedValue(new Error("WRONGPASS invalid username-password pair")),
        scriptLoad: vi
          .fn()
          .mockRejectedValue(new Error("WRONGPASS invalid username-password pair")),
      } as unknown as Redis;

      // Should not throw, but fallback to memory
      const res = await limit("turns", "session-broken-redis", { redis: brokenRedis });
      expect(res.ok).toBe(true);
      expect(res.remaining).toBe(19);

      // Warning should be logged with event name
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "redis_ratelimit_fallback_engaged",
        }),
      );
    });

    it("throttles fallback error logs to at most once per 60 seconds", async () => {
      const warnSpy = vi.spyOn(log, "warn");

      const brokenRedis = {
        eval: vi.fn().mockRejectedValue(new Error("Connection reset")),
        evalsha: vi.fn().mockRejectedValue(new Error("Connection reset")),
        scriptLoad: vi.fn().mockRejectedValue(new Error("Connection reset")),
      } as unknown as Redis;

      // Call 5 times in quick succession
      for (let i = 0; i < 5; i++) {
        await limit("turns", `user-throttle-${i}`, { redis: brokenRedis });
      }

      // Logged exactly once due to 60s throttle
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
