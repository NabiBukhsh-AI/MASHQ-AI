import { expect } from "@playwright/test";
import { manager, managerTest as test } from "./helpers/session-mock";

/**
 * /library lives in the (manage) route group, whose layout requires an ld_manager or admin
 * session, so an unauthenticated visit lands on /login and never renders the intake.
 *
 * This used to assert that the words "Drag and drop" were on screen, which they were: the page
 * rendered a mock drop target that produced "mock-id-" + Date.now() and never called the API.
 * A manager could drop a file and nothing happened, and this test passed. It now asserts the
 * intake a manager can actually use.
 */
test.describe("Content library intake @intake", () => {
  test.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  test("offers upload, paste and link to a manager", async ({ page }) => {
    await page.goto("/library");

    await expect(page.getByRole("heading", { name: "Content library" })).toBeVisible();
    await expect(page.getByTestId("tab-file")).toBeVisible();
    await expect(page.getByTestId("tab-paste")).toBeVisible();
    await expect(page.getByTestId("tab-url")).toBeVisible();
  });

  test("actually posts the pasted text to the API", async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    await page.route("**/api/content", async (route) => {
      posted.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contentId: "c-1",
          jobId: "j-1",
          reused: false,
          stats: { chars: 40, tokens: 10, chunks: 1, redactions: 0, injectionFlags: 0 },
          warnings: [],
        }),
      });
    });

    await page.goto("/library");
    await page.getByTestId("tab-paste").click();
    await page
      .getByTestId("paste-textarea")
      .fill("Greet every customer within thirty seconds of them entering the branch.");
    await page.getByTestId("submit-button").click();

    // The mock never called this at all, which is the whole point of the test.
    await expect.poll(() => posted.length).toBeGreaterThan(0);
    expect(posted[0]).toMatchObject({ kind: "paste" });
  });
});

/**
 * The journey pipeline, end to end through the UI.
 *
 * The intake response is { contentId, ... } but the client read data.id, so the next request
 * went to /api/content/undefined/design. The UI reported "designing the journey failed", which
 * points at the model rather than at an id that was never read, and no test caught it because
 * nothing drove both requests in sequence.
 */
test.describe("Journey pipeline @intake", () => {
  test.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  test("sends the id the intake returned to the design endpoint", async ({ page }) => {
    const designUrls: string[] = [];

    await page.route("**/api/content", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contentId: "01a0c46e-e5e6-7c01-a6ca-0cbd18b02af6",
          jobId: "j-1",
          reused: false,
          stats: { chars: 80, tokens: 20, chunks: 1, redactions: 0, injectionFlags: 0 },
          warnings: [],
        }),
      });
    });

    await page.route("**/api/content/*/design", async (route) => {
      designUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'event: stage\ndata: {"stage":"outline","status":"running"}\n\n',
      });
    });

    await page.goto("/library");
    await page.getByTestId("tab-paste").click();
    await page
      .getByTestId("paste-textarea")
      .fill("Greet every customer within thirty seconds of them entering the branch.");
    await page.getByTestId("submit-button").click();

    await expect.poll(() => designUrls.length).toBeGreaterThan(0);
    expect(designUrls[0]).toContain("01a0c46e-e5e6-7c01-a6ca-0cbd18b02af6");
    // The exact shape of the bug: the literal string "undefined" in the path.
    expect(designUrls[0]).not.toContain("undefined");
  });
});
