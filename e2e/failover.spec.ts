import { expect } from "@playwright/test";
import { choiceUi, learner, mockSession, mockTurns, test, tutorTurn } from "./helpers/session-mock";

/**
 * What a learner sees when a provider fails. The engine's own failover is covered by
 * unit tests; this is about the screen not leaving someone stuck.
 */
test.describe("Provider failover @failover", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("a withdrawn turn tells the learner what to do next", async ({ page }) => {
    const id = "session-failover-1";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => [
      { type: "turn.start", turnId: "t1", moveTypes: [] },
      { type: "display.delta", text: "Partial answer that will be " },
      { type: "retract", turnId: "t1", reason: "stream_error" },
      {
        type: "error",
        code: "TUTOR_UNAVAILABLE",
        message: "The tutor did not answer this time. Try again.",
      },
      { type: "end" },
    ]);

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("hello");
    await page.getByTestId("composer-send-btn").click();

    // The half written reply is gone, and the message says what happened and what to do.
    await expect(page.getByText("Partial answer that will be")).toHaveCount(0);
    await expect(page.getByText(/did not answer this time/i).first()).toBeVisible();
    // The composer is still usable, so the learner is not stuck.
    await expect(page.getByTestId("composer-input")).toBeEnabled();
  });

  test("speech falling back to captions does not stop the conversation", async ({ page }) => {
    const id = "session-failover-2";
    await mockSession(page, id, { ui: choiceUi });
    await page.route("**/api/voice/tts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fallback: "browser",
          reason: "all_providers_failed",
          notice: "Primary speech provider unavailable.",
        }),
      });
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

    // The caption is the fallback, so the words are still on screen.
    await expect(page.getByText("Greeting first is right.").first()).toBeVisible();
    await expect(page.getByTestId("composer-input")).toBeEnabled();
  });

  test("a turn that fails outright leaves no partial reply behind", async ({ page }) => {
    const id = "session-failover-3";
    await mockSession(page, id, { ui: choiceUi });
    await page.route(`**/api/sessions/${id}/turns`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Try again shortly." } }),
      });
    });

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("hello");
    await page.getByTestId("composer-send-btn").click();

    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByTestId("composer-input")).toBeEnabled();
  });
});
