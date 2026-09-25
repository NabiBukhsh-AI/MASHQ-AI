import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BidiText, isolateBidi } from "./BidiText";

describe("BidiText", () => {
  describe("isolateBidi helper", () => {
    it("isolates English/Latin banking terms inside Urdu text with bdi dir=ltr tags", () => {
      const urduText = "براہ کرم کسٹمر کا اصل CNIC چیک کریں۔";
      const nodes = isolateBidi(urduText, true);
      const html = renderToStaticMarkup(<span>{nodes}</span>);

      expect(html).toContain('<bdi dir="ltr" class="inline">CNIC</bdi>');
      expect(html).toContain("براہ کرم کسٹمر کا اصل");
      expect(html).toContain("چیک کریں۔");
    });

    it("isolates phone numbers, IBANs and numeric sequences inside Urdu text", () => {
      const urduText = "اکاؤنٹ نمبر PK36SCBL0000001123456702 پر منتقل کریں۔";
      const nodes = isolateBidi(urduText, true);
      const html = renderToStaticMarkup(<span>{nodes}</span>);

      expect(html).toContain('<bdi dir="ltr" class="inline">PK36SCBL0000001123456702</bdi>');
    });

    it("isolates embedded Urdu phrases inside English text with bdi dir=rtl tags", () => {
      const englishText = "The customer requested a نئی چیک بک at the counter.";
      const nodes = isolateBidi(englishText, false);
      const html = renderToStaticMarkup(<span>{nodes}</span>);

      expect(html).toContain(
        '<bdi dir="rtl" lang="ur" class="font-urdu leading-[2.2]">نئی چیک بک</bdi>',
      );
      expect(html).toContain("The customer requested a");
    });
  });

  describe("component rendering", () => {
    it("renders with dir=rtl, lang=ur and font-urdu styling for Urdu content", () => {
      const html = renderToStaticMarkup(<BidiText lang="ur" text="صارف کا فون نمبر تبدیل کریں۔" />);

      expect(html).toContain('lang="ur"');
      expect(html).toContain('dir="rtl"');
      expect(html).toContain("font-urdu");
      expect(html).toContain("leading-[2.2]");
      expect(html).toContain("صارف کا فون نمبر تبدیل کریں۔");
    });

    it("automatically detects Arabic script and infers dir=rtl and lang=ur", () => {
      const html = renderToStaticMarkup(
        <BidiText text="خوش آمدید، بینکنگ سسٹم میں لاگ ان کریں۔" />,
      );

      expect(html).toContain('lang="ur"');
      expect(html).toContain('dir="rtl"');
      expect(html).toContain("font-urdu");
    });

    it("renders with dir=ltr, lang=en and font-sans for English content", () => {
      const html = renderToStaticMarkup(
        <BidiText lang="en" text="Welcome to the Mashq practice simulator." />,
      );

      expect(html).toContain('lang="en"');
      expect(html).toContain('dir="ltr"');
      expect(html).toContain("font-sans");
      expect(html).toContain("Welcome to the Mashq practice simulator.");
    });

    it("supports rendering as paragraph or div element", () => {
      const htmlP = renderToStaticMarkup(<BidiText as="p" text="Paragraph text" />);
      expect(htmlP.startsWith("<p")).toBe(true);

      const htmlDiv = renderToStaticMarkup(<BidiText as="div" text="Div text" />);
      expect(htmlDiv.startsWith("<div")).toBe(true);
    });

    it("renders children when text prop is not provided", () => {
      const html = renderToStaticMarkup(
        <BidiText lang="en">
          <span>Custom Child Node</span>
        </BidiText>,
      );

      expect(html).toContain("<span>Custom Child Node</span>");
    });
  });
});
