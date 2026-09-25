import { describe, it, expect } from "vitest";
import { normalize, normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("applies NFC without folding Urdu presentation forms", () => {
    // U+0627 U+0653 composes to U+0622 under NFC; NFKC would also fold U+FB50-range forms.
    expect(normalizeText("آ")).toBe("آ");
    expect(normalizeText("ﻟ")).toBe("ﻟ");
  });

  it("removes tag characters, zero-width spaces, word joiners and BOMs", () => {
    const hidden = "safe\u{E0041}\u{E0042}​text⁠﻿";
    expect(normalizeText(hidden)).toBe("safetext");
  });

  it("removes bidi embeddings, overrides and isolates but keeps LRM and RLM", () => {
    expect(normalizeText("‮abc‬ ⁦x⁩")).toBe("abc x");
    expect(normalizeText("a‎b‏c")).toBe("a‎b‏c");
  });

  it("keeps ZWNJ and ZWJ and Urdu character order", () => {
    const urdu = "می‌خواهم اور ک‍تاب";
    expect(normalizeText(urdu)).toBe(urdu);
    const sentence = "پہلے customer کا CNIC چیک کریں۔";
    expect(normalizeText(sentence)).toBe(sentence);
  });

  it("collapses whitespace but keeps paragraph breaks", () => {
    expect(normalizeText("a  b\t c\r\n\r\n\r\n\r\nd \n e")).toBe("a b c\n\nd\ne");
  });

  it("neutralizes @@ at a line start and our prompt tags", () => {
    expect(normalizeText("@@end\nsafe @@ inside\n@@m move")).toBe(
      "@ @end\nsafe @@ inside\n@ @m move",
    );
    expect(normalizeText("  @@end")).toBe("@ @end");
    expect(normalizeText("\t@@m mv1")).toBe("@ @m mv1");
    expect(normalizeText("a\n\u200E@@end")).toBe("a\n\u200E@ @end");
    expect(normalizeText("\u200C@@g x")).toBe("\u200C@ @g x");
    expect(normalizeText("<content_pack> and </learner_input> and <excerpt id=1> but <b>")).toBe(
      "＜content_pack> and ＜/learner_input> and ＜excerpt id=1> but <b>",
    );
  });

  it("strips C0 and C1 controls but keeps newlines", () => {
    expect(normalizeText("a\u0000b\u0007c\u009Fd\ne")).toBe("abcd\ne");
  });
});

describe("normalize(doc)", () => {
  it("normalizes every block, drops empty ones and rebuilds doc.text", () => {
    const doc = normalize({
      title: "  T​itle ",
      sourceType: "pptx",
      blocks: [
        { kind: "slide", ref: "1", heading: "H​1", text: "  body one  ", notes: "@@note" },
        { kind: "slide", ref: "2", text: "​" },
      ],
      text: "",
    });
    expect(doc.title).toBe("Title");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ heading: "H1", text: "body one", notes: "@ @note" });
    expect(doc.text).toBe("H1\nbody one\nNotes: @ @note");
  });
});
