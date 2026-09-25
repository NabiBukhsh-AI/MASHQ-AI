import { expect } from "@playwright/test";
import { choiceUi, learner, mockSession, mockTurns, test, tutorTurn } from "./helpers/session-mock";

/**
 * The four language modes have to render correctly at both widths. The failures this
 * guards against are silent ones: Urdu laid out left to right, Nastaliq glyphs clipped by a
 * tight line height, or a screen reader reading Urdu with an English voice.
 */
test.describe("Bilingual rendering @bilingual", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  const urduLine = "پہلے کسٹمر کو سلام کریں، پھر ان کی بات سنیں۔";

  test("Urdu conversation renders right to left with its own lang attribute", async ({ page }) => {
    const id = "session-bilingual-ur";
    await mockSession(page, id, { ui: choiceUi, language: "ur" });
    await mockTurns(page, id, () => tutorTurn(urduLine));

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("salam");
    await page.getByTestId("composer-send-btn").click();

    const urdu = page.locator("article").getByText(urduLine).first();
    await expect(urdu).toBeVisible();

    // The element, or an ancestor, must carry rtl or the sentence reads backwards.
    const dir = await urdu.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node) {
        if (node.getAttribute("dir")) return node.getAttribute("dir");
        node = node.parentElement;
      }
      return getComputedStyle(el as HTMLElement).direction;
    });
    expect(dir).toBe("rtl");

    // Nastaliq is clipped below a line-height of 2.1, so that is the floor.
    const ratio = await urdu.evaluate((el) => {
      const style = getComputedStyle(el as HTMLElement);
      return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
    });
    expect(ratio).toBeGreaterThanOrEqual(2.1);
  });

  test("the language switch exposes each option in its own language", async ({ page }) => {
    const id = "session-bilingual-switch";
    await mockSession(page, id, { ui: choiceUi });
    await page.goto(`/learn/sessions/${id}`);

    const urduOption = page.getByTestId("lang-btn-ur");
    await expect(urduOption).toBeVisible();
    // A screen reader needs an English name and the Urdu lang, or it spells the label out.
    await expect(urduOption).toHaveAttribute("lang", "ur");
    await expect(urduOption).toHaveAttribute("aria-label", "Urdu");
    await expect(page.getByTestId("lang-btn-ur-Latn")).toHaveAttribute("lang", "ur-Latn");
  });

  test("Roman Urdu stays left to right", async ({ page }) => {
    const id = "session-bilingual-roman";
    await mockSession(page, id, { ui: choiceUi, language: "ur-Latn" });
    await mockTurns(page, id, () => tutorTurn("Pehle customer ko salam karein."));

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("theek hai");
    await page.getByTestId("composer-send-btn").click();

    const line = page.locator("article").getByText("Pehle customer ko salam karein.").first();
    await expect(line).toBeVisible();
    const direction = await line.evaluate((el) => getComputedStyle(el as HTMLElement).direction);
    expect(direction).toBe("ltr");
  });

  test("renders at mobile width without horizontal overflow", async ({ page }) => {
    const id = "session-bilingual-mobile";
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSession(page, id, { ui: choiceUi, language: "ur" });
    await mockTurns(page, id, () => tutorTurn(urduLine));

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("salam");
    await page.getByTestId("composer-send-btn").click();
    await expect(page.locator("article").getByText(urduLine).first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
