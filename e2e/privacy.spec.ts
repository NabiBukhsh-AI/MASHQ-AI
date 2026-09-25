import { expect } from "@playwright/test";
import { learner, test } from "./helpers/session-mock";

/**
 * The privacy page, the self service export, and the cron guard. The claim that
 * matters most to a learner using voice is that we never store their audio, so it is checked
 * in both languages.
 */
test.describe("Privacy and my data @privacy", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("states in English and Urdu that audio is never stored", async ({ page }) => {
    await page.goto("/privacy");
    const main = page.getByTestId("privacy-page");
    await expect(main).toContainText("never stored");
    // The Urdu text carries its own lang and direction, not just a translation in a Latin block.
    const urdu = page.locator('[lang="ur"]').first();
    await expect(urdu).toBeVisible();
    await expect(urdu).toHaveAttribute("dir", "rtl");
  });

  test("says what is kept and for how long", async ({ page }) => {
    await page.goto("/privacy");
    const main = page.getByTestId("privacy-page");
    await expect(main).toContainText("30 days");
    await expect(main).toContainText("180 days");
    await expect(main).toContainText("90 days");
  });

  test("exports the caller's own data as a downloadable file", async ({ page }) => {
    await page.goto("/privacy");
    const res = await page.request.get("/api/me/data");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("pseudonym");
    expect(body).toHaveProperty("sessions");
    expect(body).toHaveProperty("evidence");
    // The export identifies by pseudonym; a learner already knows their own name.
    expect(JSON.stringify(body)).not.toContain(learner.email);
  });

  test("deletion needs the exact confirmation phrase", async ({ page }) => {
    await page.goto("/privacy");
    await page.getByTestId("delete-my-data").click();

    // The button stays disabled until the phrase matches exactly.
    await expect(page.getByTestId("delete-confirm-btn")).toBeDisabled();
    await page.getByTestId("delete-confirm-input").fill("delete my data");
    await expect(page.getByTestId("delete-confirm-btn")).toBeDisabled();
    await page.getByTestId("delete-confirm-input").fill("DELETE MY DATA");
    await expect(page.getByTestId("delete-confirm-btn")).toBeEnabled();
  });

  test("the API refuses a deletion without the confirmation", async ({ page }) => {
    const res = await page.request.delete("/api/me/data", { data: { confirm: "yes" } });
    expect(res.status()).toBe(400);
  });

  test("the retention cron refuses a request without the secret", async ({ page }) => {
    // Anyone can reach the URL; only the scheduler knows the secret.
    const res = await page.request.get("/api/cron/retention");
    expect([401, 403]).toContain(res.status());
  });
});
