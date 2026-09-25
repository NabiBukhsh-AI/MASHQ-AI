import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown, sanitizeInput } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  describe("sanitizeInput (security stripping)", () => {
    it("strips raw HTML script, iframe, and image tags", () => {
      const input = '<script>alert("xss")</script><img src="x" onerror="alert(1)"/><b>Hello</b>';
      const sanitized = sanitizeInput(input);
      expect(sanitized).not.toContain("<script>");
      expect(sanitized).not.toContain("</script>");
      expect(sanitized).not.toContain("<img");
      expect(sanitized).not.toContain("<b>");
      expect(sanitized).toContain('alert("xss")');
      expect(sanitized).toContain("Hello");
    });

    it("strips markdown images, keeping only the alt text", () => {
      const input =
        "Here is a chart: ![Account Diagram](https://example.com/chart.png) explaining rules.";
      const sanitized = sanitizeInput(input);
      expect(sanitized).not.toContain("https://example.com/chart.png");
      expect(sanitized).not.toContain("![");
      expect(sanitized).toBe("Here is a chart: Account Diagram explaining rules.");
    });

    it("strips markdown links, leaving only the anchor label text without links", () => {
      const input = "Please review [State Bank Policy](https://sbp.org.pk/rules) immediately.";
      const sanitized = sanitizeInput(input);
      expect(sanitized).not.toContain("https://sbp.org.pk/rules");
      expect(sanitized).not.toContain("[");
      expect(sanitized).not.toContain("]");
      expect(sanitized).toBe("Please review State Bank Policy immediately.");
    });
  });

  describe("rendering", () => {
    it("never renders raw HTML anchor or image elements", () => {
      const input =
        'Check out <a href="http://evil.com">link</a> and ![pic](http://evil.com/img.png)';
      const html = renderToStaticMarkup(<SafeMarkdown text={input} />);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("<img");
      expect(html).toContain("Check out link and pic");
    });

    it("renders bold text using strong elements", () => {
      const input = "You must **verify CNIC** before proceeding.";
      const html = renderToStaticMarkup(<SafeMarkdown text={input} />);
      expect(html).toContain("<strong>verify CNIC</strong>");
    });

    it("renders italic text using em elements", () => {
      const input = "This is a *discretionary* exception.";
      const html = renderToStaticMarkup(<SafeMarkdown text={input} />);
      expect(html).toContain("<em>discretionary</em>");
    });

    it("renders combined bold and italic formatting", () => {
      const input = "This action is ***strictly prohibited*** by policy.";
      const html = renderToStaticMarkup(<SafeMarkdown text={input} />);
      expect(html).toContain("<strong><em>strictly prohibited</em></strong>");
    });

    it("renders unordered lists with ul and li elements", () => {
      const input = "- Verify identity document\n- Check biometric log\n- Update phone number";
      const html = renderToStaticMarkup(<SafeMarkdown text={input} />);
      expect(html).toContain("<ul");
      expect(html).toContain("<li>Verify identity document</li>");
      expect(html).toContain("<li>Check biometric log</li>");
      expect(html).toContain("<li>Update phone number</li>");
    });

    it("renders ordered lists with ol and li elements", () => {
      const input = "1. Ask for original document\n2. Inspect expiry date\n3. Record serial number";
      const html = renderToStaticMarkup(<SafeMarkdown text={input} />);
      expect(html).toContain("<ol");
      expect(html).toContain("<li>Ask for original document</li>");
      expect(html).toContain("<li>Inspect expiry date</li>");
      expect(html).toContain("<li>Record serial number</li>");
    });

    it("renders blockquotes with blockquote elements", () => {
      const input = "> Banking Companies Ordinance Section 25A";
      const html = renderToStaticMarkup(<SafeMarkdown text={input} />);
      expect(html).toContain("<blockquote");
      expect(html).toContain("Banking Companies Ordinance Section 25A");
    });

    it("handles empty or whitespace-only input safely", () => {
      const html = renderToStaticMarkup(<SafeMarkdown text="" />);
      expect(html).toBe("<div></div>");
    });
  });
});
