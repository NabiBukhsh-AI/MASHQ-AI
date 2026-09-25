import { describe, it, expect } from "vitest";
import { blockText, chunkDocument } from "./chunk";
import { estimateTokens } from "@/lib/text/tokens";
import type { ParsedDoc } from "@/lib/parse";

const opts = { targetTokens: 500, maxTokens: 800, overlapTokens: 60 };

function paragraph(i: number, words = 60) {
  return Array.from({ length: words }, (_, w) => `word${i}_${w}`).join(" ") + ".";
}

function doc(blocks: ParsedDoc["blocks"]): ParsedDoc {
  return { sourceType: "pdf", blocks, text: blocks.map((b) => b.text).join("\n\n") };
}

describe("chunkDocument", () => {
  it("gives every chunk an anchor whose span reproduces its text exactly", () => {
    const pages = Array.from({ length: 3 }, (_, p) => ({
      kind: "page" as const,
      ref: String(p + 1),
      text: Array.from({ length: 12 }, (_, i) => paragraph(p * 100 + i)).join("\n\n"),
    }));
    const chunks = chunkDocument(doc(pages), opts);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      const block = pages.find((b) => b.ref === c.anchor.ref)!;
      expect(c.anchor.kind).toBe("page");
      expect(blockText(block).slice(c.anchor.start, c.anchor.end)).toBe(c.text);
      expect(c.tokenCount).toBeLessThanOrEqual(opts.maxTokens);
      expect(c.text.trim()).toBe(c.text);
    }
  });

  it("never exceeds maxTokens, even for one giant paragraph or one giant sentence", () => {
    const giantParagraph =
      Array.from(
        { length: 40 },
        (_, i) => `Sentence number ${i} says something useful about accounts and identity checks`,
      ).join(". ") + ".";
    const giantSentence = "x".repeat(20_000);
    const chunks = chunkDocument(
      doc([
        { kind: "section", ref: "a", text: giantParagraph },
        { kind: "section", ref: "b", text: giantSentence },
      ]),
      { targetTokens: 100, maxTokens: 150, overlapTokens: 10 },
    );
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(150);
  });

  it("keeps original order by ordinal and block order", () => {
    const blocks = Array.from({ length: 4 }, (_, i) => ({
      kind: "slide" as const,
      ref: String(i + 1),
      text: paragraph(i, 20),
    }));
    const chunks = chunkDocument(doc(blocks), opts);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);
    expect(chunks.map((c) => c.anchor.ref)).toEqual(["1", "2", "3", "4"]);
    const shuffled = [...chunks].reverse().sort((a, b) => a.ordinal - b.ordinal);
    expect(shuffled.map((c) => c.text)).toEqual(blocks.map((b) => b.text));
  });

  it("overlaps consecutive chunks within a block", () => {
    const text = Array.from({ length: 10 }, (_, i) => paragraph(i, 80)).join("\n\n");
    const chunks = chunkDocument(doc([{ kind: "page", ref: "1", text }]), {
      targetTokens: 200,
      maxTokens: 300,
      overlapTokens: 30,
    });
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.anchor.start).toBeLessThan(chunks[i - 1]!.anchor.end);
      expect(chunks[i]!.anchor.start).toBeGreaterThan(chunks[i - 1]!.anchor.start);
    }
  });

  it("keeps Urdu text intact (ZWNJ and character order survive) and labels the language", () => {
    const urdu =
      "پہلے کسٹمر کا شناختی کارڈ چیک کریں۔ می‌خواهم اور کتاب۔ " +
      "یہ عمل تین مراحل پر مشتمل ہے۔ ".repeat(40);
    const chunks = chunkDocument(doc([{ kind: "page", ref: "1", text: urdu }]), {
      targetTokens: 120,
      maxTokens: 160,
      overlapTokens: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join("")).toContain("می‌خواهم");
    expect(chunks[0]!.lang).toBe("ur");
    for (const c of chunks) expect(urdu.slice(c.anchor.start, c.anchor.end)).toBe(c.text);
  });

  it("carries the heading path and includes speaker notes once", () => {
    const chunks = chunkDocument(
      doc([
        {
          kind: "slide",
          ref: "3",
          heading: "Step 2: Verification",
          text: "Check the original CNIC.",
          notes: "Remind learners about greetings.",
        },
      ]),
      opts,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["Step 2: Verification"]);
    expect(chunks[0]!.text).toBe(
      "Check the original CNIC.\n\nNotes: Remind learners about greetings.",
    );
  });

  it("skips empty blocks", () => {
    expect(chunkDocument(doc([{ kind: "page", ref: "1", text: "   " }]), opts)).toEqual([]);
  });
});

describe("chunkDocument: cut safety", () => {
  it("never splits a surrogate pair or separates a combining mark from its base", () => {
    const emoji = "\u{1F600}".repeat(3000);
    const harakat = "بَ".repeat(2000);
    const chunks = chunkDocument(
      doc([
        { kind: "page", ref: "1", text: emoji },
        { kind: "page", ref: "2", text: harakat },
      ]),
      { targetTokens: 200, maxTokens: 300, overlapTokens: 20 },
    );
    expect(chunks.length).toBeGreaterThan(4);
    for (const c of chunks) {
      expect(c.text).toMatch(/^[^\uDC00-\uDFFF\p{M}]/u);
      expect(c.text).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(Buffer.from(c.text, "utf8").toString("utf8")).toBe(c.text);
    }
  });

  it("splits a 400k-character space-less run in reasonable time", () => {
    const started = performance.now();
    const chunks = chunkDocument(
      doc([{ kind: "page", ref: "1", text: "x".repeat(400_000) }]),
      opts,
    );
    expect(chunks.length).toBeGreaterThan(100);
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
