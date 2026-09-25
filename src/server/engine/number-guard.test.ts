import { describe, expect, it } from "vitest";
import { checkNumbers, applyNumberGuard, UNVERIFIED_FIGURE_FALLBACK } from "./number-guard";

describe("number-guard", () => {
  const sampleFacts = [
    {
      statement: "Customers must be acknowledged within 60 seconds of entering the branch.",
      anchors: [{ quote: "The first 60 seconds set the customer experience tone." }],
    },
    {
      statement: "Minimum opening balance for the current account is PKR 5,000.",
      anchors: [{ quote: "An initial deposit of PKR 5,000 is required." }],
    },
    {
      statement: "Profit rate for the savings tier is 12.5%.",
      anchors: [],
    },
  ];

  const sampleExcerpts = ["Branch timings are Monday to Thursday 9:00 AM to 5:00 PM."];

  it("returns empty unverified list when sentence contains no numbers", () => {
    const res = checkNumbers("Welcome to the branch. How may I assist you today?", sampleFacts);
    expect(res.unverified).toEqual([]);
  });

  it("verifies numbers present in fact statements", () => {
    const res = checkNumbers("You should greet them within 60 seconds.", sampleFacts);
    expect(res.unverified).toEqual([]);
  });

  it("verifies numbers formatted with currency and commas against clean numbers", () => {
    const res = checkNumbers("You need 5000 rupees to open the account.", sampleFacts);
    expect(res.unverified).toEqual([]);

    const res2 = checkNumbers("The deposit is PKR 5,000.", sampleFacts);
    expect(res2.unverified).toEqual([]);
  });

  it("verifies percentages and decimals present in facts", () => {
    const res = checkNumbers("The profit rate is 12.5% per annum.", sampleFacts);
    expect(res.unverified).toEqual([]);
  });

  it("verifies numbers found in excerpts", () => {
    const res = checkNumbers("The branch closes at 5:00 PM.", sampleFacts, sampleExcerpts);
    expect(res.unverified).toEqual([]);
  });

  it("normalizes Urdu / Arabic-Indic digits before checking", () => {
    // ۶۰ is 60 in Urdu digits
    const res = checkNumbers("آپ کو گاہک کو ۶۰ سیکنڈ میں خوش آمدید کہنا چاہیے۔", sampleFacts);
    expect(res.unverified).toEqual([]);
  });

  it("flags hallucinated or unsupported numbers as unverified", () => {
    const res = checkNumbers("The fee is PKR 999 and the limit is 42.", sampleFacts);
    expect(res.unverified).toContain("PKR 999");
    expect(res.unverified).toContain("42");
  });

  describe("applyNumberGuard", () => {
    it("in strict mode: replaces sentence with fallback when unverified numbers exist", () => {
      const sentence = "The interest rate on this loan is 25.4%.";
      const res = applyNumberGuard(sentence, sampleFacts, [], "strict");
      expect(res.replaced).toBe(true);
      expect(res.text).toBe(UNVERIFIED_FIGURE_FALLBACK);
      expect(res.unverified).toContain("25.4%");
    });

    it("in strict mode: keeps original sentence when all numbers are verified", () => {
      const sentence = "Please acknowledge the visitor within 60 seconds.";
      const res = applyNumberGuard(sentence, sampleFacts, [], "strict");
      expect(res.replaced).toBe(false);
      expect(res.text).toBe(sentence);
      expect(res.unverified).toEqual([]);
    });

    it("in assisted mode: keeps original sentence even with unverified numbers", () => {
      const sentence = "The general market rate is around 18.5%.";
      const res = applyNumberGuard(sentence, sampleFacts, [], "assisted");
      expect(res.replaced).toBe(false);
      expect(res.text).toBe(sentence);
      expect(res.unverified).toContain("18.5%");
    });
  });

  // A figure is a figure whether it is written "50,000" or "fifty thousand", and the seed
  // corpus writes them both ways. A digits-only guard missed exactly the invented figures
  // that sound most authoritative.
  describe("numbers written as words", () => {
    const wordedFacts = [
      "Branch staff who greet every customer within thirty seconds receive fewer complaints.",
      "A savings account needs a minimum balance of five thousand rupees.",
    ];

    it.each([
      ["Greet her within thirty seconds.", false],
      ["The minimum balance is five thousand rupees.", false],
      ["The minimum balance is fifty thousand rupees.", true],
      ["Report it within twenty four hours.", true],
    ])("flags %s as unverified: %s", (sentence, shouldFlag) => {
      const res = checkNumbers(sentence, wordedFacts, []);
      expect(res.unverified.length > 0).toBe(shouldFlag);
    });

    // Without this, "one" fires on ordinary prose and the guard blanks a correct sentence,
    // which is a worse failure than the one it was added to fix.
    it.each([
      "Treat her as one would treat a guest.",
      "Listen fully, then confirm the details.",
      "It takes about half the time when you greet early.",
      "Give her one form and a pen.",
    ])("leaves ordinary prose alone: %s", (sentence) => {
      expect(checkNumbers(sentence, wordedFacts, []).unverified).toEqual([]);
    });
  });
});

/**
 * In assisted mode the sentence is shown as written, so the figures the
 * source does not carry have to be marked. The engine used to compute them and throw them
 * away, which meant an invented figure rendered exactly like a sourced one.
 */
describe("assisted mode reports what it did not verify", () => {
  const facts = ["Acknowledge the visitor within 60 seconds."];

  it("names the unverified figures without replacing the sentence", () => {
    const res = applyNumberGuard("The rate is around 18.5%.", facts, [], "assisted");
    expect(res.replaced).toBe(false);
    expect(res.unverified).toContain("18.5%");
  });

  it("reports nothing when every figure is in the source", () => {
    const res = applyNumberGuard("Acknowledge within 60 seconds.", facts, [], "assisted");
    expect(res.unverified).toEqual([]);
  });

  it("replaces rather than marks in strict mode, so there is nothing left to mark", () => {
    const res = applyNumberGuard("The rate is around 18.5%.", facts, [], "strict");
    expect(res.replaced).toBe(true);
    expect(res.text).not.toContain("18.5");
  });
});
