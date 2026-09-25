import { expect, chromium, type Browser, type Page } from "@playwright/test";
import { choiceUi, learner, mockSession, mockTurns, test, tutorTurn } from "./helpers/session-mock";

/**
 * The browser leg of the voice path, which unit tests cannot reach.
 *
 * Chromium's fake device flags give a real getUserMedia stream with no hardware, so the
 * microphone permission, the talk button lifecycle and the audio element are exercised for
 * real. The speech provider itself is stubbed: this is about our code, not about whether
 * Soniox recognised a synthetic tone.
 */
test.describe("Voice with a fake microphone @voice-fake-mic", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  let browser: Browser;

  test.beforeAll(async () => {
    browser = await chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  async function micPage(storageState: string | undefined): Promise<Page> {
    const context = await browser.newContext({
      storageState,
      permissions: ["microphone"],
      baseURL: test.info().project.use.baseURL,
    });
    return context.newPage();
  }

  test("the talk button is offered when a microphone exists", async ({ page: base }) => {
    const state = await base.context().storageState();
    const page = await micPage({ ...state } as unknown as string);

    const id = "session-mic-1";
    await mockSession(page, id, { ui: choiceUi });
    await mockTurns(page, id, () => tutorTurn("Good."));
    await page.route("**/api/voice/stt-key", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          apiKey: "fake-key",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          config: { model: "stt-rt-v5", languageHints: ["ur", "en"], context: { terms: [] } },
        }),
      });
    });

    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("composer-input")).toBeVisible();

    // With a working microphone the talk button is present rather than hidden.
    await expect(page.getByRole("button", { name: /talk|speak|hold/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.context().close();
  });

  test("a real getUserMedia stream is available to the page", async ({ page: base }) => {
    const state = await base.context().storageState();
    const page = await micPage({ ...state } as unknown as string);
    await page.goto("/learn");

    // If this fails, the fake device flags are not doing what the rest of the suite assumes.
    const tracks = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const count = stream.getAudioTracks().length;
      stream.getTracks().forEach((t) => t.stop());
      return count;
    });
    expect(tracks).toBeGreaterThan(0);
    await page.context().close();
  });

  test("the session keeps working when the microphone is refused", async ({ page: base }) => {
    const state = await base.context().storageState();
    const context = await browser.newContext({
      storageState: { ...state } as never,
      permissions: [],
      baseURL: test.info().project.use.baseURL,
    });
    const page = await context.newPage();

    const id = "session-mic-2";
    await mockSession(page, id, { ui: choiceUi });
    const bodies = await mockTurns(page, id, () => tutorTurn("Typed answers are fine."));

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("I will type instead");
    await page.getByTestId("composer-send-btn").click();

    await expect(page.getByText("Typed answers are fine.").first()).toBeVisible();
    expect(bodies.length).toBeGreaterThan(0);
    await context.close();
  });
});
