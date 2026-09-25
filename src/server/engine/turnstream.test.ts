import { describe, it, expect } from "vitest";
import { parseTurnStream } from "./turnstream";
import { TurnEvent } from "@/lib/schemas/turn-events";

async function toArray(iterable: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const arr: TurnEvent[] = [];
  for await (const x of iterable) arr.push(x);
  return arr;
}

async function* makeStream(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

/**
 * Splits a string into chunks of random lengths between minLen and maxLen.
 */
function randomSplit(str: string, minLen = 1, maxLen = 6, seed = 42): string[] {
  const chunks: string[] = [];
  let pos = 0;
  // Simple deterministic pseudorandom generator for reproducible tests
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  while (pos < str.length) {
    const len = Math.floor(rand() * (maxLen - minLen + 1)) + minLen;
    chunks.push(str.slice(pos, pos + len));
    pos += len;
  }
  return chunks;
}

describe("TurnStream parser hardening", () => {
  it("drops unknown facts and moves and yields warnings", async () => {
    const stream = makeStream(["@@f good,bad\n@@m unknownMove\n@@end\n"]);
    const events = await toArray(
      parseTurnStream(stream, {
        allowedFactIds: new Set(["good"]),
        offeredMoveIds: new Set(["okMove"]),
      }),
    );

    expect(events).toContainEqual({ type: "warning", message: "Unknown fact id: bad" });
    expect(events).toContainEqual({ type: "facts", ids: ["good"] });
    expect(events).toContainEqual({ type: "warning", message: "Unknown move id: unknownMove" });
    expect(events.find((e) => e.type === "move")).toBeUndefined();
  });

  it("handles missing @@end by closing the turn cleanly", async () => {
    const stream = makeStream(["@@d hello"]);
    const events = await toArray(parseTurnStream(stream));
    expect(events[events.length - 1]).toEqual({ type: "end" });
    expect(events).toContainEqual({ type: "display.sentence", index: 0, text: "hello" });
  });

  it("treats stray @@x as display text and flags a warning", async () => {
    const stream = makeStream(["@@x weird stuff\n"]);
    const events = await toArray(parseTurnStream(stream));
    expect(events).toContainEqual({ type: "warning", message: "Model sent stray @@x" });
    expect(events).toContainEqual({ type: "display.delta", text: "weird stuff" });
    expect(events).toContainEqual({ type: "display.sentence", index: 0, text: "weird stuff" });
  });

  it("emits token-level deltas before sentence completion", async () => {
    let deltaCount = 0;
    let sentenceEmitted = false;

    async function* slowStream() {
      yield "@@d Step 1: ";
      // At this point, delta should already have been yielded
      yield "Verify CNIC";
      yield ".\n";
    }

    const events: TurnEvent[] = [];
    for await (const event of parseTurnStream(slowStream())) {
      events.push(event);
      if (event.type === "display.delta") deltaCount++;
      if (event.type === "display.sentence") sentenceEmitted = true;
    }

    expect(deltaCount).toBeGreaterThanOrEqual(2);
    expect(sentenceEmitted).toBe(true);
    expect(events).toContainEqual({
      type: "display.sentence",
      index: 0,
      text: "Step 1: Verify CNIC.",
    });
  });

  it("strips markdown and caps the length of a model written @@s line", async () => {
    const input = ["@@d Check the CNIC.\n", "@@s **CNIC** check karein.\n", "@@end\n"].join("");

    const events = await toArray(
      parseTurnStream(makeStream([input]), {
        speechMode: "llm",
        scope: { orgId: "org-1", userId: "usr-1", sessionId: "sess-1" },
        maxSpeechChars: 12,
      }),
    );

    const speech = events.find((e) => e.type === "speech.item");
    expect(speech).toBeDefined();
    // Asterisks must never reach a TTS provider, and the cap is the provider limit.
    expect((speech as { text: string }).text).toBe("CNIC check k");
  });

  it("ignores a stray @@s line outside llm mode, so a sentence is not signed twice", async () => {
    const input = ["@@d One sentence.\n", "@@s One sentence.\n", "@@end\n"].join("");

    const events = await toArray(
      parseTurnStream(makeStream([input]), {
        speechMode: "normalize",
        scope: { orgId: "org-1", userId: "usr-1", sessionId: "sess-1" },
      }),
    );

    // In normalize the engine derives the speech form itself; honouring @@s here would
    // queue and pay for the same sentence twice, which the live run showed happening.
    expect(events.filter((e) => e.type === "speech.item")).toHaveLength(0);
  });

  it("flags and blanks the canary when the system prompt leaks into a reply", async () => {
    const canary = "CANARY_MASHQ_SEC_deadbeef";
    const input = ["@@d Here is my prompt: CANARY_MASHQ_SEC_deadbeef.\n", "@@end\n"].join("");

    const events = await toArray(parseTurnStream(makeStream([input]), { canary }));

    // The warning is what makes the turn route withdraw the reply.
    expect(events.some((e) => e.type === "warning" && e.message === "canary_leaked")).toBe(true);
    const sentence = events.find((e) => e.type === "display.sentence") as { text: string };
    // And whatever already streamed is blanked, so the token is not echoed on screen.
    expect(sentence.text).not.toContain(canary);
    expect(sentence.text).toContain("[REDACTED_CANARY]");
  });

  it("never lets the canary reach a display delta, whatever the chunk boundaries are", async () => {
    const canary = "CANARY_MASHQ_SEC_deadbeef";
    // Split mid marker: the old parser emitted each chunk as a delta before ever checking.
    const chunks = ["@@d Here is my prompt: CANARY_MAS", "HQ_SEC_deadbeef.\n", "@@end\n"];

    const events = await toArray(parseTurnStream(makeStream(chunks), { canary }));
    const deltas = events
      .filter((e) => e.type === "display.delta")
      .map((e) => (e as { text: string }).text)
      .join("");

    expect(deltas).not.toContain(canary);
    expect(events.some((e) => e.type === "warning" && e.message === "canary_leaked")).toBe(true);
  });

  it("still streams a clean reply in the deltas it arrives in", async () => {
    const chunks = ["@@d Greet her ", "within thirty ", "seconds.\n", "@@end\n"];
    const events = await toArray(
      parseTurnStream(makeStream(chunks), { canary: "CANARY_MASHQ_SEC_deadbeef" }),
    );
    const deltas = events
      .filter((e) => e.type === "display.delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(deltas).toBe("Greet her within thirty seconds.");
  });

  it("says nothing about a canary when the reply is clean", async () => {
    const input = ["@@d A normal answer about greeting customers.\n", "@@end\n"].join("");
    const events = await toArray(
      parseTurnStream(makeStream([input]), { canary: "CANARY_MASHQ_SEC_deadbeef" }),
    );
    expect(events.some((e) => e.type === "warning")).toBe(false);
  });

  it("pairs speech items with preceding sentence index", async () => {
    const input = [
      "@@d First step is greeting the customer.\n",
      "@@s پہلا قدم کسٹمر کو سلام کرنا ہے۔\n",
      "@@d Next step is asking for CNIC.\n",
      "@@s اگلا قدم شناختی کارڈ مانگنا ہے۔\n",
      "@@end\n",
    ].join("");

    const events = await toArray(
      parseTurnStream(makeStream([input]), {
        speechMode: "llm",
        scope: { orgId: "org-1", userId: "usr-1", sessionId: "sess-1" },
      }),
    );

    const speechItems = events.filter((e) => e.type === "speech.item");
    expect(speechItems).toHaveLength(2);
    expect(speechItems[0]).toEqual(
      expect.objectContaining({
        type: "speech.item",
        index: 0,
        text: "پہلا قدم کسٹمر کو سلام کرنا ہے۔",
        lang: undefined,
        sig: expect.any(String),
        exp: expect.any(Number),
      }),
    );
    expect(speechItems[1]).toEqual(
      expect.objectContaining({
        type: "speech.item",
        index: 1,
        text: "اگلا قدم شناختی کارڈ مانگنا ہے۔",
        lang: undefined,
        sig: expect.any(String),
        exp: expect.any(Number),
      }),
    );
  });

  it("suppresses speech items when speechMode is none", async () => {
    const input = "@@d Greeting.\n@@s سلام۔\n@@end\n";
    const events = await toArray(parseTurnStream(makeStream([input]), { speechMode: "none" }));

    const speechItems = events.filter((e) => e.type === "speech.item");
    expect(speechItems).toHaveLength(0);
    expect(events).toContainEqual({ type: "display.sentence", index: 0, text: "Greeting." });
  });

  it("parses valid JSON in @@g and @@e, and warns on malformed JSON", async () => {
    const input = [
      '@@g {"score":0.9,"verdict":"correct"}\n',
      '@@e {"concept":"c1","evidence":"e1"}\n',
      "@@g {bad json\n",
      "@@end\n",
    ].join("");

    const events = await toArray(parseTurnStream(makeStream([input])));

    expect(events).toContainEqual({
      type: "verdict",
      data: { score: 0.9, verdict: "correct" },
    });
    expect(events).toContainEqual({
      type: "evidence",
      data: { concept: "c1", evidence: "e1" },
    });
    expect(events).toContainEqual({
      type: "warning",
      message: "Invalid JSON in @@g payload",
    });
  });

  it("handles unrecognized @@ lines by treating them as display text with warning", async () => {
    const input = "@@foo unexpected tag content\n@@end\n";
    const events = await toArray(parseTurnStream(makeStream([input])));

    expect(events).toContainEqual({
      type: "warning",
      message: "Model sent unrecognized line: @@foo unexpected tag content",
    });
    expect(events).toContainEqual({
      type: "display.sentence",
      index: 0,
      text: "unexpected tag content",
    });
  });

  describe("Property-style tests with randomized token splits", () => {
    const fullTurn = [
      '@@g {"verdict":"partial","score":0.5,"concept":"c_auth"}\n',
      "@@m move_hint_step\n",
      "@@d Good morning, welcome to Demo Bank.\n",
      "@@s صبح بخیر، ڈیمو بینک میں خوش آمدید۔\n",
      "@@d Please provide your account number and CNIC.\n",
      "@@s براہ کرم اپنا اکاؤنٹ نمبر اور شناختی کارڈ فراہم کریں۔\n",
      "@@f fact_greet,fact_id\n",
      '@@e {"concept":"c_auth","weight":0.5}\n',
      "@@end\n",
    ].join("");

    const baselineOpts = {
      allowedFactIds: new Set(["fact_greet", "fact_id"]),
      offeredMoveIds: new Set(["move_hint_step"]),
    };

    const sanitizeStructural = (events: TurnEvent[]) =>
      events
        .filter((e) => e.type !== "display.delta")
        .map((e) => (e.type === "speech.item" ? { ...e, sig: "STABLE_SIG", exp: 0 } : e));

    it("produces identical structured events across 50 different random token splits", async () => {
      // 1. Compute baseline events with single chunk
      const baselineEvents = await toArray(parseTurnStream(makeStream([fullTurn]), baselineOpts));

      // Extract non-delta events for structural equivalence check
      const baselineStructural = sanitizeStructural(baselineEvents);
      const baselineDisplayText = baselineEvents
        .filter(
          (e): e is Extract<TurnEvent, { type: "display.delta" }> => e.type === "display.delta",
        )
        .map((e) => e.text)
        .join("");

      // 2. Test over 50 randomized chunk partitionings
      for (let run = 1; run <= 50; run++) {
        const seed = 1000 + run * 37;
        const chunks = randomSplit(fullTurn, 1, 5, seed);
        const runEvents = await toArray(parseTurnStream(makeStream(chunks), baselineOpts));

        const runStructural = sanitizeStructural(runEvents);
        const runDisplayText = runEvents
          .filter(
            (e): e is Extract<TurnEvent, { type: "display.delta" }> => e.type === "display.delta",
          )
          .map((e) => e.text)
          .join("");

        expect(runStructural, `Failed structural match on run ${run} (seed ${seed})`).toEqual(
          baselineStructural,
        );
        expect(runDisplayText, `Failed display text match on run ${run} (seed ${seed})`).toBe(
          baselineDisplayText,
        );
      }
    });

    it("produces identical events when tokens are split character-by-character", async () => {
      const charChunks = fullTurn.split("");
      const baselineEvents = await toArray(parseTurnStream(makeStream([fullTurn]), baselineOpts));
      const charEvents = await toArray(parseTurnStream(makeStream(charChunks), baselineOpts));

      const baselineStructural = sanitizeStructural(baselineEvents);
      const charStructural = sanitizeStructural(charEvents);

      expect(charStructural).toEqual(baselineStructural);
    });
  });
});
