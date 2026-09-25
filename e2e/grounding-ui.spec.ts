import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, learner, mockSession, mockTurns, tutorTurn } from "./helpers/session-mock";

test.describe("Grounding UI @grounding-ui", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("fact chip opens source drawer with highlighted quote and anchor", async ({ page }) => {
    const id = "session-grounding-fact";
    const contentId = "content-demo-1";
    const chunkId = "chunk-demo-1";
    const quote = "Visitors must be acknowledged within 60 seconds.";
    const chunkText =
      "Branch Customer Care Guidelines: Visitors must be acknowledged within 60 seconds. A warm greeting establishes professional rapport.";

    // Mock session state with facts and contentId
    await mockSession(page, id, {
      contentId,
      facts: [
        {
          id: "f_ack_60s",
          statement: "Acknowledge every visitor within 60 seconds of arrival.",
          anchors: [
            {
              chunkId,
              quote,
            },
          ],
        },
      ],
    });

    // Mock chunk route
    await page.route(`**/api/content/${contentId}/chunks/${chunkId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chunk: {
            id: chunkId,
            contentId,
            ordinal: 0,
            anchorKind: "section",
            anchorRef: "Section 2.1 Greeting Standards",
            text: chunkText,
          },
        }),
      });
    });

    // Mock turns with a tutor reply that cites fact f_ack_60s
    await mockTurns(page, id, () =>
      tutorTurn("Welcome! Acknowledge visitors quickly.", [{ type: "facts", ids: ["f_ack_60s"] }]),
    );

    await page.goto(`/learn/sessions/${id}`);

    // Send a question to trigger tutor reply
    await page.getByTestId("composer-input").fill("What is the greeting time?");
    await page.keyboard.press("Enter");

    // The tutor bubble should show the fact chip
    const chip = page.getByTestId("fact-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("f_ack_60s");

    // Click the fact chip to open the source drawer
    await chip.click();

    // The drawer should open and display the verified source
    const drawer = page.getByTestId("source-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Verified Source");
    await expect(drawer).toContainText("section: Section 2.1 Greeting Standards");
    await expect(drawer).toContainText("Acknowledge every visitor within 60 seconds of arrival.");

    // Highlighted quote
    const highlight = page.getByTestId("highlighted-quote");
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveText(quote);

    // Close the drawer using Escape
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
  });

  test("assisted out-of-source response shows the general knowledge badge", async ({ page }) => {
    const id = "session-grounding-assisted";
    await mockSession(page, id);

    // The engine decides the move and reports it on the inspector delta. The badge used to be
    // driven by the model's own @@m line, so a reply that omitted the tag rendered its general
    // knowledge paragraph unlabelled.
    await mockTurns(page, id, () =>
      tutorTurn(
        "Commercial banks typically set lending rates based on KIBOR. Please check current rate sheets for exact numbers.",
        [
          { type: "move", id: "mv_oos_assisted" },
          { type: "inspector", delta: { turnId: "t-mock", move: { type: "out_of_source" } } },
        ],
      ),
    );

    await page.goto(`/learn/sessions/${id}`);

    await page.getByTestId("composer-input").fill("What is the current home loan interest rate?");
    await page.keyboard.press("Enter");

    // The badge should appear above the tutor reply
    const badge = page.getByTestId("turn-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("General knowledge, not from your material");
  });

  test("strict out-of-source response has no general knowledge badge", async ({ page }) => {
    const id = "session-grounding-strict";
    await mockSession(page, id);

    await mockTurns(page, id, () =>
      tutorTurn("Your material does not cover that. Would you like to continue with the mission?", [
        { type: "move", id: "mv_oos_strict" },
        { type: "inspector", delta: { turnId: "t-mock", move: { type: "refuse_out_of_source" } } },
      ]),
    );

    await page.goto(`/learn/sessions/${id}`);

    await page.getByTestId("composer-input").fill("Tell me about interest rates.");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("turn-tutor").last()).toContainText(
      "Your material does not cover that.",
    );
    await expect(page.getByTestId("turn-badge")).not.toBeVisible();
  });

  test("axe: source drawer and fact chips have no serious accessibility violations", async ({
    page,
  }) => {
    const id = "session-grounding-a11y";
    await mockSession(page, id, {
      facts: [
        {
          id: "f_1",
          statement: "Greet customers within 60 seconds.",
          anchors: [{ chunkId: "c_1", quote: "60 seconds" }],
        },
      ],
    });

    await mockTurns(page, id, () =>
      tutorTurn("Acknowledge visitors promptly.", [{ type: "facts", ids: ["f_1"] }]),
    );

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("Hello");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("fact-chip")).toBeVisible();
    await page.getByTestId("fact-chip").click();
    await expect(page.getByTestId("source-drawer")).toBeVisible();

    const results = await new AxeBuilder({ page }).exclude(".axe-ignore").analyze();

    const serious = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });

  test("a reply that omits the move tag is still labelled @grounding-ui", async ({ page }) => {
    const id = "session-grounding-no-tag";
    await mockSession(page, id);

    // No @@m line at all. The engine still decided out_of_source, so the label still belongs.
    await mockTurns(page, id, () =>
      tutorTurn("Banks generally price loans off KIBOR.", [
        { type: "inspector", delta: { turnId: "t-mock", move: { type: "out_of_source" } } },
      ]),
    );

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("How is a loan priced?");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("turn-badge")).toHaveText(
      "General knowledge, not from your material",
    );
  });

  test("assisted mode marks a figure the material does not carry @grounding-ui", async ({
    page,
  }) => {
    const id = "session-grounding-unverified";
    await mockSession(page, id);

    // Assisted mode shows the sentence as written, so the learner has to be
    // told which numbers are not from their material. The engine used to discard this.
    await mockTurns(page, id, () =>
      tutorTurn("The rate is usually around 18.5%.", [], "t-mock", {
        unverified: ["18.5%"],
      }),
    );

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("What rate should I quote?");
    await page.keyboard.press("Enter");

    const mark = page.getByTestId("turn-unverified");
    await expect(mark).toBeVisible();
    await expect(mark).toContainText("18.5%");
    await expect(mark).toContainText("Not checked against your material");
  });
});
