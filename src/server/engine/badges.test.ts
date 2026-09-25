import { describe, expect, it } from "vitest";
import { evaluateBadges, isBadgeEligible } from "./badges";
import type { Db } from "../db/client";

describe("Badges Engine", () => {
  describe("isBadgeEligible (Criteria Evaluation)", () => {
    it("evaluates first_steps / first_mission correctly", () => {
      expect(isBadgeEligible({ code: "first_mission" }, { missionsCompleted: 0 })).toBe(false);
      expect(isBadgeEligible({ code: "first_mission" }, { missionsCompleted: 1 })).toBe(true);
      expect(isBadgeEligible({ code: "first_steps" }, { missionsCompleted: 2 })).toBe(true);
    });

    it("evaluates teach_back / clear_explainer threshold >= 0.8", () => {
      expect(isBadgeEligible({ code: "teach_back" }, { teachBackScore: 0.79 })).toBe(false);
      expect(isBadgeEligible({ code: "teach_back" }, { teachBackScore: 0.8 })).toBe(true);
      expect(isBadgeEligible({ code: "clear_explainer" }, { teachBackScore: 0.95 })).toBe(true);
    });

    it("evaluates self_correct correctly", () => {
      expect(isBadgeEligible({ code: "self_correct" }, { selfCorrected: false })).toBe(false);
      expect(isBadgeEligible({ code: "self_correct" }, { selfCorrected: true })).toBe(true);
    });

    it("evaluates streak_3 / steady for 3 consecutive days", () => {
      expect(isBadgeEligible({ code: "streak_3" }, { streakDays: 2 })).toBe(false);
      expect(isBadgeEligible({ code: "streak_3" }, { streakDays: 3 })).toBe(true);
      expect(isBadgeEligible({ code: "steady" }, { streakDays: 5 })).toBe(true);
    });

    it("evaluates customer_first for demonstrated roleplay", () => {
      expect(isBadgeEligible({ code: "customer_first" }, {})).toBe(false);
      expect(isBadgeEligible({ code: "customer_first" }, { allRoleplayDemonstrated: true })).toBe(
        true,
      );
      expect(isBadgeEligible({ code: "customer_first" }, { roleplayCompleted: true })).toBe(true);
    });

    it("evaluates comeback for concept mastered after 2+ incorrect answers", () => {
      expect(isBadgeEligible({ code: "comeback" }, { masteredAfterIncorrect: 1 })).toBe(false);
      expect(isBadgeEligible({ code: "comeback" }, { masteredAfterIncorrect: 2 })).toBe(true);
      expect(isBadgeEligible({ code: "comeback" }, { masteredAfterIncorrect: 3 })).toBe(true);
    });

    it("evaluates bilingual for Urdu or mixed mode completion", () => {
      expect(isBadgeEligible({ code: "bilingual" }, { language: "en" })).toBe(false);
      expect(isBadgeEligible({ code: "bilingual" }, { language: "ur" })).toBe(true);
      expect(isBadgeEligible({ code: "bilingual" }, { language: "mixed" })).toBe(true);
    });
  });

  describe("evaluateBadges (Persistence and Idempotency)", () => {
    it("awards new badges and skips already earned badges", async () => {
      const allBadges = [
        {
          id: "badge_1",
          code: "first_mission",
          name: "First mission",
          nameUr: "پہلا مشن",
          description: "Completed first mission",
          criteria: {},
        },
        {
          id: "badge_2",
          code: "streak_3",
          name: "Three days running",
          nameUr: "تین دن مسلسل",
          description: "3 days streak",
          criteria: {},
        },
      ];

      // User already has badge_1
      const alreadyEarned = [{ badgeId: "badge_1" }];
      const insertedRows: Array<{ userId: string; badgeId: string; evidenceRef?: string | null }> =
        [];

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(alreadyEarned),
            then: (fn: (val: unknown) => unknown) => Promise.resolve(allBadges).then(fn),
          }),
        }),
        insert: () => ({
          values: (val: { userId: string; badgeId: string; evidenceRef?: string | null }) => {
            insertedRows.push(val);
            return {
              onConflictDoNothing: () => Promise.resolve(),
            };
          },
        }),
      } as unknown as Db;

      const result = await evaluateBadges(
        "usr_123",
        { missionsCompleted: 1, streakDays: 3, evidenceRef: "turn_999" },
        { db: mockDb },
      );

      // Should only award badge_2 because badge_1 is already earned
      expect(result).toHaveLength(1);
      expect(result[0]!.code).toBe("streak_3");
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0]?.badgeId).toBe("badge_2");
      expect(insertedRows[0]?.evidenceRef).toBe("turn_999");
    });
  });
});
