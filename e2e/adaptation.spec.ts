import { expect } from "@playwright/test";
import { choiceUi, learner, mockSession, mockTurns, test, tutorTurn } from "./helpers/session-mock";

// Live session controls: the toolbar posts to /controls, the transcript and the
// Inspector show the panel reason, and the next tutor turn renders in the new language.
test.describe("Adaptation @adaptation", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("switching persona and language posts controls, shows the reason, and the next turn follows", async ({
    page,
  }) => {
    const id = "session-adapt-1";
    await mockSession(page, id, { ui: choiceUi });
    const posted: Record<string, string>[] = [];
    await page.route(`**/api/sessions/${id}/controls`, async (route) => {
      const body = route.request().postDataJSON() as Record<string, string>;
      posted.push(body);
      const applied = body.persona
        ? [
            {
              kind: "persona",
              to: body.persona,
              reason:
                "Panel switched persona to Senior manager: expert level, short turns, formal register, difficulty 4.",
            },
          ]
        : [
            {
              kind: "language",
              to: body.language,
              reason: "Panel switched language to Roman Urdu; the next sentence renders in it.",
            },
          ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          applied,
          language: body.language ?? "en",
          personaId: body.persona ?? "branch_new_joiner",
        }),
      });
    });
    const bodies = await mockTurns(page, id, () =>
      tutorTurn("Theek hai. Customer ko tees second ke andar salam karein.", [
        {
          type: "inspector",
          delta: {
            turnId: "t-mock",
            verdict: null,
            move: {
              id: "mv_restyle",
              type: "restyle",
              ruleId: "R03",
              reason:
                "Switch requested (persona to senior_manager). Rule R03: acknowledge it and continue in the new style.",
            },
            question: "q1",
            attempts: 0,
            hintLevel: 0,
            completed: 0,
            total: 3,
            configVersion: 3,
            configHash: "abcdef0123456789",
            tier: "fast",
            protocolOk: true,
            switches: [
              {
                kind: "persona",
                to: "senior_manager",
                reason:
                  "Panel switched persona to Senior manager: expert level, short turns, formal register, difficulty 4.",
              },
              {
                kind: "language",
                to: "ur-Latn",
                reason: "Panel switched language to Roman Urdu; the next sentence renders in it.",
              },
            ],
          },
        },
      ]),
    );
    await page.goto(`/learn/sessions/${id}`);

    await page.getByTestId("toolbar-persona-select").selectOption("senior_manager");
    await expect(page.getByText("Panel switched persona to Senior manager")).toBeVisible();
    await page.getByTestId("lang-btn-ur-Latn").click();
    await expect(page.getByText("Panel switched language to Roman Urdu")).toBeVisible();
    expect(posted).toEqual([{ persona: "senior_manager" }, { language: "ur-Latn" }]);

    // The next turn renders in Roman Urdu and the Inspector explains the switch.
    await page.getByTestId("composer-input").fill("theek hai");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("turn-tutor").last()).toContainText("tees second ke andar");
    expect(bodies[0]?.input).toMatchObject({ mode: "text", text: "theek hai" });
    await page.getByTestId("toggle-inspector-btn").click();
    await expect(page.getByTestId("inspector-turn")).toContainText("R03");
    await expect(page.getByTestId("inspector-switch").first()).toContainText("Senior manager");
    await expect(page.getByTestId("inspector-panel")).toContainText("Switched language");
  });
});
