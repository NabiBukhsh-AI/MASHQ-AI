import { expect, type Page } from "@playwright/test";
import { admin, adminTest as test, manager, managerTest } from "./helpers/session-mock";

/**
 * The admin system view. The rule that matters here is a project convention: the UI
 * shows tiers, never model identifiers, unless the setting is deliberately turned on.
 */
const SYSTEM = {
  configVersion: 3,
  showModelIdentifiers: false,
  usage: { sessions: 308, turns: 1051, ingests: 4 },
  latency: [
    {
      task: "turn.respond",
      tier: "fast",
      calls: 240,
      ttft_p50: 980,
      ttft_p95: 2400,
      latency_p95: 3600,
      errors: 2,
      fallbacks: 1,
    },
  ],
  cost: [{ day: "2026-09-20T00:00:00Z", cost_usd: 0.42, calls: 120 }],
  cacheHitRate: 0.73,
  media: [{ provider: "uplift", calls: 40, failovers: 6, seconds: 120 }],
  spend: { today: 4.6, capUsd: 5, degradeAtPercent: 80 },
  breaker: { routes: [{ route: "anthropic:fast", state: "open", failures: 3 }] },
};

async function mockSystem(page: Page, override: Partial<typeof SYSTEM> = {}) {
  await page.route("**/api/analytics/system", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...SYSTEM, ...override }),
    });
  });
}

test.describe("Admin system view @system", () => {
  test.skip(!admin.email, "DEMO_ADMIN_EMAIL not set");

  test.beforeEach(async () => {
    test.setTimeout(90_000);
  });

  test("shows usage, cache hit rate and spend against the cap", async ({ page }) => {
    await mockSystem(page);
    await page.goto("/admin/system");

    await expect(page.getByTestId("sys-sessions")).toHaveText("308");
    await expect(page.getByTestId("sys-turns")).toHaveText("1051");
    await expect(page.getByTestId("sys-cache")).toHaveText("73%");
    await expect(page.getByTestId("sys-spend")).toContainText("$4.60 of $5.00");
  });

  test("warns once spend passes the degrade threshold", async ({ page }) => {
    await mockSystem(page);
    await page.goto("/admin/system");
    // 4.60 of 5.00 is 92%, past the 80% degrade point.
    await expect(page.getByTestId("sys-spend-warning")).toContainText("92%");
  });

  test("stays quiet while spend is well under the cap", async ({ page }) => {
    await mockSystem(page, { spend: { today: 0.4, capUsd: 5, degradeAtPercent: 80 } });
    await page.goto("/admin/system");
    await expect(page.getByTestId("sys-spend-warning")).toHaveCount(0);
  });

  test("shows latency percentiles, errors and fallbacks by task", async ({ page }) => {
    await mockSystem(page);
    await page.goto("/admin/system");

    const table = page.getByTestId("sys-latency-table");
    await expect(table).toContainText("turn.respond");
    await expect(table).toContainText("2400");
    await expect(table).toContainText("fast");
  });

  test("shows the tier and no model identifier by default", async ({ page }) => {
    await mockSystem(page);
    await page.goto("/admin/system");
    await expect(page.getByTestId("sys-latency-table")).toBeVisible();

    const body = await page.getByTestId("admin-system").textContent();
    // Tiers only unless ui.showModelIdentifiers is on.
    expect(body).toContain("fast");
    expect(body).not.toMatch(/claude-|gemini-|gpt-/i);
    await expect(page.getByTestId("admin-system")).toContainText("Tiers are shown");
  });

  test("shows speech provider failovers, which is how an admin spots a dead provider", async ({
    page,
  }) => {
    await mockSystem(page);
    await page.goto("/admin/system");
    const table = page.getByTestId("sys-media-table");
    await expect(table).toContainText("uplift");
    await expect(table).toContainText("6");
  });

  test("names the route the breaker has opened, so a dead provider is visible", async ({
    page,
  }) => {
    await mockSystem(page);
    await page.goto("/admin/system");
    await expect(page.getByTestId("sys-breaker")).toContainText("anthropic:fast: open");
  });

  test("says plainly when nothing has failed, rather than implying health", async ({ page }) => {
    await mockSystem(page, { breaker: { routes: [] } });
    await page.goto("/admin/system");
    // Breaker state is per instance, so an empty list is not proof that all is well.
    await expect(page.getByTestId("sys-breaker")).toContainText("no provider failures recorded");
  });
});

managerTest.describe("System view authorization @system", () => {
  managerTest.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  managerTest("a manager cannot read the system route", async ({ page }) => {
    const res = await page.request.get("/api/analytics/system");
    expect(res.status()).toBe(403);
  });
});
