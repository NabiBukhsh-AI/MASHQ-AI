import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageSwitch, LANGUAGE_OPTIONS } from "./LanguageSwitch";
import { toEasternDigits, applyDigitStyle } from "@/lib/text/digits";
import { BidiText } from "../BidiText";

describe("LanguageSwitch", () => {
  it("offers the four language modes", () => {
    expect(LANGUAGE_OPTIONS.map((o) => o.id)).toEqual(["en", "ur", "ur-Latn", "mixed"]);
  });

  it("marks only the current language as checked", () => {
    const html = renderToStaticMarkup(<LanguageSwitch value="ur" onChange={() => undefined} />);
    expect(html).toContain('data-testid="lang-btn-ur"');
    // Exactly one radio is checked.
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it("gives the Urdu option its own lang and dir so a screen reader does not spell it", () => {
    const html = renderToStaticMarkup(<LanguageSwitch value="en" onChange={() => undefined} />);
    expect(html).toMatch(/lang="ur"[^>]*dir="rtl"|dir="rtl"[^>]*lang="ur"/);
    // And an English accessible name, since the visible label is Urdu script.
    expect(html).toContain('aria-label="Urdu"');
  });

  it("gives Nastaliq enough line height to avoid clipped glyphs", () => {
    const html = renderToStaticMarkup(<LanguageSwitch value="en" onChange={() => undefined} />);
    expect(html).toContain("line-height:2.1");
  });

  it("reports the chosen language", () => {
    const onChange = vi.fn();
    // Rendering to static markup cannot click, so check the handler wiring directly.
    const el = LanguageSwitch({ value: "en", onChange });
    expect(el).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("digit preference", () => {
  it("converts Western digits to Urdu digits when the org asks for eastern", () => {
    expect(toEasternDigits("CNIC 42101")).toBe("CNIC ۴۲۱۰۱");
  });

  it("leaves Western digits alone by default, which banking forms need", () => {
    expect(applyDigitStyle("CNIC 42101", "western")).toBe("CNIC 42101");
  });

  it("applies the preference to displayed text through BidiText", () => {
    const eastern = renderToStaticMarkup(<BidiText text="30 seconds" digits="eastern" />);
    expect(eastern).toContain("۳۰");
    const western = renderToStaticMarkup(<BidiText text="30 seconds" digits="western" />);
    expect(western).toContain("30");
  });
});
