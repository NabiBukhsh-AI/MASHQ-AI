import { expect } from "@playwright/test";
import { learner, test } from "./helpers/session-mock";

/**
 * Signing in per test trips the login limiter (10 per IP per minute), which made whichever
 * test happened to be the eleventh sign-in of the run fail. The worker fixture signs in once
 * and shares the cookies, so the outcome no longer depends on where in the suite this spec runs.
 */
test.describe("Quick Start and Live Pipeline @quickstart", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("renders quick start interface and input tabs", async ({ page }) => {
    await page.goto("/learn");

    // Check main headings and containers
    await expect(page.locator("text=Start Practising")).toBeVisible();
    await expect(page.getByTestId("quickstart-form")).toBeVisible();
    await expect(page.getByTestId("journey-map")).toBeVisible();

    // Check tabs
    const pasteTab = page.getByTestId("tab-paste");
    const fileTab = page.getByTestId("tab-file");
    const urlTab = page.getByTestId("tab-url");

    await expect(pasteTab).toBeVisible();
    await expect(fileTab).toBeVisible();
    await expect(urlTab).toBeVisible();

    // Switch to file tab
    await fileTab.click();
    await expect(page.getByTestId("dropzone")).toBeVisible();
    await expect(page.getByTestId("browse-button")).toBeVisible();

    // Switch to url tab
    await urlTab.click();
    await expect(page.getByTestId("url-input")).toBeVisible();

    // Switch back to paste tab
    await pasteTab.click();
    await expect(page.getByTestId("paste-textarea")).toBeVisible();
  });

  test("toggles Engine Inspector and displays IngestTab telemetry", async ({ page }) => {
    await page.goto("/learn");

    const toggleBtn = page.getByTestId("toggle-inspector-button");
    await expect(toggleBtn).toBeVisible();

    // Open Inspector
    await toggleBtn.click();
    await expect(page.getByTestId("inspector-panel")).toBeVisible();
    await expect(page.getByTestId("ingest-tab")).toBeVisible();

    // Close Inspector
    const closeBtn = page.getByTestId("close-inspector-button");
    await closeBtn.click();
    await expect(page.getByTestId("inspector-panel")).not.toBeVisible();
  });

  test("supports keyboard-only navigation across quick start controls", async ({ page }) => {
    await page.goto("/learn");

    // Focus paste title input and type
    const titleInput = page.getByTestId("paste-title-input");
    await titleInput.focus();
    await expect(titleInput).toBeFocused();
    await page.keyboard.type("Counter Care Protocol");

    // Tab into paste textarea
    await page.keyboard.press("Tab");
    const textarea = page.getByTestId("paste-textarea");
    await expect(textarea).toBeFocused();
    await page.keyboard.type("Staff must verify customer identity promptly.");

    // Verify character count updated
    await expect(page.getByTestId("char-counter")).toContainText("45 characters");
  });

  test("runs pipeline from paste and enables Start Mission 1", async ({ page }) => {
    // Intercept /api/content to return a mock content row
    await page.route("**/api/content", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          // The real intake response. This mock used to say "id", the field the client wrongly
          // read, so the test agreed with the bug for as long as the bug existed.
          contentId: "content-mock-123",
          jobId: "job-mock-1",
          reused: false,
          stats: { chars: 70, tokens: 18, chunks: 1, redactions: 0, injectionFlags: 0 },
          warnings: [],
        }),
      });
    });

    // Intercept SSE route /api/content/*/design with mock events
    await page.route("**/api/content/*/design", async (route) => {
      const sseBody = [
        'event: stage.start\ndata: {"stage":"outline","name":"Analyzing concepts"}\n\n',
        'event: outline.partial\ndata: {"title":"Branch Counter Care","chapters":1,"concepts":3,"missions":2}\n\n',
        'event: mission.ready\ndata: {"id":"m-1","ordinal":0,"key":"m_greet"}\n\n',
        'event: playable\ndata: {"journeyId":"journey-mock-1","missionId":"m-1","elapsedMs":1200}\n\n',
        'event: done\ndata: {"journeyId":"journey-mock-1","elapsedMs":1500}\n\n',
      ].join("");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: sseBody,
      });
    });

    await page.goto("/learn");

    // Fill form
    await page.getByTestId("paste-title-input").fill("Branch Counter Care");
    await page
      .getByTestId("paste-textarea")
      .fill("Staff must verify customer identity promptly within thirty seconds.");

    // Submit
    const submitBtn = page.getByTestId("submit-button");
    await submitBtn.click();

    // Verify journey map updates live
    await expect(page.getByTestId("journey-title")).toContainText("Branch Counter Care");
    await expect(page.getByTestId("chapter-ch_main")).toBeVisible();

    // Verify playable state and Start Mission 1 button
    const startMissionBtn = page.getByTestId("start-mission-button");
    await expect(startMissionBtn).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Ready to practice!")).toBeVisible();
  });
});
