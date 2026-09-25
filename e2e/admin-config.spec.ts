import { expect, type Page } from "@playwright/test";
import { admin, adminTest as test, manager, managerTest } from "./helpers/session-mock";

/**
 * Admin settings. The parts worth guarding are the authorization boundary, that an
 * invalid document is refused with the offending fields named rather than swallowed, and that
 * a rollback is itself a new audited version rather than a silent rewrite of history.
 */
const CONFIG = {
  version: 3,
  hash: "hash-3",
  config: {
    grounding: { strictness: "strict" },
    language: { register: "colleague" },
    voice: { output: { enabled: true }, input: { enabled: true } },
    gamification: { enabled: true },
  },
  versions: [
    {
      version: 3,
      note: "Grounding strictness set to strict",
      createdAt: "2026-09-20T09:00:00Z",
      isActive: true,
    },
    { version: 2, note: "Seed: code defaults", createdAt: "2026-09-19T09:00:00Z", isActive: false },
  ],
};

async function mockConfig(page: Page, onWrite?: (body: unknown) => unknown) {
  await page.route("**/api/admin/config", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CONFIG),
      });
      return;
    }
    const body = route.request().postDataJSON() as unknown;
    const result = onWrite ? onWrite(body) : { version: 4, summary: "grounding.strictness" };
    const status = (result as { __status?: number }).__status ?? 200;
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
}

test.describe("Admin settings @admin-config", () => {
  test.skip(!admin.email, "DEMO_ADMIN_EMAIL not set");

  test.beforeEach(async () => {
    test.setTimeout(90_000);
  });

  test("shows the active version and the common settings", async ({ page }) => {
    await mockConfig(page);
    await page.goto("/admin/config");

    await expect(page.getByTestId("admin-config")).toContainText("Active version 3");
    await expect(page.getByTestId("field-grounding.strictness")).toHaveValue("strict");
    await expect(page.getByTestId("field-voice.output.enabled")).toHaveValue("true");
  });

  test("changing grounding sends a patch with a reason for the audit trail", async ({ page }) => {
    const writes: unknown[] = [];
    await mockConfig(page, (body) => {
      writes.push(body);
      return { version: 4, summary: "grounding.strictness" };
    });
    await page.goto("/admin/config");

    await page.getByTestId("field-grounding.strictness").selectOption("assisted");
    await expect(page.getByTestId("config-message")).toContainText("version 4");

    expect(writes).toHaveLength(1);
    const sent = writes[0] as { patch: Record<string, unknown>; reason: string };
    expect(sent.patch).toEqual({ grounding: { strictness: "assisted" } });
    // A change with no reason is unauditable, so the UI never sends one.
    expect(sent.reason.length).toBeGreaterThan(0);
  });

  test("names the offending fields when the document is refused", async ({ page }) => {
    await mockConfig(page, () => ({
      __status: 400,
      error: {
        message: "Check these settings.",
        details: [{ path: "mastery.slip", message: "Number must be less than or equal to 0.3" }],
      },
    }));
    await page.goto("/admin/config");

    await page.getByTestId("config-reason").fill("testing validation");
    await page.getByTestId("config-save").click();

    await expect(page.getByTestId("field-errors")).toContainText("mastery.slip");
  });

  test("refuses to save malformed JSON without calling the server", async ({ page }) => {
    let writes = 0;
    await mockConfig(page, () => {
      writes += 1;
      return { version: 4 };
    });
    await page.goto("/admin/config");
    await expect(page.getByTestId("config-json")).not.toHaveValue("");

    await page.getByTestId("config-json").fill("{ not json ");
    await page.getByTestId("config-reason").fill("testing");
    await page.getByTestId("config-save").click();

    await expect(page.getByTestId("config-error")).toContainText("not valid JSON");
    expect(writes).toBe(0);
  });

  test("requires a reason before saving the advanced document", async ({ page }) => {
    await mockConfig(page);
    await page.goto("/admin/config");
    await expect(page.getByTestId("config-save")).toBeDisabled();
    await page.getByTestId("config-reason").fill("a reason");
    await expect(page.getByTestId("config-save")).toBeEnabled();
  });

  test("rolls back to an earlier version, saved as a new version", async ({ page }) => {
    await mockConfig(page);
    let rolledTo: number | null = null;
    await page.route("**/api/admin/config/rollback", async (route) => {
      rolledTo = (route.request().postDataJSON() as { toVersion: number }).toVersion;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 4, summary: "rollback" }),
      });
    });
    await page.goto("/admin/config");

    await page.getByTestId("rollback-2").click();
    await expect(page.getByTestId("config-message")).toContainText("Rolled back to v2");
    expect(rolledTo).toBe(2);
    // History stays append only: the new state is a new version, not version 2 again.
    await expect(page.getByTestId("config-message")).toContainText("version 4");
  });

  test("the active version offers no rollback button", async ({ page }) => {
    await mockConfig(page);
    await page.goto("/admin/config");
    await expect(page.getByTestId("rollback-3")).toHaveCount(0);
    await expect(page.getByTestId("rollback-2")).toBeVisible();
  });

  test("the audit page shows actor, versions and the diff", async ({ page }) => {
    await page.route("**/api/admin/audit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entries: [
            {
              id: "a1",
              actorId: "usr-admin",
              entity: "config",
              action: "update",
              fromVersion: 2,
              toVersion: 3,
              diff: [{ op: "replace", path: "/grounding/strictness", value: "assisted" }],
              reason: "Pilot tuning",
              createdAt: "2026-09-20T09:00:00Z",
            },
          ],
        }),
      });
    });
    await page.goto("/admin/audit");

    const table = page.getByTestId("audit-table");
    await expect(table).toContainText("update");
    await expect(table).toContainText("2 to 3");
    await expect(table).toContainText("Pilot tuning");

    await page.getByTestId("audit-diff-a1").click();
    await expect(page.locator("pre")).toContainText("grounding/strictness");
  });
});

managerTest.describe("Admin settings authorization @admin-config", () => {
  managerTest.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  managerTest("a manager cannot read the settings API", async ({ page }) => {
    // The page is a convenience; the boundary is the route, so that is what is tested.
    const res = await page.request.get("/api/admin/config");
    expect(res.status()).toBe(403);
  });

  managerTest("a manager cannot write the settings API", async ({ page }) => {
    const res = await page.request.patch("/api/admin/config", {
      data: { patch: { grounding: { strictness: "assisted" } }, reason: "attempt" },
    });
    expect(res.status()).toBe(403);
  });

  managerTest("a manager cannot roll settings back", async ({ page }) => {
    const res = await page.request.post("/api/admin/config/rollback", {
      data: { toVersion: 1 },
    });
    expect(res.status()).toBe(403);
  });

  managerTest("a manager cannot read the audit trail", async ({ page }) => {
    const res = await page.request.get("/api/admin/audit");
    expect(res.status()).toBe(403);
  });
});
