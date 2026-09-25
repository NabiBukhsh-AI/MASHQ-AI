import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  choiceUi,
  test,
  learner,
  matchUi,
  mockSession,
  mockTurns,
  sequenceUi,
  spotErrorUi,
  teachBackUi,
  tutorTurn,
} from "./helpers/session-mock";

const inspectorDelta = (verdict: string) => ({
  type: "inspector",
  delta: {
    turnId: "t-mock",
    verdict: {
      verdict,
      score: verdict === "correct" ? 1 : 0,
      misconception: null,
      helpRequest: false,
    },
    move: {
      id: "mv_correct",
      type: "feedback_correct",
      ruleId: "R99",
      reason: "Correct on q1 first try.",
    },
    question: "q1",
    attempts: 0,
    hintLevel: 0,
    completed: 1,
    total: 3,
    configVersion: 3,
    configHash: "abcdef0123456789",
    tier: "fast",
    protocolOk: true,
  },
});

test.describe("Mechanics @mechanics", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("choice rows: a mouse pick sends a tap turn and the tutor reply appears", async ({
    page,
  }) => {
    const id = "session-mech-choice";
    await mockSession(page, id, { ui: choiceUi });
    const bodies = await mockTurns(page, id, (b) =>
      tutorTurn(
        b.input.answer === "a"
          ? "Yes. A greeting sets the tone."
          : "Not quite. Think about the first minute.",
        [inspectorDelta(b.input.answer === "a" ? "correct" : "incorrect")],
      ),
    );
    await page.goto(`/learn/sessions/${id}`);

    const mechanic = page.getByTestId("mechanic-choice");
    await expect(mechanic).toBeVisible();
    await expect(mechanic.getByRole("button")).toHaveCount(3);

    await page.getByTestId("choice-a").click();
    await expect(page.getByTestId("turn-learner")).toContainText("Greet him and offer a seat");
    await expect(page.getByTestId("turn-tutor").last()).toContainText("A greeting sets the tone.");
    expect(bodies[0]?.input).toEqual({ mode: "tap", answer: "a" });

    // The Inspector shows the rule and the reason, and a tier rather than a model id.
    await page.getByTestId("toggle-inspector-btn").click();
    await expect(page.getByTestId("inspector-turn")).toContainText("R99");
    await expect(page.getByTestId("inspector-panel")).toContainText("Fast tier");
    await expect(page.getByTestId("inspector-panel")).not.toContainText("claude");
  });

  test("choice rows: keyboard only", async ({ page }) => {
    const id = "session-mech-kbd";
    await mockSession(page, id, { ui: choiceUi });
    const bodies = await mockTurns(page, id, () => tutorTurn("Noted."));
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("choice-a").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("choice-b")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("turn-tutor").last()).toContainText("Noted.");
    expect(bodies[0]?.input).toEqual({ mode: "tap", answer: "b" });
  });

  test("sequence list: move buttons reorder, submit sends a drag turn with the order", async ({
    page,
  }) => {
    const id = "session-mech-seq";
    await mockSession(page, id, { ui: sequenceUi });
    const bodies = await mockTurns(page, id, () => tutorTurn("Good order."));
    await page.goto(`/learn/sessions/${id}`);

    await expect(page.getByTestId("mechanic-sequence")).toBeVisible();
    await page.getByRole("button", { name: 'Move "Greet within thirty seconds" up' }).click();
    await page.getByRole("button", { name: 'Move "Confirm what you heard" down' }).click();
    await page.getByRole("button", { name: 'Move "Confirm what you heard" down' }).click();
    await page.getByTestId("sequence-submit").click();
    await expect(page.getByTestId("turn-tutor").last()).toContainText("Good order.");
    expect(bodies[0]?.input).toEqual({
      mode: "drag",
      answer: ["s_greet", "s_listen", "s_cnic", "s_confirm"],
    });
  });

  test("sequence list: keyboard keeps focus on the move button at the edge", async ({ page }) => {
    const id = "session-mech-seq-kbd";
    await mockSession(page, id, { ui: sequenceUi });
    await page.goto(`/learn/sessions/${id}`);
    const up = page.getByRole("button", { name: 'Move "Greet within thirty seconds" up' });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(up).toBeFocused();
    await expect(page.getByTestId("mechanic-sequence").locator("li").first()).toContainText(
      "Greet within thirty seconds",
    );
  });

  test("match pairs: native selects, submit sends a left to right map", async ({ page }) => {
    const id = "session-mech-match";
    await mockSession(page, id, { ui: matchUi });
    const bodies = await mockTurns(page, id, () => tutorTurn("All matched."));
    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("match-submit")).toBeDisabled();
    await page.getByLabel("CNIC").selectOption("National identity card");
    await page.getByLabel("IBAN").selectOption("Bank account number");
    await page.getByTestId("match-submit").click();
    await expect(page.getByTestId("turn-tutor").last()).toContainText("All matched.");
    expect(bodies[0]?.input).toEqual({
      mode: "tap",
      answer: { CNIC: "National identity card", IBAN: "Bank account number" },
    });
  });

  test("spot the error: keyboard pick of a sentence sends its id; consequence card shows", async ({
    page,
  }) => {
    const id = "session-mech-spot";
    await mockSession(page, id, { ui: spotErrorUi });
    const bodies = await mockTurns(page, id, () => [
      {
        type: "verdict",
        data: {
          verdict: "correct",
          score: 1,
          consequence: "The customer's identity is checked properly.",
        },
      },
      ...tutorTurn("Yes, a photocopy is never enough."),
    ]);
    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("sentence-t1").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("turn-tutor").last()).toContainText("never enough");
    await expect(page.getByTestId("consequence")).toContainText("checked properly");
    expect(bodies[0]?.input).toEqual({ mode: "tap", answer: "t2" });
  });

  test("teach back: framing card, the composer sends the text", async ({ page }) => {
    const id = "session-mech-tb";
    await mockSession(page, id, { ui: teachBackUi });
    const bodies = await mockTurns(page, id, () => tutorTurn("Clear explanation."));
    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("mechanic-open")).toContainText("Teach it back");
    await page.getByTestId("composer-input").fill("Greet, listen, confirm, then ask for the CNIC.");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("turn-tutor").last()).toContainText("Clear explanation.");
    expect(bodies[0]?.input.mode).toBe("text");
  });

  test("Urdu: choice rows render right to left with Urdu labels", async ({ page }) => {
    const id = "session-mech-ur";
    await mockSession(page, id, { ui: choiceUi, language: "ur" });
    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("mechanic-choice")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("choice-a")).toContainText("سلام");
  });

  test("axe: every mechanic screen has no serious or critical violations", async ({ page }) => {
    for (const [id, ui] of [
      ["session-axe-choice", choiceUi],
      ["session-axe-seq", sequenceUi],
      ["session-axe-match", matchUi],
      ["session-axe-spot", spotErrorUi],
      ["session-axe-tb", teachBackUi],
    ] as const) {
      await mockSession(page, id, { ui });
      await page.goto(`/learn/sessions/${id}`);
      await expect(page.getByTestId("mechanic")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      );
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    }
  });
});
