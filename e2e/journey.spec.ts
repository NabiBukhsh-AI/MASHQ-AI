import { expect } from "@playwright/test";
import { choiceUi, learner, mockSession, mockTurns, test, tutorTurn } from "./helpers/session-mock";

/**
 * The main path, end to end, as a new user would walk it. One spec that fails if the
 * journey a presenter is about to show has broken, rather than a suite of narrow assertions.
 */
test.describe("Learner journey @journey", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test.beforeEach(async () => {
    test.setTimeout(90_000);
  });

  test("a learner signs in, answers, gets feedback and reaches progress", async ({ page }) => {
    const id = "session-journey-1";
    await mockSession(page, id, { ui: choiceUi });
    const bodies = await mockTurns(page, id, (body) =>
      body.input?.text === "I need a hint"
        ? tutorTurn("Think about how quickly the first thirty seconds pass.")
        : tutorTurn("Exactly right, greet her within thirty seconds and tell her what is next."),
    );

    await page.goto("/learn");
    await expect(page).toHaveURL(/\/learn/);

    // The session screen, with a question and a way to answer it.
    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("composer-input")).toBeVisible();
    await expect(page.getByRole("button", { name: /Greet him and offer a seat/ })).toBeVisible();

    // Ask for a hint, then answer.
    await page.getByRole("button", { name: /hint/i }).first().click();
    await expect(page.getByText("first thirty seconds").first()).toBeVisible();

    await page.getByTestId("composer-input").fill("Greet her within thirty seconds");
    await page.getByTestId("composer-send-btn").click();
    await expect(page.getByText("Exactly right").first()).toBeVisible();

    expect(bodies.length).toBeGreaterThanOrEqual(2);

    // And the learner can see what that did to their progress.
    await page.route("**/api/progress", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          concepts: [
            {
              conceptId: "c1",
              conceptKey: "k1",
              conceptLabel: "Greeting within thirty seconds",
              p: 0.72,
              band: "proficient",
              lower: 0.61,
              upper: 0.83,
              nEvents: 6,
            },
          ],
          evidence: [],
          xp: { total: 40, level: 1, nextLevelXp: 100, progress: 0.4 },
          streak: { currentDays: 1, longestDays: 1, freezesLeft: 1 },
          badges: [],
          minutesThisWeek: 3,
          nextRecommendation: null,
        }),
      });
    });
    await page.goto("/learn/progress");
    await expect(page.getByTestId("mastery-table")).toContainText("estimated 0.72");
  });

  test("the language switch changes the conversation without losing the session", async ({
    page,
  }) => {
    const id = "session-journey-2";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Theek hai, chalein."));

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("lang-btn-ur-Latn").click();

    // Still on the same session, and still able to answer.
    await expect(page).toHaveURL(new RegExp(id));
    await page.getByTestId("composer-input").fill("theek hai");
    await page.getByTestId("composer-send-btn").click();
    await expect(page.getByText("Theek hai, chalein.").first()).toBeVisible();
  });
});
