import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { checkMagicBytes, validateFileType } from "./validate";

const fixturesDir = path.resolve(process.cwd(), "eval/fixtures/intake");

describe("File Validation & Magic Bytes", () => {
  it("validates PDF magic bytes correctly", () => {
    const tinyPdf = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "tiny.pdf")));
    expect(checkMagicBytes(tinyPdf, "application/pdf")).toBe(true);

    const badMagicPdf = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "bad-magic.pdf")));
    expect(checkMagicBytes(badMagicPdf, "application/pdf")).toBe(false);
  });

  it("validates DOCX and PPTX zip signatures correctly", () => {
    const docxBytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "sample.docx")));
    expect(
      checkMagicBytes(
        docxBytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);

    const pptxBytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "sample.pptx")));
    expect(
      checkMagicBytes(
        pptxBytes,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe(true);

    const nonZip = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    expect(checkMagicBytes(nonZip, "application/zip")).toBe(false);
  });

  it("detects and rejects NUL bytes in text files", () => {
    const textBytes = new TextEncoder().encode("Hello clean text");
    expect(checkMagicBytes(textBytes, "text/plain")).toBe(true);

    const nulBytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "nul-byte.txt")));
    expect(checkMagicBytes(nulBytes, "text/plain")).toBe(false);
  });

  it("rejects binary files masquerading as plain text", () => {
    const pdfBytes = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "tiny.pdf")));
    expect(checkMagicBytes(pdfBytes, "text/plain")).toBe(false);
  });

  it("validates file type with user-friendly messages", () => {
    expect(validateFileType(new Uint8Array(0), "application/pdf").valid).toBe(false);
    expect(validateFileType(new Uint8Array(0), "application/pdf").reason).toContain("empty");

    const badMagicPdf = new Uint8Array(fs.readFileSync(path.join(fixturesDir, "bad-magic.pdf")));
    const result = validateFileType(badMagicPdf, "application/pdf");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("signature does not match");
  });
});
