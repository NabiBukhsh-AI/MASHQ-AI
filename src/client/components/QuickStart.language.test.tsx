import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickStart, CONTENT_LANGUAGE_OPTIONS, LANGUAGE_OPTIONS } from "./QuickStart";
import { CapabilitiesProvider } from "@/client/session/Capabilities";

/**
 * The material's language sets the practice language, and the practice language is what routes
 * speech to a voice that can say it. These pin the choices offered and that Auto is the default.
 */
describe("material language at upload", () => {
  it("offers Auto, English, Urdu and Roman Urdu, with Auto first", () => {
    expect(CONTENT_LANGUAGE_OPTIONS.map((o) => o.id)).toEqual(["auto", "en", "ur", "ur-Latn"]);
  });

  it("offers only languages the practice language can become", () => {
    // Anything but Auto is copied straight into the practice language, so it has to be one.
    const practice = new Set(LANGUAGE_OPTIONS.map((o) => o.id));
    for (const o of CONTENT_LANGUAGE_OPTIONS.filter((o) => o.id !== "auto")) {
      expect(practice.has(o.id), `${o.id} is not a practice language`).toBe(true);
    }
  });

  it("shows the selector, defaulting to Auto, to someone who can add content", () => {
    const html = renderToStaticMarkup(
      <CapabilitiesProvider value={{ role: "ld_manager", canUpload: true }}>
        <QuickStart />
      </CapabilitiesProvider>,
    );
    expect(html).toContain('data-testid="content-language-select"');
    expect(html).toMatch(/<option value="auto" selected="">/);
  });

  it("does not show it to someone who cannot upload", () => {
    const html = renderToStaticMarkup(
      <CapabilitiesProvider value={{ role: "learner", canUpload: false }}>
        <QuickStart />
      </CapabilitiesProvider>,
    );
    expect(html).not.toContain('data-testid="content-language-select"');
  });
});
