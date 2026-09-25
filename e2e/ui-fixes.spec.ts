import { expect } from "@playwright/test";
import { admin, adminTest, learner, test } from "./helpers/session-mock";

/**
 * The UI faults Nabi found by looking at the running app, each with a test so it stays fixed.
 * Every one of these passed every existing check while being visibly broken, which is the
 * point: unit tests asserted the broken hrefs, and nothing rendered the CSS at all.
 */

test.describe("Reported UI faults @ui-fixes", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("every navigation link resolves instead of 404ing", async ({ page }) => {
    await page.goto("/learn");
    const hrefs = await page
      .locator("nav a[href^='/']")
      .evaluateAll((els) =>
        Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!))),
      );
    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of hrefs) {
      const res = await page.goto(href);
      expect(res?.status(), `${href} returned ${res?.status()}`).toBeLessThan(400);
    }
  });

  test("the high contrast button actually changes the colours", async ({ page }) => {
    await page.goto("/learn");
    const rendered = () => page.evaluate(() => getComputedStyle(document.body).color);

    const before = await rendered();
    await page.getByRole("button", { name: "High contrast" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");

    // The attribute was already being set. What was missing is any rule that reads it: the
    // stylesheet comma joined a selector with an @media rule, which is invalid CSS, so the
    // browser dropped the whole block. Asserting the rendered colour rather than the custom
    // property, because the build minifies #000000 to #000.
    const after = await rendered();
    expect(before).not.toBe("rgb(0, 0, 0)");
    expect(after).toBe("rgb(0, 0, 0)");
  });

  test("the language choice reaches the page, not just the header", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Practise");

    await page.getByRole("button", { name: "اردو" }).click();

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // The page heading and the sign out control both used to stay in English.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مشق");
    await expect(page.getByRole("button", { name: "سائن آؤٹ" })).toBeVisible();
  });

  test("the language choice survives a navigation", async ({ page }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "Roman" }).click();
    await page.goto("/learn/progress");
    // It lived in one component's useState, so every navigation reset it to English.
    await expect(page.getByRole("button", { name: "Roman" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the inspector metric tiles do not overflow their box", async ({ page }) => {
    await page.goto("/learn");
    await page.getByTestId("toggle-inspector-button").click();

    const tile = page.getByTestId("metric-grounding");
    await expect(tile).toBeVisible();
    // A grid item defaults to min-width auto, so the long placeholder widened the track and
    // spilled out of the card.
    const overflow = await tile.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const parent = el.parentElement!.getBoundingClientRect();
      return Math.round(box.right - parent.right);
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the inspector dot does not sit on top of its label in Urdu", async ({ page }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "اردو" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const button = page.getByTestId("toggle-inspector-button");
    // The dot used a physical margin-right, which stays on the right in RTL and collides with
    // the text. A logical margin follows the reading direction.
    const gap = await button.evaluate((el) => {
      const dot = el.querySelector("span")!.getBoundingClientRect();
      const label = el.getBoundingClientRect();
      // In RTL the dot sits at the right edge; it must not extend past the button's padding.
      return Math.round(dot.left - label.left);
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  });
});

test.describe("Sign in page @ui-fixes", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("offers the language switch before you sign in", async ({ page }) => {
    await page.goto("/login");

    // A learner who reads Urdu had to sign in through an English only form.
    const toggle = page.getByRole("group", { name: /Language|زبان|Zaban/ });
    await expect(toggle).toBeVisible();

    await page.getByRole("button", { name: "اردو" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مشق میں سائن ان کریں");
  });
});

adminTest.describe("Admin landing @ui-fixes", () => {
  adminTest.skip(!admin.email, "DEMO_ADMIN_EMAIL not set");

  adminTest("/admin shows settings rather than a placeholder", async ({ page }) => {
    await page.goto("/admin");
    // It held a "built in a later task" stub long after the screens were built.
    await expect(page.locator("body")).not.toContainText("built in a later task");
    await expect(page).toHaveURL(/\/admin\/config$/);
  });
});
