import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { readCentralDirectory, validateZipFile, ZIP_LIMITS } from "./zip-guard";
import { ParseError } from "@/lib/parse/errors";

const fixtures = path.resolve(process.cwd(), "eval/fixtures/intake");
const read = (name: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));

/** Overwrite the size fields in every LOCAL file header (the attacker-controlled copy). */
function forgeLocalHeaders(zip: Uint8Array, compressed: number, uncompressed: number): Uint8Array {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i + 30 <= out.length; i++) {
    if (view.getUint32(i, true) === 0x04034b50) {
      view.setUint32(i + 18, compressed, true);
      view.setUint32(i + 22, uncompressed, true);
    }
  }
  return out;
}

const expectParseError = (fn: () => unknown, re: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError);
    expect((e as Error).message).toMatch(re);
    return;
  }
  throw new Error("expected a ParseError");
};

describe("zip guard: central directory", () => {
  it("reads entries, sizes and methods from the central directory", () => {
    const zip = zipSync({ "a.txt": strToU8("hello"), "dir/b.txt": strToU8("x".repeat(5000)) });
    const cd = readCentralDirectory(zip);
    expect(cd.entries.map((e) => e.name).sort()).toEqual(["a.txt", "dir/b.txt"]);
    expect(cd.totalUncompressed).toBe(5005);
    expect(cd.totalCompressed).toBeGreaterThan(0);
  });

  it("accepts real DOCX and PPTX fixtures when asked for their kind", () => {
    expect(validateZipFile(read("sample.docx"), "docx").entries.length).toBeGreaterThanOrEqual(3);
    expect(validateZipFile(read("sample.pptx"), "pptx").entries.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects the zip bomb fixture before extraction", () => {
    expectParseError(() => validateZipFile(read("zipbomb.zip"), "docx"), /zip bomb/i);
  });

  it("ignores forged local headers: the central directory decides", () => {
    const forged = forgeLocalHeaders(read("zipbomb.zip"), 100, 200);
    expectParseError(() => validateZipFile(forged, "docx"), /zip bomb/i);
  });

  it("rejects an entry over 20 MB and a ratio over 100:1", () => {
    const big = zipSync(
      { "big.bin": new Uint8Array(ZIP_LIMITS.maxEntryUncompressed + 1) },
      { level: 9 },
    );
    expectParseError(() => validateZipFile(big), /over 20 MB|zip bomb/i);
    const ratio = zipSync({ "zeros.bin": new Uint8Array(3 * 1024 * 1024) }, { level: 9 });
    expectParseError(() => validateZipFile(ratio), /100:1|zip bomb/i);
  });

  it("rejects path traversal, absolute paths and nested archives", () => {
    expectParseError(
      () => validateZipFile(zipSync({ "../../evil.sh": strToU8("x") })),
      /unsafe internal path/,
    );
    expectParseError(
      () => validateZipFile(zipSync({ "/etc/passwd": strToU8("x") })),
      /unsafe internal path/,
    );
    expectParseError(
      () =>
        validateZipFile(
          zipSync({ "word/document.xml": strToU8("<a/>"), "inner.zip": strToU8("PK") }),
        ),
      /nested archive/,
    );
  });

  it("rejects too many entries", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < ZIP_LIMITS.maxEntries + 1; i++) entries[`f${i}.txt`] = strToU8("s");
    expectParseError(() => validateZipFile(zipSync(entries)), /too many internal parts/);
  });

  it("requires the parts a real Office file has", () => {
    const fake = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "readme.txt": strToU8("hi"),
    });
    expectParseError(() => validateZipFile(fake, "docx"), /not a valid DOCX.*word\/document\.xml/);
    expectParseError(
      () => validateZipFile(fake, "pptx"),
      /not a valid PPTX.*ppt\/presentation\.xml/,
    );
    expect(() => validateZipFile(fake)).not.toThrow();
  });

  it("rejects empty, truncated and non-zip input readably", () => {
    expectParseError(() => validateZipFile(new Uint8Array(0)), /empty/);
    expectParseError(() => validateZipFile(new Uint8Array(10)), /too small/);
    expectParseError(() => validateZipFile(new Uint8Array(4096)), /directory missing/);
    expectParseError(
      () => validateZipFile(zipSync({ "a.txt": strToU8("hi") }).slice(0, 40)),
      /not a valid Office document/,
    );
  });
});
