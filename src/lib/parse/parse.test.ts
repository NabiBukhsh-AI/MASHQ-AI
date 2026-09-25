import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseFile, parsePdf, parseDocx, parsePptx, parseText } from "./index";

const fixturesDir = path.resolve(process.cwd(), "eval/fixtures/intake");

describe("Parsers", () => {
  describe("PDF Parser", () => {
    it("extracts text and page blocks from valid PDF", async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "tiny.pdf")));
      const doc = await parsePdf(bytes);

      expect(doc.sourceType).toBe("pdf");
      expect(doc.blocks.length).toBeGreaterThanOrEqual(1);
      expect(doc.blocks[0]?.kind).toBe("page");
      expect(doc.blocks[0]?.ref).toBe("1");
      expect(doc.blocks[0]?.text).toContain("Hello Mashq PDF Test");
      expect(doc.text).toContain("Hello Mashq PDF Test");
    });

    it("rejects encrypted or password-protected PDF with clear error message", async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "encrypted.pdf")));
      await expect(parsePdf(bytes)).rejects.toThrow(
        "This PDF is password protected. Remove the password or paste the text.",
      );
    });
  });

  describe("DOCX Parser", () => {
    it("extracts text and heading structure from valid DOCX", async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "sample.docx")));
      const doc = await parseDocx(bytes);

      expect(doc.sourceType).toBe("docx");
      expect(doc.text).toContain("Banking Guidelines");
      expect(doc.text).toContain("Compliance Check");
      expect(doc.blocks.length).toBeGreaterThanOrEqual(2);
      expect(doc.blocks[0]?.kind).toBe("section");
      expect(doc.blocks.some((b) => b.heading === "Banking Guidelines")).toBe(true);
    });
  });

  describe("PPTX Parser", () => {
    it("preserves slide ordering and extracts speaker notes from PPTX", async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "sample.pptx")));
      const doc = await parsePptx(bytes);

      expect(doc.sourceType).toBe("pptx");
      expect(doc.blocks.length).toBe(2);

      // Slide 1 checks
      const slide1 = doc.blocks[0];
      expect(slide1?.kind).toBe("slide");
      expect(slide1?.ref).toBe("1");
      expect(slide1?.heading).toBe("Customer Service Onboarding");
      expect(slide1?.text).toContain("Welcome to United Bank Limited.");
      expect(slide1?.notes).toContain("Speaker Note: Remind learners about polite Urdu greetings.");

      // Slide 2 checks
      const slide2 = doc.blocks[1];
      expect(slide2?.kind).toBe("slide");
      expect(slide2?.ref).toBe("2");
      expect(slide2?.heading).toBe("Step 2: Verification");
      expect(slide2?.text).toContain("Always check original CNIC");
    });
  });

  describe("Text & Markdown Parser", () => {
    it("parses text and markdown with headings", () => {
      const md = `# Section One
Here is intro text.

## Section Two
Here is follow up text.`;
      const bytes = new TextEncoder().encode(md);
      const doc = parseText(bytes, "text/markdown");

      expect(doc.sourceType).toBe("md");
      expect(doc.title).toBe("Section One");
      expect(doc.blocks.length).toBe(2);
      expect(doc.blocks[0]?.heading).toBe("Section One");
      expect(doc.blocks[1]?.heading).toBe("Section Two");
    });

    it("rejects text files containing NUL bytes", () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "nul-byte.txt")));
      expect(() => parseText(bytes, "text/plain")).toThrow(/binary data/);
    });
  });

  describe("parseFile delegator", () => {
    it("delegates to PDF parser based on extension or mimeType", async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "tiny.pdf")));
      const doc = await parseFile(bytes, "application/pdf", "test.pdf");
      expect(doc.sourceType).toBe("pdf");
    });

    it("delegates to DOCX parser based on mimeType", async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "sample.docx")));
      const doc = await parseFile(
        bytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "test.docx",
      );
      expect(doc.sourceType).toBe("docx");
    });

    it("delegates to PPTX parser based on extension", async () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "sample.pptx")));
      const doc = await parseFile(bytes, "application/octet-stream", "presentation.pptx");
      expect(doc.sourceType).toBe("pptx");
    });
  });
});

describe("parse limits", () => {
  it("rejects a PDF over maxPages before extracting text", async () => {
    const { parsePdf } = await import("./pdf");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve(process.cwd(), "eval/fixtures/intake/tiny.pdf")),
    );
    await expect(parsePdf(bytes, { maxPages: 0.5 })).rejects.toThrow(
      /has 1 pages; the limit is 0.5/,
    );
    await expect(parsePdf(bytes, { maxPages: 150 })).resolves.toMatchObject({ sourceType: "pdf" });
  });

  it("rejects a deck over maxSlides before reading slides", async () => {
    const { parsePptx } = await import("./pptx");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve(process.cwd(), "eval/fixtures/intake/sample.pptx")),
    );
    await expect(parsePptx(bytes, { maxSlides: 1 })).rejects.toThrow(
      /has 2 slides; the limit is 1/,
    );
  });
});
