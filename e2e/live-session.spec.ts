import { expect } from "@playwright/test";
import { learner, test } from "./helpers/session-mock";

// Live smoke against the running server, real database and real fast tier.
// Run on purpose: pnpm e2e --grep @live-session (skipped without LIVE_E2E=1).
test.describe("Live session @live-session", () => {
  test.skip(!learner.email || !process.env.LIVE_E2E, "needs DEMO_LEARNER_* and LIVE_E2E=1");
  test.setTimeout(240_000);

  test("start, wrong tap, hint, correct tap on the first ready journey", async ({ page }) => {
    const journeyId = process.env.LIVE_JOURNEY_ID!;
    const created = await page.request.post("/api/sessions", {
      data: { journeyId, personaId: "branch_new_joiner", language: "en" },
    });
    expect(created.status()).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const t0 = Date.now();
    await page.goto(`/learn/sessions/${sessionId}`);
    await expect(page.getByTestId("turn-tutor").first()).toBeVisible({ timeout: 60_000 });
    console.log(`opening turn visible after ${Date.now() - t0} ms`);
    await expect(page.getByTestId("mechanic-choice")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "test-results/live-1-opening.png", fullPage: true });

    // Tap the last option (usually a distractor), then ask for a hint, then try each option.
    const buttons = page.getByTestId("mechanic-choice").getByRole("button");
    const n = await buttons.count();
    await buttons.nth(n - 1).click();
    await expect(page.getByTestId("turn-tutor")).toHaveCount(2, { timeout: 60_000 });
    await page.getByTestId("toggle-inspector-btn").click();
    await page.screenshot({ path: "test-results/live-2-after-tap.png", fullPage: true });
    const inspector = await page.getByTestId("inspector-turn").innerText();
    console.log(inspector.replace(/\n/g, " | "));

    await page.getByTestId("composer-hint-btn").click();
    await expect(page.getByTestId("turn-tutor")).toHaveCount(3, { timeout: 60_000 });
    console.log((await page.getByTestId("inspector-turn").innerText()).replace(/\n/g, " | "));
    await page.screenshot({ path: "test-results/live-3-after-hint.png", fullPage: true });
  });
});
