import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { choiceUi, learner, mockSession, mockTurns, test, tutorTurn } from "./helpers/session-mock";

// Engine Inspector: tabs, polling cadence, tier labels only, keyboard and axe.

const snapshot = (n: number) => ({
  cursor: `2026-09-19T10:00:0${Math.min(9, n)}.000Z`,
  events: [
    {
      id: `e${n}`,
      at: "2026-09-19T10:00:00.000Z",
      conceptKey: "c_first_minute_impact",
      signal: "choice",
      verdict: "incorrect",
      score: 0,
      credit: 0,
      weight: 0.4,
      hintLevel: 1,
      selfCorrected: false,
      misconceptionId: "m_someone_else_will_greet",
      pBefore: 0.2,
      pAfter: 0.16,
      source: "inline",
    },
  ],
  mastery: [
    {
      conceptKey: "c_first_minute_impact",
      conceptName: "The first minute decides the visit",
      p: 0.16,
      lower: 0,
      upper: 0.54,
      band: "not_yet",
      nEvents: n,
      nEff: 0.4 * n,
      signalTypes: ["choice"],
    },
  ],
  rules: [
    {
      id: `a${n}`,
      at: "2026-09-19T10:00:01.000Z",
      ruleId: "R07",
      moveType: "feedback_incorrect",
      modifiers: [],
      reason: "First incorrect answer on q1. Rule R07: gentle correction plus a level 1 hint.",
      source: "policy",
    },
  ],
  timings: {
    turns: [{ at: "t", ttftMs: 900, latencyMs: 2100, moveType: "feedback_incorrect" }],
    calls: [
      {
        at: "t",
        task: "turn.respond",
        tier: "fast",
        model: null,
        ttftMs: 900,
        latencyMs: 2100,
        inputTokens: 800,
        outputTokens: 120,
        cacheReadTokens: 7600,
        costUsd: 0.0025,
      },
    ],
    totals: { costUsd: 0.0025, cacheShare: 0.9, calls: 1 },
  },
  configVersion: n > 2 ? 4 : 3,
  configHash: "abcdef0123456789",
  configSummary: 'grounding.strictness is now "assisted"',
  mode: {
    grounding: "strict",
    assessment: "inline",
    rulesOnly: false,
    showModelIdentifiers: false,
  },
});

test.describe("Engine Inspector @inspector", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("tabs show evidence, mastery, rules and timings; tiers only, no model ids", async ({
    page,
  }) => {
    const id = "session-inspector-1";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Not quite."));
    let polls = 0;
    await page.route(`**/api/sessions/${id}/inspector**`, async (route) => {
      polls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot(polls)),
      });
    });
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("toggle-inspector-btn").click();
    const panel = page.getByTestId("inspector-panel");
    await expect(panel).toBeVisible();

    await page.getByTestId("inspector-tab-evidence").click();
    await expect(page.getByTestId("evidence-table")).toContainText("c_first_minute_impact");
    await expect(page.getByTestId("evidence-table")).toContainText("0.20 to 0.16");

    await page.getByTestId("inspector-tab-mastery").click();
    const meter = page.getByRole("meter");
    await expect(meter).toHaveAttribute("aria-valuenow", "16");
    await expect(page.getByTestId("mastery-list")).toContainText("not yet");

    await page.getByTestId("inspector-tab-rules").click();
    await expect(page.getByTestId("rules-list")).toContainText("R07 feedback_incorrect");
    await expect(page.getByTestId("rules-list")).toContainText("Rule R07: gentle correction");

    await page.getByTestId("inspector-tab-timings").click();
    await expect(page.getByTestId("timings")).toContainText("Fast tier");
    await expect(page.getByTestId("timings")).toContainText("90%");
    await expect(panel).not.toContainText("claude");
    await expect(page.getByTestId("inspector-mode")).toContainText("grounding strict");
  });

  test("polls about every 2 s while open and slows down when closed", async ({ page }) => {
    const id = "session-inspector-poll";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Noted."));
    let polls = 0;
    await page.route(`**/api/sessions/${id}/inspector**`, async (route) => {
      polls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot(polls)),
      });
    });
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("toggle-inspector-btn").click();
    await expect(page.getByTestId("inspector-panel")).toBeVisible();
    await page.waitForTimeout(5000);
    const openPolls = polls;
    // 5 s at 2 s each: at least two more than the first load, and not a busy loop.
    expect(openPolls).toBeGreaterThanOrEqual(3);
    expect(openPolls).toBeLessThan(10);

    await page.getByTestId("inspector-close").click();
    await expect(page.getByTestId("inspector-panel")).toHaveCount(0);
    const closedStart = polls;
    await page.waitForTimeout(5000);
    // Closed cadence is 10 s, so at most one poll lands in 5 s.
    expect(polls - closedStart).toBeLessThanOrEqual(1);
  });

  test("keyboard: arrow keys move between tabs and the panel is axe clean", async ({ page }) => {
    const id = "session-inspector-a11y";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Noted."));
    await page.route(`**/api/sessions/${id}/inspector**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot(1)),
      }),
    );
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("toggle-inspector-btn").click();
    await page.getByTestId("inspector-tab-turn").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("inspector-tab-evidence")).toBeFocused();
    await expect(page.getByTestId("inspector-tab-evidence")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("inspector-tab-turn")).toBeFocused();

    const results = await new AxeBuilder({ page })
      .include('[data-testid="inspector-panel"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  });

  test("a hidden tab stops polling and resumes when it comes back", async ({ page }) => {
    const id = "session-inspector-hidden";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Noted."));
    let polls = 0;
    await page.route(`**/api/sessions/${id}/inspector**`, async (route) => {
      polls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot(1)),
      });
    });
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("toggle-inspector-btn").click();
    await expect(page.getByTestId("inspector-panel")).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenStart = polls;
    await page.waitForTimeout(5000);
    // Nothing polls while the tab is hidden, whatever the panel state.
    expect(polls).toBe(hiddenStart);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => polls).toBeGreaterThan(hiddenStart);
  });

  test("mobile: the panel sits above the composer and never covers it", async ({ page }) => {
    const id = "session-inspector-mobile";
    await page.setViewportSize({ width: 375, height: 720 });
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Noted."));
    await page.route(`**/api/sessions/${id}/inspector**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot(1)),
      }),
    );
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("toggle-inspector-btn").click();
    // The panel grows as its first poll lands. Measuring before that settles read a partly
    // filled panel and made this assertion flaky by about ten pixels.
    await expect(page.getByTestId("inspector-panel")).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="inspector-panel"]');
      if (!el) return false;
      const h = el.getBoundingClientRect().height;
      const seen = Number((el as HTMLElement).dataset.seenHeight ?? 0);
      (el as HTMLElement).dataset.seenHeight = String(h);
      return h > 0 && h === seen;
    });
    const panel = await page.getByTestId("inspector-panel").boundingBox();
    const composer = await page.getByTestId("composer-input").boundingBox();
    expect(panel).not.toBeNull();
    expect(composer).not.toBeNull();
    // The reply box stays below the panel and fully on screen.
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(composer!.y + 1);
    await expect(page.getByTestId("composer-input")).toBeVisible();
    await page.getByTestId("composer-input").fill("still reachable");
    await expect(page.getByTestId("composer-input")).toHaveValue("still reachable");
  });

  test("Escape closes the panel and focus returns to the toolbar toggle", async ({ page }) => {
    const id = "session-inspector-esc";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Noted."));
    await page.route(`**/api/sessions/${id}/inspector**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot(1)),
      }),
    );
    await page.goto(`/learn/sessions/${id}`);
    const toggle = page.getByTestId("toggle-inspector-btn");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Opening moves focus into the panel, so the next Tab lands inside it.
    await expect(page.getByTestId("inspector-panel")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("inspector-panel")).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("a config version change shows a banner that can be dismissed", async ({ page }) => {
    const id = "session-inspector-config";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Noted."));
    let polls = 0;
    await page.route(`**/api/sessions/${id}/inspector**`, async (route) => {
      polls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(snapshot(polls)),
      });
    });
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("toggle-inspector-btn").click();
    await expect(page.getByTestId("inspector-config-banner")).toContainText(
      "Settings updated to v4",
    );
    await expect(page.getByTestId("inspector-config-banner")).toContainText(
      "grounding.strictness is now",
    );
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("inspector-config-banner")).toHaveCount(0);
  });
});
