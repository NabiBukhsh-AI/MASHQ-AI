import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  karachiDay,
  spendState,
  todaysSpendUsd,
  checkSpend,
  recordSpend,
  bustSpendCache,
} from "./spend";
import type { Db } from "../db/client";

const mockLimits = {
  rate: {
    perIpPerMinute: 120,
    turnsPerUserPerMinute: 20,
    ingestsPerUserPerHour: 10,
    voiceKeysPerUserPerMinute: 8,
    ttsPerUserPerMinute: 90,
    loginPerIpPerMinute: 10,
  },
  tokenBudgetPerSession: 250_000,
  dailySpendCapUsd: 10.0,
  degradeAtPercent: 80,
  maxConcurrentIngests: 2,
};

describe("spend defense", () => {
  beforeEach(() => {
    bustSpendCache();
  });

  describe("karachiDay", () => {
    it("formats calendar date according to Asia/Karachi timezone (UTC+5)", () => {
      // 2026-09-17 19:30 UTC is 2026-09-18 00:30 PKT
      const lateUtc = new Date("2026-09-17T19:30:00Z");
      expect(karachiDay(lateUtc)).toBe("2026-09-18");

      // 2026-09-17 18:30 UTC is 2026-09-17 23:30 PKT
      const eveningUtc = new Date("2026-09-17T18:30:00Z");
      expect(karachiDay(eveningUtc)).toBe("2026-09-17");
    });
  });

  describe("spendState", () => {
    it("returns 'ok' when spend is under degrade threshold", () => {
      expect(spendState(0, mockLimits)).toBe("ok");
      expect(spendState(5.0, mockLimits)).toBe("ok");
      expect(spendState(7.99, mockLimits)).toBe("ok");
    });

    it("returns 'degrade' when spend reaches or exceeds degradeAtPercent up to cap", () => {
      // 80% of $10.00 is $8.00
      expect(spendState(8.0, mockLimits)).toBe("degrade");
      expect(spendState(8.5, mockLimits)).toBe("degrade");
      expect(spendState(9.99, mockLimits)).toBe("degrade");
    });

    it("returns 'block' when spend reaches or exceeds daily cap", () => {
      expect(spendState(10.0, mockLimits)).toBe("block");
      expect(spendState(10.01, mockLimits)).toBe("block");
      expect(spendState(25.0, mockLimits)).toBe("block");
    });
  });

  describe("todaysSpendUsd and caching", () => {
    it("reads spend from db and caches value for subsequent reads", async () => {
      const selectMock = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ usd: "4.5000" }]),
        }),
      });

      const mockDb = { select: selectMock } as unknown as Db;
      const orgId = "org-cache-test";
      const fixedDate = new Date("2026-09-18T10:00:00Z");

      // First read hits db
      const spend1 = await todaysSpendUsd(orgId, mockDb, fixedDate);
      expect(spend1).toBe(4.5);
      expect(selectMock).toHaveBeenCalledTimes(1);

      // Second read hits 15s memory cache without querying db again
      const spend2 = await todaysSpendUsd(orgId, mockDb, fixedDate);
      expect(spend2).toBe(4.5);
      expect(selectMock).toHaveBeenCalledTimes(1);

      // bustSpendCache clears cache, forcing next read to query db
      bustSpendCache();
      const spend3 = await todaysSpendUsd(orgId, mockDb, fixedDate);
      expect(spend3).toBe(4.5);
      expect(selectMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("checkSpend", () => {
    it("combines todays spend with config limits to determine spend state", async () => {
      const selectMock = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ usd: "8.5000" }]),
        }),
      });
      const mockDb = { select: selectMock } as unknown as Db;

      const state = await checkSpend("org-state-test", mockLimits, mockDb);
      expect(state).toBe("degrade");
    });
  });

  describe("recordSpend", () => {
    it("upserts spend record and updates cached spend figure in memory", async () => {
      const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
      const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

      const selectMock = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ usd: "2.0000" }]),
        }),
      });

      const mockDb = {
        insert: insertMock,
        select: selectMock,
      } as unknown as Db;

      const orgId = "org-record-test";
      const fixedDate = new Date("2026-09-18T12:00:00Z");

      // Seed cache with 2.0
      await todaysSpendUsd(orgId, mockDb, fixedDate);

      // Record additional 1.5 spend
      await recordSpend(orgId, "anthropic", 1.5, 3000, mockDb, fixedDate);

      expect(insertMock).toHaveBeenCalled();
      expect(onConflictDoUpdateMock).toHaveBeenCalled();

      // Read from cache: should reflect updated 3.5 without db select
      const updated = await todaysSpendUsd(orgId, mockDb, fixedDate);
      expect(updated).toBeCloseTo(3.5);
      expect(selectMock).toHaveBeenCalledTimes(1);
    });
  });
});
