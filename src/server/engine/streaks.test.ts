import { describe, expect, it } from "vitest";
import { daysBetween, getKarachiWeekStart, toKarachiDate, updateStreak } from "./streaks";
import type { Db } from "../db/client";

function createMockDb(existingRows: unknown[] = []): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(existingRows),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  } as unknown as Db;
}

describe("Streaks Engine (Asia/Karachi)", () => {
  describe("Timezone boundaries", () => {
    it("handles Asia/Karachi UTC+5 offset across midnight correctly", () => {
      // 18:59 UTC on Sep 19 is 23:59 in Karachi (Sep 19)
      const lateNight = new Date("2026-09-19T18:59:00Z");
      expect(toKarachiDate(lateNight)).toBe("2026-09-19");

      // 19:01 UTC on Sep 19 is 00:01 in Karachi on the next day (Sep 20)
      const earlyMorning = new Date("2026-09-19T19:01:00Z");
      expect(toKarachiDate(earlyMorning)).toBe("2026-09-20");
    });

    it("calculates exact calendar day differences", () => {
      expect(daysBetween("2026-09-19", "2026-09-19")).toBe(0);
      expect(daysBetween("2026-09-19", "2026-09-20")).toBe(1);
      expect(daysBetween("2026-09-19", "2026-09-21")).toBe(2);
      expect(daysBetween("2026-09-19", "2026-09-26")).toBe(7);
    });

    it("calculates Monday of the week for replenishment", () => {
      // 2026-09-19 is Saturday -> week start is Monday 2026-09-14
      const sat = new Date("2026-09-19T12:00:00Z");
      expect(getKarachiWeekStart(sat)).toBe("2026-09-14");

      // 2026-09-20 is Sunday -> still in week starting Monday 2026-09-14
      const sun = new Date("2026-09-20T12:00:00Z");
      expect(getKarachiWeekStart(sun)).toBe("2026-09-14");

      // 2026-09-21 is Monday -> new week starts 2026-09-21
      const mon = new Date("2026-09-21T12:00:00Z");
      expect(getKarachiWeekStart(mon)).toBe("2026-09-21");
    });
  });

  describe("Streak progression and freeze logic", () => {
    it("initializes a new streak on first activity", async () => {
      const mockDb = createMockDb([]);

      const res = await updateStreak("usr_streak_1", new Date("2026-09-19T10:00:00Z"), {
        db: mockDb,
      });

      expect(res.status).toBe("new");
      expect(res.currentDays).toBe(1);
      expect(res.longestDays).toBe(1);
      expect(res.freezeUsed).toBe(false);
      expect(res.freezesLeft).toBe(1);
      expect(res.lastActiveDate).toBe("2026-09-19");
    });

    it("does not increment or consume freeze on same calendar day", async () => {
      const existing = {
        currentDays: 3,
        longestDays: 5,
        lastActiveDate: "2026-09-19",
        freezesLeft: 1,
        updatedAt: new Date("2026-09-19T06:00:00Z"),
      };

      const mockDb = createMockDb([existing]);

      const res = await updateStreak("usr_streak_1", new Date("2026-09-19T14:00:00Z"), {
        db: mockDb,
      });

      expect(res.status).toBe("same_day");
      expect(res.currentDays).toBe(3);
      expect(res.freezeUsed).toBe(false);
      expect(res.freezesLeft).toBe(1);
    });

    it("increments streak on consecutive calendar day", async () => {
      const existing = {
        currentDays: 3,
        longestDays: 3,
        lastActiveDate: "2026-09-19",
        freezesLeft: 1,
        updatedAt: new Date("2026-09-19T10:00:00Z"),
      };

      const mockDb = createMockDb([existing]);

      const res = await updateStreak("usr_streak_1", new Date("2026-09-20T10:00:00Z"), {
        db: mockDb,
      });

      expect(res.status).toBe("extended");
      expect(res.currentDays).toBe(4);
      expect(res.longestDays).toBe(4);
      expect(res.freezeUsed).toBe(false);
      expect(res.freezesLeft).toBe(1);
    });

    it("consumes freeze on missing 1 calendar day", async () => {
      // Active on Sep 18, next active on Sep 20 (missed Sep 19)
      const existing = {
        currentDays: 5,
        longestDays: 5,
        lastActiveDate: "2026-09-18",
        freezesLeft: 1,
        updatedAt: new Date("2026-09-18T10:00:00Z"),
      };

      const mockDb = createMockDb([existing]);

      const res = await updateStreak("usr_streak_1", new Date("2026-09-20T10:00:00Z"), {
        db: mockDb,
      });

      expect(res.status).toBe("freeze_used");
      expect(res.currentDays).toBe(6);
      expect(res.freezeUsed).toBe(true);
      expect(res.freezesLeft).toBe(0);
    });

    it("resets to 1 day on missing 1 day if freezes are exhausted", async () => {
      const existing = {
        currentDays: 5,
        longestDays: 10,
        lastActiveDate: "2026-09-18",
        freezesLeft: 0,
        updatedAt: new Date("2026-09-18T10:00:00Z"),
      };

      const mockDb = createMockDb([existing]);

      const res = await updateStreak("usr_streak_1", new Date("2026-09-20T10:00:00Z"), {
        db: mockDb,
      });

      expect(res.status).toBe("reset");
      expect(res.currentDays).toBe(1);
      expect(res.longestDays).toBe(10);
      expect(res.freezeUsed).toBe(false);
      expect(res.freezesLeft).toBe(0);
    });

    it("resets to 1 day when missing more than 1 day regardless of freeze", async () => {
      const existing = {
        currentDays: 7,
        longestDays: 7,
        lastActiveDate: "2026-09-15",
        freezesLeft: 1,
        updatedAt: new Date("2026-09-15T10:00:00Z"),
      };

      const mockDb = createMockDb([existing]);

      const res = await updateStreak("usr_streak_1", new Date("2026-09-20T10:00:00Z"), {
        db: mockDb,
      });

      expect(res.status).toBe("reset");
      expect(res.currentDays).toBe(1);
    });
  });
});
