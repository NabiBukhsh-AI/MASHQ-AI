import { expect } from "@playwright/test";
import {
  choiceUi,
  test,
  learner,
  mockSession,
  mockTurns,
  sse,
  tutorTurn,
} from "./helpers/session-mock";

test.describe("Text turn @text-turn", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("a fresh session opens the mission, then a typed answer streams a reply", async ({
    page,
  }) => {
    const id = "session-turn-fresh";
    await mockSession(page, id, {
      progress: { started: false, finished: false, completed: 0, total: 3 },
    });
    const bodies = await mockTurns(page, id, (b) =>
      b.input.mode === "start"
        ? tutorTurn("Welcome to the counter. Mr. Rasheed has arrived. What do you do first?", [
            { type: "ui", payload: choiceUi },
          ])
        : tutorTurn("Good thinking. Greeting first sets the tone.", [
            { type: "facts", ids: ["f_greet"] },
          ]),
    );
    await page.goto(`/learn/sessions/${id}`);

    // The start turn ran with no learner input and the mechanic appeared.
    await expect(page.getByTestId("turn-tutor").first()).toContainText("Mr. Rasheed has arrived.");
    await expect(page.getByTestId("mechanic-choice")).toBeVisible();
    expect(bodies[0]?.input.mode).toBe("start");

    await page.getByTestId("composer-input").fill("I would greet him first");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("turn-learner")).toContainText("I would greet him first");
    await expect(page.getByTestId("turn-tutor").last()).toContainText(
      "Greeting first sets the tone.",
    );
    expect(bodies[1]?.input).toMatchObject({ mode: "text", text: "I would greet him first" });
  });

  test("a retract shows a system notice and no partial tutor bubble", async ({ page }) => {
    const id = "session-turn-retract";
    await mockSession(page, id, { ui: choiceUi });
    await page.route(`**/api/sessions/${id}/turns`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([
          { type: "turn.start", turnId: "t-bad" },
          { type: "display.delta", text: "Let me think about" },
          { type: "retract", turnId: "t-bad", reason: "stream_error" },
          {
            type: "error",
            code: "TUTOR_UNAVAILABLE",
            message: "The tutor did not answer this time. Try again.",
          },
          { type: "end" },
        ]),
      }),
    );
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("hello");
    await page.keyboard.press("Enter");
    await expect(page.getByText("The tutor did not answer this time. Try again.")).toBeVisible();
    await expect(page.getByTestId("turn-tutor")).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toBeEnabled();
  });

  test("Stop aborts the reply: no partial bubble, learner bubble withdrawn, one notice", async ({
    page,
  }) => {
    const id = "session-turn-stop";
    await mockSession(page, id, { ui: choiceUi });
    await page.route(`**/api/sessions/${id}/turns`, async (route) => {
      // A reply that starts, then hangs: the learner presses Stop before it finishes.
      await new Promise((r) => setTimeout(r, 200));
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([
          { type: "turn.start", turnId: "t-slow" },
          { type: "display.delta", text: "Let me think about that for a" },
        ]),
      });
    });
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("hello there");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("composer-stop-btn")).toBeVisible();
    await page.getByTestId("composer-stop-btn").click();
    await expect(page.getByText("You stopped the tutor's reply.")).toBeVisible();
    await expect(page.getByTestId("turn-tutor")).toHaveCount(0);
    await expect(page.getByTestId("turn-learner")).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toBeEnabled();
  });

  test("a 409 while a turn is in flight is explained, not swallowed", async ({ page }) => {
    const id = "session-turn-409";
    await mockSession(page, id, { ui: choiceUi });
    await page.route(`**/api/sessions/${id}/turns`, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Turn in progress for this session." }),
      }),
    );
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("hello");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Turn in progress for this session.")).toBeVisible();
  });
});
