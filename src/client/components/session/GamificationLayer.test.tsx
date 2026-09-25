import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GamificationLayer,
  parseGamification,
} from "@/client/components/session/GamificationLayer";

const award = {
  id: "x1",
  amount: 10,
  reasonCode: "correct_first_try",
  totalXp: 110,
  level: 2,
  levelUp: true,
  previousLevel: 1,
  progress: 0.1,
  nextLevelXp: 250,
};

describe("GamificationLayer", () => {
  it("parses the wire payload the engine actually sends", () => {
    const parsed = parseGamification({
      xpAwards: [award],
      streak: { currentDays: 3, freezesLeft: 1, freezeUsed: false },
      newBadges: [
        { id: "b1", code: "first_mission", name: "First steps", description: "First mission done" },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.xpAwards).toHaveLength(1);
    expect(parsed!.streak?.currentDays).toBe(3);
    expect(parsed!.newBadges[0]!.name).toBe("First steps");
  });

  it("rejects a payload that is not the gamification shape", () => {
    expect(parseGamification({ xpAwards: "lots" })).toBeNull();
    expect(parseGamification(null)).toBeNull();
  });

  it("shows the XP, the streak and the badge that the turn earned", () => {
    const data = parseGamification({
      xpAwards: [award, { ...award, id: "x2", amount: 5, levelUp: false }],
      streak: { currentDays: 3, freezesLeft: 1 },
      newBadges: [
        { id: "b1", code: "first_mission", name: "First steps", description: "First mission done" },
      ],
    });

    const html = renderToStaticMarkup(
      <GamificationLayer data={data} onDismiss={() => undefined} />,
    );

    expect(html).toContain("gamification-layer");
    // Both awards from the turn are summed into one celebration.
    expect(html).toContain("15");
    expect(html).toContain("First steps");
    expect(html).toContain("3");
  });

  it("renders nothing when the turn earned nothing", () => {
    const data = parseGamification({ xpAwards: [], newBadges: [] });
    const html = renderToStaticMarkup(
      <GamificationLayer data={data} onDismiss={() => undefined} />,
    );
    expect(html).toBe("");
  });
});
