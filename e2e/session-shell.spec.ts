import { expect } from "@playwright/test";
import { learner, test } from "./helpers/session-mock";

/**
 * Signing in per test trips the login limiter (10 per IP per minute), which made whichever
 * test happened to be the eleventh sign-in of the run fail. The worker fixture signs in once
 * and shares the cookies, so the outcome no longer depends on where in the suite this spec runs.
 */
test.describe("Session Shell and Navigation @session-shell", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("returns 404 for non-existent or unowned session id", async ({ page }) => {
    // Intercept 404 response for unowned session
    await page.route("**/api/sessions/00000000-0000-0000-0000-000000000000", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: "Session not found.",
          },
        }),
      });
    });

    await page.goto("/learn/sessions/00000000-0000-0000-0000-000000000000");

    // Verify 404 container and message are rendered
    await expect(page.getByTestId("session-not-found")).toBeVisible();
    await expect(page.locator("text=Session Not Found")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Practice" })).toBeVisible();
  });

  test("renders session shell with route strip, toolbar, and conversation", async ({ page }) => {
    const mockSession = {
      sessionId: "session-mock-123",
      orgId: "org-mock",
      userId: "user-mock",
      journeyId: "journey-mock-1",
      journeyTitle: "Branch Counter Care",
      currentMissionId: "m-1",
      currentMission: {
        id: "m-1",
        title: "The First Minute",
        ordinal: 0,
        chapterKey: "ch_counter",
      },
      personaId: "branch_new_joiner",
      language: "en",
      presets: [],
      status: "active",
      turns: [
        {
          id: "turn-seed-1",
          role: "tutor",
          text: "Mr. Rasheed has arrived at your counter. How do you greet him?",
          lang: "en",
          dir: "ltr",
        },
      ],
      totalMissions: 3,
      ui: null,
      progress: { started: true, finished: false, completed: 0, total: 3 },
    };

    await page.route("**/api/sessions/session-mock-123", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSession),
      });
    });

    await page.goto("/learn/sessions/session-mock-123");

    // Verify RouteStrip shows station progress
    const routeStrip = page.getByTestId("route-strip");
    await expect(routeStrip).toBeVisible();
    const desktopSummary = page.getByTestId("route-desktop-summary");
    await expect(desktopSummary).toBeVisible();
    await expect(desktopSummary).toContainText("Station 1 of 3:");
    await expect(desktopSummary).toContainText("The First Minute");

    // Verify SessionToolbar controls
    await expect(page.getByTestId("session-toolbar")).toBeVisible();
    await expect(page.getByTestId("toolbar-persona-select")).toBeVisible();
    await expect(page.getByTestId("lang-btn-en")).toBeVisible();
    await expect(page.getByTestId("lang-btn-ur")).toBeVisible();

    // Verify Conversation message stream
    const conversation = page.getByTestId("conversation-stream");
    await expect(conversation).toBeVisible();
    // Scoped to the bubble: the same text is also in the sr-only polite live region, so an
    // unscoped text locator matches twice and fails strict mode.
    await expect(page.getByTestId("turn-tutor")).toBeVisible();
    await expect(page.getByTestId("turn-tutor")).toContainText(
      "Mr. Rasheed has arrived at your counter.",
    );

    // Verify Composer
    await expect(page.getByTestId("composer-input")).toBeVisible();
    await expect(page.getByTestId("composer-send-btn")).toBeVisible();
    await expect(page.getByTestId("composer-hint-btn")).toBeVisible();
  });

  test("composer is keyboard operable with Enter to send and hint button", async ({ page }) => {
    const mockSession = {
      sessionId: "session-mock-keyboard",
      orgId: "org-mock",
      userId: "user-mock",
      journeyId: "journey-mock-1",
      journeyTitle: "Branch Counter Care",
      currentMissionId: "m-1",
      currentMission: {
        id: "m-1",
        title: "The First Minute",
        ordinal: 0,
        chapterKey: "ch_counter",
      },
      personaId: "branch_new_joiner",
      language: "en",
      presets: [],
      status: "active",
      turns: [],
      totalMissions: 2,
      ui: null,
      progress: { started: true, finished: false, completed: 0, total: 3 },
    };

    await page.route("**/api/sessions/session-mock-keyboard", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSession),
      });
    });

    await page.goto("/learn/sessions/session-mock-keyboard");

    // Empty state should be visible
    await expect(page.getByTestId("conversation-empty")).toBeVisible();

    // Focus composer textarea
    const input = page.getByTestId("composer-input");
    await input.focus();
    await expect(input).toBeFocused();

    // Type learner response and press Enter
    await input.fill("Good morning, welcome to Demo Bank. How may I assist you today?");
    await page.keyboard.press("Enter");

    // Learner turn should appear
    await expect(page.getByTestId("turn-learner")).toBeVisible();
    await expect(
      page.locator("text=Good morning, welcome to Demo Bank. How may I assist you today?"),
    ).toBeVisible();

    // Click "I need a hint" button
    const hintBtn = page.getByTestId("composer-hint-btn");
    await hintBtn.click();

    // Hint message should appear as learner message in the conversation stream
    const conversationStream = page.getByTestId("conversation-stream");
    await expect(conversationStream.locator("text=I need a hint")).toBeVisible();
  });

  test("renders Urdu messages with rtl direction and Nastaliq styling", async ({ page }) => {
    const mockUrduSession = {
      sessionId: "session-mock-urdu",
      orgId: "org-mock",
      userId: "user-mock",
      journeyId: "journey-mock-urdu",
      journeyTitle: "بینک برانچ معیارات",
      currentMissionId: "m-ur-1",
      currentMission: {
        id: "m-ur-1",
        title: "شناخت کی تصدیق",
        ordinal: 0,
        chapterKey: "ch_urdu",
      },
      personaId: "branch_new_joiner",
      language: "ur",
      presets: [],
      status: "active",
      turns: [
        {
          id: "turn-ur-1",
          role: "tutor",
          text: "کسٹمر کا اصل شناختی کارڈ طلب کریں اور تصدیق مکمل کریں۔",
          lang: "ur",
          dir: "rtl",
        },
      ],
      totalMissions: 2,
      ui: null,
      progress: { started: true, finished: false, completed: 0, total: 3 },
    };

    await page.route("**/api/sessions/session-mock-urdu", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockUrduSession),
      });
    });

    await page.goto("/learn/sessions/session-mock-urdu");

    // Verify Urdu turn is rendered with RTL direction and Urdu font class
    const urduTurn = page.getByTestId("turn-tutor");
    await expect(urduTurn).toBeVisible();

    const bidiContainer = urduTurn.locator('[dir="rtl"]');
    await expect(bidiContainer).toBeVisible();
    await expect(bidiContainer).toHaveAttribute("lang", "ur");
  });
});
