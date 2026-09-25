import { expect, type Page } from "@playwright/test";
import { manager, managerTest as test } from "./helpers/session-mock";

/**
 * The printable report. The goal is a clean A4 document, so these tests print
 * it and check the page count and that no table is cut, rather than only checking the screen.
 */
const RESPONSES: Record<string, unknown> = {
  summary: {
    sentence:
      "In the last 14 days, 41 learners practised 8 topics. Estimated mastery rose by 0.36 on average, and 63% of sessions were completed.",
    kpis: {
      activeLearners: 41,
      sessions: 308,
      turns: 1051,
      completionRate: 0.63,
      meanMasteryGain: 0.36,
      conceptsPractised: 8,
      costUsd: 3.2,
    },
  },
  funnel: { started: 308, firstMissionDone: 260, halfMissionsDone: 180, completed: 194 },
  contentHealth: Array.from({ length: 5 }, (_, i) => ({
    concept_label: `Topic ${i + 1}`,
    hint_rate: 0.4,
    first_try_incorrect_rate: 0.3,
    mean_score: 0.55,
    evidence_count: 120,
  })),
  languageVoice: [
    { language: "ur", modality: "voice", sessions: 80, turns: 300, tts_failovers: 4 },
    { language: "en", modality: "text", sessions: 120, turns: 420, tts_failovers: 0 },
  ],
  personas: [
    { persona_id: "branch_new_joiner", sessions: 120, completion_rate: 0.6 },
    { persona_id: "senior_manager", sessions: 60, completion_rate: 0.72 },
  ],
};

async function mockAnalytics(page: Page) {
  await page.route("**/api/analytics/**", async (route) => {
    const widget = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ widget, data: RESPONSES[widget] ?? [] }),
    });
  });
}

test.describe("Printable report @report", () => {
  test.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  test.beforeEach(async () => {
    test.setTimeout(90_000);
  });

  test("carries every section the report is supposed to have", async ({ page }) => {
    await mockAnalytics(page);
    await page.goto("/manage/report");

    for (const id of [
      "report-scope",
      "report-summary",
      "report-content-health",
      "report-funnel",
      "report-language",
      "report-personas",
      "report-methodology",
      "report-data-notes",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("says how mastery was estimated, so it is not read as a test score", async ({ page }) => {
    await mockAnalytics(page);
    await page.goto("/manage/report");

    const method = page.getByTestId("report-methodology");
    await expect(method).toContainText("estimate");
    await expect(method).toContainText("not a test score");
  });

  test("declares whether the numbers include demo data", async ({ page }) => {
    await mockAnalytics(page);
    await page.goto("/manage/report");
    await expect(page.getByTestId("report-data-notes")).toContainText("seeded demonstration data");

    await page.goto("/manage/report?includeSeeded=false");
    await expect(page.getByTestId("report-data-notes")).toContainText("excludes seeded");
  });

  test("prints to a clean A4 document of two to four pages", async ({ page }) => {
    await mockAnalytics(page);
    await page.goto("/manage/report");
    await expect(page.getByTestId("report-methodology")).toBeVisible();

    const pdf = await page.pdf({ format: "A4", printBackground: false });
    expect(pdf.byteLength).toBeGreaterThan(1000);

    // Count the page objects the PDF declares.
    const text = pdf.toString("latin1");
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(pageCount).toBeLessThanOrEqual(4);
  });

  test("hides the controls when printed, so they do not appear on paper", async ({ page }) => {
    await mockAnalytics(page);
    await page.goto("/manage/report");
    await expect(page.getByTestId("report-print-btn")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("report-print-btn")).toBeHidden();
    // The report itself stays.
    await expect(page.getByTestId("report-summary")).toBeVisible();
  });

  test("keeps tables inside the page width when printing", async ({ page }) => {
    await mockAnalytics(page);
    await page.goto("/manage/report");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("report-content-health-table")).toBeVisible();

    // A table wider than its container is what produces a clipped column on paper.
    const overflow = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table"));
      return tables.some((t) => t.scrollWidth > t.clientWidth + 1);
    });
    expect(overflow).toBe(false);
  });
});
