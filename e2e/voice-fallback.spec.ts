import { expect } from "@playwright/test";
import { choiceUi, learner, mockSession, mockTurns, test, tutorTurn } from "./helpers/session-mock";

/**
 * The session has to keep working when the network or the device takes voice away.
 * These are the two failures a bank panel actually hits: a proxy that blocks the STT
 * WebSocket, and a laptop with no Urdu system voice.
 */
test.describe("Voice fallback @voice-fallback", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("with the STT socket blocked, the session still takes text and taps", async ({ page }) => {
    const id = "session-voice-fallback-1";
    await mockSession(page, id, { ui: choiceUi });

    // The proxy case: every WebSocket to the provider fails to open.
    await page.addInitScript(() => {
      const RealWebSocket = window.WebSocket;
      class BlockedWebSocket extends EventTarget {
        onopen: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onclose: ((e: unknown) => void) | null = null;
        onmessage: ((e: unknown) => void) | null = null;
        readyState = 3;
        constructor(url: string) {
          super();
          if (String(url).includes("soniox")) {
            setTimeout(() => this.onerror?.(new Event("error")), 0);
          } else {
            return new RealWebSocket(url) as unknown as BlockedWebSocket;
          }
        }
        send() {}
        close() {}
      }
      Object.defineProperty(window, "WebSocket", { value: BlockedWebSocket, writable: true });
    });

    const bodies = await mockTurns(page, id, () =>
      tutorTurn("Good. Greeting first is the right move."),
    );

    await page.goto(`/learn/sessions/${id}`);
    await expect(page.getByTestId("composer-input")).toBeVisible();

    // Typing still works, which is the criterion that matters.
    await page.getByTestId("composer-input").fill("Greet him and offer a seat");
    await page.getByTestId("composer-send-btn").click();
    await expect(page.getByText("Greeting first is the right move.").first()).toBeVisible();
    expect(bodies.length).toBeGreaterThan(0);

    // And the tap mechanic is still reachable.
    await expect(page.getByRole("button", { name: /Greet him and offer a seat/ })).toBeVisible();
  });

  test("with no Urdu system voice, Urdu audio falls back to captions with a notice", async ({
    page,
  }) => {
    const id = "session-voice-fallback-2";
    await mockSession(page, id, { ui: choiceUi, language: "ur" });

    // The common laptop case: English voices installed, no Urdu one.
    await page.addInitScript(() => {
      Object.defineProperty(window.speechSynthesis, "getVoices", {
        value: () => [{ lang: "en-US", name: "English" }],
        writable: true,
      });
    });

    // The server says it cannot synthesize this sentence.
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
    await page.route("**/api/voice/tts-key", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await mockTurns(page, id, () =>
      tutorTurn("Bohat khoob.", [
        {
          type: "speech.item",
          index: 0,
          text: "Bohat khoob.",
          lang: "ur",
          sig: "f".repeat(64),
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      ]),
    );

    await page.goto(`/learn/sessions/${id}`);
    await page.getByTestId("composer-input").fill("salam");
    await page.getByTestId("composer-send-btn").click();

    // The caption is the fallback, so the text must still be on screen.
    await expect(page.getByText("Bohat khoob.").first()).toBeVisible();
    // And the learner is told why there is no audio.
    await expect(page.getByTestId("composer-speech-notice")).toContainText(/Urdu|captions/i);
  });
});
