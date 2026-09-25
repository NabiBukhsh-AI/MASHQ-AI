import { describe, it, expect } from "vitest";
import { locateQuote, verifyQuotes, type ChunkLike } from "./quote-verify";
import type { Fact } from "@/lib/schemas/design";

describe("quote verification", () => {
  const sampleChunk: ChunkLike = {
    id: "chunk-1",
    text: "Every account change starts with identity verification. Ask for the original CNIC.",
  };

  describe("locateQuote", () => {
    it("locates verbatim quote ignoring punctuation and spacing", () => {
      const quote = "Ask for the original CNIC.";
      const span = locateQuote(sampleChunk.text, quote);
      expect(span).not.toBeNull();
      expect(sampleChunk.text.slice(span!.start, span!.end)).toBe("Ask for the original CNIC");
    });

    it("matches Eastern Arabic-Indic digits to ASCII digits", () => {
      const text = "The minimum balance requirement is 5000 rupees.";
      const quote = "balance requirement is ۵۰۰۰ rupees";
      const span = locateQuote(text, quote);
      expect(span).not.toBeNull();
    });

    it("returns null when quote is not in the text", () => {
      const quote = "Passports are required for all accounts";
      expect(locateQuote(sampleChunk.text, quote)).toBeNull();
    });

    it("returns null for quotes shorter than 3 characters", () => {
      expect(locateQuote(sampleChunk.text, "ab")).toBeNull();
    });
  });

  describe("verifyQuotes", () => {
    it("keeps facts with valid verbatim quotes of 5 to 30 words", () => {
      const fact: Fact = {
        id: "f_id_verification",
        conceptKey: "c_identity",
        statement: "Staff must request original CNIC for verification.",
        anchors: [
          {
            chunkId: "chunk-1",
            quote: "Ask for the original CNIC",
          },
        ],
      };

      const result = verifyQuotes([fact], [sampleChunk]);
      expect(result.kept.length).toBe(1);
      expect(result.dropped.length).toBe(0);
      expect(result.kept[0]?.anchors[0]?.chunkId).toBe("chunk-1");
    });

    it("drops facts quoting unknown chunk ids", () => {
      const fact: Fact = {
        id: "f_unknown",
        conceptKey: "c_identity",
        statement: "Some statement",
        anchors: [
          {
            chunkId: "chunk-nonexistent",
            quote: "Ask for the original CNIC",
          },
        ],
      };

      const result = verifyQuotes([fact], [sampleChunk]);
      expect(result.kept.length).toBe(0);
      expect(result.dropped.length).toBe(1);
      expect(result.dropped[0]?.reason).toContain("unknown chunk");
    });

    it("drops facts where quote has fewer than 5 words", () => {
      const fact: Fact = {
        id: "f_short",
        conceptKey: "c_identity",
        statement: "Short quote",
        anchors: [
          {
            chunkId: "chunk-1",
            quote: "identity verification",
          },
        ],
      };

      const result = verifyQuotes([fact], [sampleChunk]);
      expect(result.kept.length).toBe(0);
      expect(result.dropped.length).toBe(1);
      expect(result.dropped[0]?.reason).toContain("5 to 30 required");
    });

    it("drops facts where quote is not verbatim", () => {
      const fact: Fact = {
        id: "f_altered",
        conceptKey: "c_identity",
        statement: "Altered quote",
        anchors: [
          {
            chunkId: "chunk-1",
            quote: "Every bank account change requires original passport now",
          },
        ],
      };

      const result = verifyQuotes([fact], [sampleChunk]);
      expect(result.kept.length).toBe(0);
      expect(result.dropped.length).toBe(1);
      expect(result.dropped[0]?.reason).toContain("not found verbatim");
    });
  });
});
