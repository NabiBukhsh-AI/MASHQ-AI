import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { XpToast } from "./XpToast";
import { LevelBadge } from "./LevelBadge";
import { StreakMeter } from "./StreakMeter";
import { UnlockBanner } from "./UnlockBanner";

describe("Gamification UI Components", () => {
  describe("XpToast", () => {
    it("renders amount and reason with accessible role", () => {
      const html = renderToStaticMarkup(<XpToast amount={25} reasonCode="teach_back" />);

      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain("+25 XP");
      expect(html).toContain("Strong teach-back");
    });

    it("renders level up celebration pill when levelUp is true", () => {
      const html = renderToStaticMarkup(
        <XpToast amount={50} reasonCode="mission_complete" levelUp={true} newLevel={3} />,
      );

      expect(html).toContain('data-testid="level-up-badge"');
      expect(html).toContain("Level 3!");
    });
  });

  describe("LevelBadge", () => {
    it("renders level number and progress percentage", () => {
      const html = renderToStaticMarkup(
        <LevelBadge
          level={2}
          totalXp={175}
          currentLevelXp={100}
          nextLevelXp={250}
          progress={0.5}
        />,
      );

      expect(html).toContain('data-testid="level-badge"');
      expect(html).toContain("Level 2");
      expect(html).toContain("50%");
      expect(html).toContain('aria-label="Level 2: 175 XP (50% to Level 3)"');
    });

    it("renders max level state cleanly without nextLevelXp", () => {
      const html = renderToStaticMarkup(
        <LevelBadge level={7} totalXp={2500} nextLevelXp={null} progress={1} />,
      );

      expect(html).toContain("Level 7");
      expect(html).not.toContain("% to Level");
    });
  });

  describe("StreakMeter", () => {
    it("renders current days with flame and freeze indicator", () => {
      const html = renderToStaticMarkup(
        <StreakMeter currentDays={5} longestDays={10} freezesLeft={1} />,
      );

      expect(html).toContain('data-testid="streak-meter"');
      expect(html).toContain("5");
      expect(html).toContain("days");
      expect(html).toContain('aria-label="5 day streak (1 freeze available)"');
    });

    it("uses singular day for 1 day streak", () => {
      const html = renderToStaticMarkup(<StreakMeter currentDays={1} freezesLeft={1} />);

      expect(html).toContain("1");
      expect(html).toContain("day");
    });
  });

  describe("UnlockBanner", () => {
    it("renders chapter unlock banner with accessible region", () => {
      const html = renderToStaticMarkup(
        <UnlockBanner
          title="Branch Customer Experience: De-escalation"
          description="Handle high-pressure counter situations effectively."
          kind="chapter"
          onAction={() => {}}
        />,
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain("Chapter Unlocked");
      expect(html).toContain("Branch Customer Experience: De-escalation");
      expect(html).toContain("Open Chapter");
    });

    it("renders final challenge banner with specialized copy", () => {
      const html = renderToStaticMarkup(
        <UnlockBanner
          title="Comprehensive Branch Challenge"
          kind="final_challenge"
          onAction={() => {}}
        />,
      );

      expect(html).toContain("Final Challenge Unlocked");
      expect(html).toContain("Start Challenge");
    });
  });
});
