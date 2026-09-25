import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const learner = {
  email: process.env.DEMO_LEARNER_EMAIL ?? "",
  password: process.env.DEMO_LEARNER_PASSWORD ?? "",
};

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("@a11y-shell", () => {
  test.beforeEach(async () => {
    test.setTimeout(60_000);
  });

  test("login page reports no serious or critical accessibility violations", async ({ page }) => {
    await page.goto("/login");

    // Run axe automated accessibility analysis on the login page
    const axeResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const seriousOrCritical = axeResults.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    expect(seriousOrCritical).toEqual([]);
  });

  test("login page maintains visible focus indicators across inputs and submit button", async ({
    page,
  }) => {
    await page.goto("/login");

    const emailInput = page.getByLabel("Email");
    await emailInput.focus();
    await expect(emailInput).toBeFocused();

    // Verify focus outline is rendered and visible
    const emailOutline = await emailInput.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.outlineStyle !== "none" || style.boxShadow !== "none";
    });
    expect(emailOutline).toBe(true);

    const submitBtn = page.getByRole("button", { name: "Sign in" });
    await submitBtn.focus();
    await expect(submitBtn).toBeFocused();
  });

  test("app shell renders skip link that moves focus to main content", async ({ page }) => {
    if (!learner.email) {
      test.skip(true, "DEMO_LEARNER_EMAIL not set");
      return;
    }

    await signIn(page, learner);
    await expect(page).toHaveURL(/\/learn$/);

    const skipLink = page.getByRole("link", { name: /skip to/i });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await skipLink.click();
    const mainLandmark = page.locator("#main-content");
    await expect(mainLandmark).toBeFocused();
  });

  test("authenticated app shell reports no serious or critical accessibility violations", async ({
    page,
  }) => {
    if (!learner.email) {
      test.skip(true, "DEMO_LEARNER_EMAIL not set");
      return;
    }

    await signIn(page, learner);
    await expect(page).toHaveURL(/\/learn$/);

    // Run axe automated analysis on the learner shell
    const axeResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const seriousOrCritical = axeResults.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    expect(seriousOrCritical).toEqual([]);
  });

  test("accessibility toolbar toggles text scaling and high contrast attributes on document root", async ({
    page,
  }) => {
    if (!learner.email) {
      test.skip(true, "DEMO_LEARNER_EMAIL not set");
      return;
    }

    await signIn(page, learner);
    await expect(page).toHaveURL(/\/learn$/);

    // Test high contrast toggle
    const contrastBtn = page.getByRole("button", { name: /high contrast/i });
    await expect(contrastBtn).toBeVisible();
    await contrastBtn.click();

    const contrastAttr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-contrast"),
    );
    expect(contrastAttr).toBe("high");

    // Test text scale toggle
    const textScaleBtn = page.getByRole("button", { name: /text size/i });
    await expect(textScaleBtn).toBeVisible();
    await textScaleBtn.click();

    const scaleAttr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-text-scale"),
    );
    expect(scaleAttr).toBeDefined();
    expect(scaleAttr).not.toBe("normal");
  });
});
