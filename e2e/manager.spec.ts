import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { manager, managerTest as test } from "./helpers/session-mock";

/**
 * The manager dashboard. What matters is that the filters really drive every widget,
 * that the summary sentence agrees with the KPI row rather than being written separately, and
 * that the heatmap is usable without a mouse or colour vision.
 */
const KPIS = {
  activeLearners: 41,
  sessions: 308,
  turns: 1051,
  completionRate: 0.63,
  meanMasteryGain: 0.36,
  conceptsPractised: 8,
  costUsd: 3.2,
};

const RESPONSES: Record<string, unknown> = {
  summary: {
    sentence:
      "In the last 14 days, 41 learners practised 8 topics. Estimated mastery rose by 0.36 on average, and 63% of sessions were completed.",
    kpis: KPIS,
  },
  masteryMatrix: [
    {
      pseudonym: "Learner 001",
      concept_key: "k1",
      concept_label: "Greeting within thirty seconds",
      p: 0.72,
      band: "proficient",
      lower: 0.61,
      upper: 0.83,
      n_events: 6,
    },
    {
      pseudonym: "Learner 002",
      concept_key: "k1",
      concept_label: "Greeting within thirty seconds",
      p: 0.25,
      band: "not_yet",
      lower: 0.15,
      upper: 0.35,
      n_events: 3,
    },
  ],
  funnel: { started: 308, firstMissionDone: 260, halfMissionsDone: 180, completed: 194 },
  missionDropoff: [{ mission_title: "Welcoming the customer", ordinal: 1, abandoned_sessions: 42 }],
  languageVoice: [
    { language: "ur", modality: "voice", sessions: 80, turns: 300, tts_failovers: 4 },
  ],
  contentHealth: [
    {
      concept_label: "Listening fully",
      hint_rate: 0.42,
      first_try_incorrect_rate: 0.31,
      mean_score: 0.55,
      evidence_count: 120,
    },
  ],
  personas: [
    { persona_id: "branch_new_joiner", sessions: 120, completion_rate: 0.6, mean_turns: 7.2 },
  ],
};

/** Records every analytics request so a test can assert the filters reached the server. */
async function mockAnalytics(page: Page, seen: string[]) {
  await page.route("**/api/analytics/**", async (route) => {
    const url = new URL(route.request().url());
    seen.push(url.pathname + url.search);
    const widget = url.pathname.split("/").pop() ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ widget, data: RESPONSES[widget] ?? [] }),
    });
  });
}

test.describe("Manager dashboard @manager", () => {
  test.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  test.beforeEach(async () => {
    test.setTimeout(90_000);
  });

  test("renders every widget", async ({ page }) => {
    await mockAnalytics(page, []);
    await page.goto("/manage");

    await expect(page.getByTestId("summary-sentence")).toBeVisible();
    await expect(page.getByTestId("kpi-row")).toBeVisible();
    await expect(page.getByTestId("mastery-heatmap")).toBeVisible();
    await expect(page.getByTestId("funnel")).toBeVisible();
    await expect(page.getByTestId("dropoff-table")).toBeVisible();
    await expect(page.getByTestId("language-table")).toBeVisible();
    await expect(page.getByTestId("personas-table")).toBeVisible();
    await expect(page.getByTestId("content-health-table")).toBeVisible();
  });

  test("the summary sentence agrees with the KPI row", async ({ page }) => {
    await mockAnalytics(page, []);
    await page.goto("/manage");

    // Both come from the same server response, so they cannot drift apart.
    await expect(page.getByTestId("kpi-learners")).toHaveText("41");
    await expect(page.getByTestId("kpi-completion")).toHaveText("63%");
    await expect(page.getByTestId("kpi-gain")).toHaveText("0.36");
    const sentence = await page.getByTestId("summary-sentence").textContent();
    expect(sentence).toContain("41 learners");
    expect(sentence).toContain("63%");
    expect(sentence).toContain("0.36");
  });

  test("changing a filter updates the URL and refetches every widget", async ({ page }) => {
    const seen: string[] = [];
    await mockAnalytics(page, seen);
    await page.goto("/manage");
    await expect(page.getByTestId("summary-sentence")).toBeVisible();

    const before = seen.length;
    await page.getByTestId("filter-lang-ur").click();

    await expect(page).toHaveURL(/languages=ur/);
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBeGreaterThan(before);
    // Every widget refetched, not just one.
    const after = seen.slice(before);
    expect(after.every((u) => u.includes("languages=ur"))).toBe(true);
    expect(new Set(after.map((u) => u.split("?")[0])).size).toBeGreaterThanOrEqual(7);
  });

  test("a shared URL opens the same filtered view", async ({ page }) => {
    const seen: string[] = [];
    await mockAnalytics(page, seen);
    await page.goto("/manage?days=30&languages=ur&includeSeeded=false");
    await expect(page.getByTestId("summary-sentence")).toBeVisible();

    expect(seen.some((u) => u.includes("languages=ur"))).toBe(true);
    expect(seen.some((u) => u.includes("includeSeeded=false"))).toBe(true);
    await expect(page.getByTestId("filter-days")).toHaveValue("30");
    await expect(page.getByTestId("filter-seeded")).not.toBeChecked();
  });

  test("shows the seeded data badge only while demo rows are included", async ({ page }) => {
    await mockAnalytics(page, []);
    await page.goto("/manage");
    await expect(page.getByTestId("seeded-badge")).toBeVisible();

    await page.getByTestId("filter-seeded").uncheck();
    await expect(page.getByTestId("seeded-badge")).toBeHidden();
  });

  test("the heatmap states each band in text, not colour alone", async ({ page }) => {
    await mockAnalytics(page, []);
    await page.goto("/manage");
    const heatmap = page.getByTestId("mastery-heatmap");
    // WCAG 1.4.1: a manager who cannot see the colour still has to read the band.
    await expect(heatmap).toContainText("proficient");
    await expect(heatmap).toContainText("not yet");
    await expect(heatmap.locator("caption")).toHaveCount(1);
  });

  test("reports no serious or critical accessibility violations", async ({ page }) => {
    await mockAnalytics(page, []);
    await page.goto("/manage");
    await expect(page.getByTestId("mastery-heatmap")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} on ${v.nodes.length}`);
    expect(serious).toEqual([]);
  });

  test("filters are reachable and operable by keyboard", async ({ page }) => {
    await mockAnalytics(page, []);
    await page.goto("/manage");
    await expect(page.getByTestId("summary-sentence")).toBeVisible();

    await page.getByTestId("filter-lang-en").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/languages=en/);
    await expect(page.getByTestId("filter-lang-en")).toHaveAttribute("aria-pressed", "true");
  });
});
