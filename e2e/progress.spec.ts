import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { learner, test } from "./helpers/session-mock";

/**
 * The learner's own progress. The things that matter are that it is scoped to them,
 * that mastery is never presented as a measurement, and that the charts are readable without
 * sight, which is why the mastery view is a table rather than a canvas.
 */
test.describe("Learner progress @progress", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  const sample = {
    concepts: [
      {
        conceptId: "c1",
        conceptKey: "k1",
        conceptLabel: "Greeting within thirty seconds",
        p: 0.72,
        band: "proficient",
        lower: 0.61,
        upper: 0.83,
        nEvents: 6,
      },
      {
        conceptId: "c2",
        conceptKey: "k2",
        conceptLabel: "Listening fully",
        p: 0.31,
        band: "developing",
        lower: 0.2,
        upper: 0.42,
        nEvents: 4,
      },
    ],
    evidence: [
      {
        id: "e1",
        conceptLabel: "Listening fully",
        verdict: "correct",
        signal: "mcq",
        hintLevel: 1,
        at: "2026-09-19T10:00:00.000Z",
        why: "Your estimate went up because you got it right after a hint, which counts for a little less than first time.",
      },
    ],
    xp: { total: 340, level: 3, nextLevelXp: 500, progress: 0.4 },
    streak: { currentDays: 4, longestDays: 9, freezesLeft: 1 },
    badges: [{ code: "first_mission", name: "First steps", description: "First mission done" }],
    minutesThisWeek: 37,
    nextRecommendation: {
      kind: "concept",
      label: "Listening fully",
      reason: "This is the topic your answers suggest is least settled so far.",
    },
  };

  test("shows mastery as an estimate with its range, never as a score", async ({ page }) => {
    await page.route("**/api/progress", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sample),
      });
    });

    await page.goto("/learn/progress");
    const table = page.getByTestId("mastery-table");
    await expect(table).toBeVisible();

    // The word "estimated" and the range are both required.
    await expect(table).toContainText("estimated 0.72");
    await expect(table).toContainText("0.61 to 0.83");
    await expect(table).toContainText("Proficient");
  });

  test("uses a real table, so the mastery view works without sight", async ({ page }) => {
    await page.route("**/api/progress", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sample),
      });
    });
    await page.goto("/learn/progress");

    // Column headers and a caption are what make this readable in a screen reader.
    const headers = await page.locator('[data-testid="mastery-table"] th[scope="col"]').count();
    expect(headers).toBeGreaterThanOrEqual(4);
    await expect(page.locator('[data-testid="mastery-table"] caption')).toHaveCount(1);
  });

  test("gives the next recommendation with the reason behind it", async ({ page }) => {
    await page.route("**/api/progress", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sample),
      });
    });
    await page.goto("/learn/progress");

    const next = page.getByTestId("next-recommendation");
    await expect(next).toContainText("Listening fully");
    await expect(next).toContainText("least settled");
  });

  test("explains why each estimate moved, in words not numbers", async ({ page }) => {
    await page.route("**/api/progress", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sample),
      });
    });
    await page.goto("/learn/progress");
    await expect(page.getByTestId("evidence-list")).toContainText("after a hint");
  });

  test("asks the server only for the caller's own progress", async ({ page }) => {
    const urls: string[] = [];
    await page.route("**/api/progress**", async (route) => {
      urls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sample),
      });
    });
    await page.goto("/learn/progress");
    await expect(page.getByTestId("mastery-table")).toBeVisible();

    // No user or org parameter exists to tamper with: the server reads both from the session.
    for (const url of urls) {
      expect(url).not.toMatch(/userId=|orgId=|user_id=/);
    }
  });

  test("shows the level badge with progress toward the next level", async ({ page }) => {
    await page.route("**/api/progress", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sample),
      });
    });
    await page.goto("/learn/progress");

    const badge = page.getByTestId("level-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Level 3");
    await expect(badge).toContainText("340");
    // The point of the badge over a plain number: how far to the next level.
    await expect(badge).toContainText("40%");
  });

  test("reports no serious or critical accessibility violations", async ({ page }) => {
    await page.route("**/api/progress", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sample),
      });
    });
    await page.goto("/learn/progress");
    await expect(page.getByTestId("mastery-table")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      // The offending element in the message: a bare rule id does not say what to fix.
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .map((n) => n.html)
            .join(" | ")
            .slice(0, 300)}`,
      );
    expect(serious).toEqual([]);
  });
});
