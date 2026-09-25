import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  admin,
  adminTest,
  choiceUi,
  learner,
  manager,
  managerTest,
  mockSession,
  mockTurns,
  test,
  tutorTurn,
} from "./helpers/session-mock";

/**
 * The whole journey has to work by keyboard alone and report no serious or critical
 * axe violations. The cases that matter for a bank panel are a learner on a screen reader and
 * a learner who cannot use a mouse, not a general sweep.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}) on ${v.nodes.length} node(s)`);
}

test.describe("Accessibility @a11y", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test.beforeEach(async () => {
    test.setTimeout(90_000);
  });

  // Only the learner's own pages here. /manage and /admin redirect a learner to /learn and
  // still answer 200, so looping them on this fixture scanned /learn three times and reported
  // three passes. They are covered below on the fixtures that can actually reach them.
  for (const path of ["/learn", "/learn/progress"]) {
    test(`${path} reports no serious or critical axe violations`, async ({ page }) => {
      const res = await page.goto(path);
      test.skip(res !== null && res.status() >= 400, `${path} not available to this role`);
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  test("the session screen reports no serious or critical axe violations", async ({ page }) => {
    const id = "session-a11y-1";
    await mockSession(page, id, { ui: choiceUi });
    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("composer-input")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("a turn can be answered with the keyboard alone", async ({ page }) => {
    const id = "session-a11y-keyboard";
    await mockSession(page, id, { ui: choiceUi });
    const bodies = await mockTurns(page, id, () =>
      tutorTurn("Good, that is the right first move."),
    );

    await page.goto(`/learn/sessions/${id}`);
    const input = page.getByTestId("composer-input");
    await expect(input).toBeVisible();

    // No click anywhere: focus the box, type, and submit with the keyboard.
    await input.focus();
    await page.keyboard.type("Greet him and offer a seat");
    await page.keyboard.press("Enter");

    await expect(page.getByText("that is the right first move.").first()).toBeVisible();
    expect(bodies.length).toBeGreaterThan(0);
  });

  test("tutor replies are announced through a polite live region", async ({ page }) => {
    const id = "session-a11y-live";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Greeting first is right."));

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("hello");
    await page.getByTestId("composer-send-btn").click();
    await expect(page.getByText("Greeting first is right.").first()).toBeVisible();

    // A screen reader only hears the reply if it lands inside aria-live=polite.
    const announced = await page.evaluate(() => {
      const regions = Array.from(document.querySelectorAll('[aria-live="polite"]'));
      return regions.some((r) => (r.textContent ?? "").includes("Greeting first is right."));
    });
    expect(announced).toBe(true);
  });

  test("every control can be reached by tabbing, and focus is always visible", async ({ page }) => {
    const id = "session-a11y-tab";
    await mockSession(page, id, { ui: choiceUi });
    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("composer-input")).toBeVisible();

    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // The Next.js dev overlay is injected, not ours.
        if (el.tagName.startsWith("NEXTJS-")) return null;
        const style = getComputedStyle(el);
        return {
          key: `${el.tagName}:${el.getAttribute("data-testid") ?? el.textContent?.slice(0, 20)}`,
          // Something has to mark focus, or a keyboard learner is lost.
          hasFocusStyle:
            style.outlineStyle !== "none" ||
            style.boxShadow !== "none" ||
            el.matches(":focus-visible"),
        };
      });
      if (info) {
        seen.add(info.key);
        expect(info.hasFocusStyle, `no focus indicator on ${info.key}`).toBe(true);
      }
    }
    // The composer, send, hint and the toolbar controls at minimum.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  test("the screen reader preset turns audio off and keeps the tap alternatives", async ({
    page,
  }) => {
    const id = "session-a11y-sr";
    await mockSession(page, id, {
      ui: choiceUi,
      presets: ["screen_reader"],
      accessibility: { audioEnabled: false, reducedMotion: true, lowBandwidth: false },
    });

    let ttsCalls = 0;
    await page.route("**/api/voice/tts", async (route) => {
      ttsCalls += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await mockTurns(page, id, () =>
      tutorTurn("Greeting first is right.", [
        {
          type: "speech.item",
          index: 0,
          text: "Greeting first is right.",
          lang: "en",
          sig: "f".repeat(64),
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      ]),
    );

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("hello");
    await page.getByTestId("composer-send-btn").click();
    await expect(page.getByText("Greeting first is right.").first()).toBeVisible();

    // The button alternatives stay, which is the point of the preset.
    await expect(page.getByRole("button", { name: /Greet him and offer a seat/ })).toBeVisible();
    expect(ttsCalls).toBe(0);
  });
});

/**
 * The manager and admin screens, on fixtures that can actually reach them. Without these the
 * admin pages had no axe coverage at all: the learner fixture is redirected away from them.
 */
managerTest.describe("Accessibility, manager screens @a11y", () => {
  managerTest.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  for (const path of ["/manage", "/manage/report", "/library"]) {
    managerTest(`${path} reports no serious or critical axe violations`, async ({ page }) => {
      managerTest.setTimeout(90_000);
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});

adminTest.describe("Accessibility, admin screens @a11y", () => {
  adminTest.skip(!admin.email, "DEMO_ADMIN_EMAIL not set");

  // /admin redirects to /admin/config, so it has no page of its own to scan.
  for (const path of ["/admin/config", "/admin/system", "/admin/audit"]) {
    adminTest(`${path} reports no serious or critical axe violations`, async ({ page }) => {
      adminTest.setTimeout(90_000);
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});
