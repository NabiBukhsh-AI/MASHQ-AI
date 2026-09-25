import { describe, it, expect, vi } from "vitest";
import { GradeLine } from "@/lib/schemas/turn-events";
import { keyVerdict, modelVerdict, kendallTauScore } from "./verdict";

describe("Verdicts", () => {
  describe("kendallTauScore", () => {
    it("returns 1 for exact match", () => {
      expect(kendallTauScore(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    });

    it("returns 0 for completely reversed match", () => {
      expect(kendallTauScore(["a", "b", "c"], ["c", "b", "a"])).toBe(0);
    });

    it("computes partial score for a single swap in 3 elements (2/3 concordant)", () => {
      // Pairs in correct: (a,b), (a,c), (b,c). In ["a", "c", "b"]: (a,b) ok, (a,c) ok, (c,b) swapped -> 2/3
      expect(kendallTauScore(["a", "b", "c"], ["a", "c", "b"])).toBeCloseTo(0.667, 3);
    });

    it("computes partial score for a single swap in 4 elements (5/6 concordant)", () => {
      // 4 elements -> 6 pairs. 1 swap -> 5 concordant pairs -> 5/6 = 0.8333
      expect(kendallTauScore(["1", "2", "3", "4"], ["1", "2", "4", "3"])).toBeCloseTo(0.833, 3);
    });

    it("handles edge cases: empty and single-element arrays", () => {
      expect(kendallTauScore([], [])).toBe(1);
      expect(kendallTauScore(["x"], ["x"])).toBe(1);
      expect(kendallTauScore(["x"], ["y"])).toBe(0);
    });
  });

  describe("keyVerdict: Choice questions", () => {
    it("grades a simple choice question", () => {
      const q = { type: "choice", correct: "A" };
      const v1 = keyVerdict(q, "A");
      expect(v1.score).toBe(1);
      expect(v1.verdict).toBe("correct");

      const v2 = keyVerdict(q, "B");
      expect(v2.score).toBe(0);
      expect(v2.verdict).toBe("incorrect");
    });

    it("grades an options-based question and preserves misconception on wrong option", () => {
      const q = {
        kind: "choice",
        id: "q_cnic",
        conceptKey: "c_identity",
        options: [
          {
            id: "opt_original",
            label: { en: "Original CNIC" },
            correct: true,
            consequence: "Good",
          },
          {
            id: "opt_copy",
            label: { en: "Photocopy" },
            correct: false,
            consequence: "Original required",
            misconceptionId: "mc_photocopy_sufficient",
          },
        ],
      };

      const correctResult = keyVerdict(q, "opt_original");
      expect(correctResult.score).toBe(1);
      expect(correctResult.verdict).toBe("correct");
      expect(correctResult.misconception).toBeNull();

      const wrongResult = keyVerdict(q, "opt_copy");
      expect(wrongResult.score).toBe(0);
      expect(wrongResult.verdict).toBe("incorrect");
      expect(wrongResult.misconception).toBe("mc_photocopy_sufficient");
    });
  });

  describe("keyVerdict: Sequence questions", () => {
    const q = {
      kind: "sequence",
      id: "q_seq_account",
      conceptKey: "c_onboarding",
      sequence: {
        steps: [
          { id: "s1", label: { en: "Step 1" } },
          { id: "s2", label: { en: "Step 2" } },
          { id: "s3", label: { en: "Step 3" } },
        ],
        correctOrder: ["s1", "s2", "s3"],
      },
    };

    it("awards full credit and correct verdict for exact order", () => {
      const verdict = keyVerdict(q, ["s1", "s2", "s3"]);
      expect(verdict.score).toBe(1);
      expect(verdict.verdict).toBe("correct");
    });

    it("awards partial credit for a single swapped pair", () => {
      const verdict = keyVerdict(q, ["s1", "s3", "s2"]);
      expect(verdict.score).toBeCloseTo(0.667, 2);
      expect(verdict.verdict).toBe("partial");
    });

    it("awards zero credit and incorrect verdict for completely reversed sequence", () => {
      const verdict = keyVerdict(q, ["s3", "s2", "s1"]);
      expect(verdict.score).toBe(0);
      expect(verdict.verdict).toBe("incorrect");
    });
  });

  describe("keyVerdict: Match questions", () => {
    it("grades map-based match questions with partial credit", () => {
      const q = {
        kind: "match",
        id: "q_match_docs",
        conceptKey: "c_docs",
        correct: {
          resident: "cnic",
          non_resident: "nicop",
          minor: "b_form",
          foreigner: "poc",
        },
      };

      // 4 out of 4 matches
      const full = keyVerdict(q, {
        resident: "cnic",
        non_resident: "nicop",
        minor: "b_form",
        foreigner: "poc",
      });
      expect(full.score).toBe(1);
      expect(full.verdict).toBe("correct");

      // 2 out of 4 matches
      const partial = keyVerdict(q, {
        resident: "cnic",
        non_resident: "nicop",
        minor: "wrong_1",
        foreigner: "wrong_2",
      });
      expect(partial.score).toBe(0.5);
      expect(partial.verdict).toBe("partial");

      // 0 out of 4 matches
      const none = keyVerdict(q, {
        resident: "x",
        non_resident: "x",
        minor: "x",
        foreigner: "x",
      });
      expect(none.score).toBe(0);
      expect(none.verdict).toBe("incorrect");
    });

    it("grades array-pairs match questions", () => {
      const q = {
        kind: "match",
        pairs: [
          { left: "debit", right: "withdraw" },
          { left: "credit", right: "deposit" },
        ],
      };

      const result = keyVerdict(q, { debit: "withdraw", credit: "deposit" });
      expect(result.score).toBe(1);
      expect(result.verdict).toBe("correct");
    });
  });

  describe("keyVerdict: Spot-the-error questions", () => {
    const q = {
      kind: "spot_error",
      id: "q_spot_kyc",
      conceptKey: "c_kyc",
      passage: {
        sentences: [
          { id: "sent_1", text: { en: "Customer arrives with account opening form." } },
          {
            id: "sent_2",
            text: { en: "Officer accepts an expired driving license as sole identity." },
          },
          { id: "sent_3", text: { en: "Account is opened and card ordered." } },
        ],
        errorSentenceId: "sent_2",
        misconceptionId: "mc_expired_id_allowed",
      },
    };

    it("grades correct when target error sentence is selected", () => {
      const verdict = keyVerdict(q, "sent_2");
      expect(verdict.score).toBe(1);
      expect(verdict.verdict).toBe("correct");
      expect(verdict.misconception).toBeNull();
    });

    it("grades incorrect and flags misconception when innocent sentence is selected", () => {
      const verdict = keyVerdict(q, "sent_1");
      expect(verdict.score).toBe(0);
      expect(verdict.verdict).toBe("incorrect");
      expect(verdict.misconception).toBe("mc_expired_id_allowed");
    });
  });

  describe("modelVerdict", () => {
    it("parses valid GradeLine event from model stream", async () => {
      const mockLlm = {
        stream: vi.fn().mockResolvedValue({
          textStream: (async function* () {
            yield '@@g {"verdict":"correct","question":"q_teach","concept":"c_cards","misconception":null,"score":0.9,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"high"}\n';
            yield "@@end\n";
          })(),
          usage: Promise.resolve({}),
          abort: () => {},
        }),
      };

      const verdict = await modelVerdict(
        { id: "q_teach", conceptKey: "c_cards" },
        "First verify biometric, then issue the chip card.",
        { language: "en" },
        { llm: mockLlm },
      );

      expect(verdict.verdict).toBe("correct");
      expect(verdict.score).toBe(0.9);
      expect(verdict.question).toBe("q_teach");
      expect(verdict.concept).toBe("c_cards");
      expect(GradeLine.safeParse(verdict).success).toBe(true);
    });

    it("retries once and recovers when first attempt output is malformed", async () => {
      let callCount = 0;
      const mockLlm = {
        stream: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // First attempt yields malformed JSON
            return {
              textStream: (async function* () {
                yield "@@g {malformed json\n@@end\n";
              })(),
              usage: Promise.resolve({}),
              abort: () => {},
            };
          }
          // Second attempt yields valid GradeLine
          return {
            textStream: (async function* () {
              yield '@@g {"verdict":"partial","question":"q_retry","concept":"c_kyc","misconception":null,"score":0.5,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}\n@@end\n';
            })(),
            usage: Promise.resolve({}),
            abort: () => {},
          };
        }),
      };

      const verdict = await modelVerdict(
        { id: "q_retry", conceptKey: "c_kyc" },
        "Customer needs to bring CNIC.",
        {},
        { llm: mockLlm },
      );

      expect(callCount).toBe(2);
      expect(verdict.verdict).toBe("partial");
      expect(verdict.score).toBe(0.5);
    });

    it("falls back to not_an_answer when both attempts fail or throw", async () => {
      const mockLlm = {
        stream: vi.fn().mockRejectedValue(new Error("LLM provider unavailable")),
      };

      const verdict = await modelVerdict(
        { id: "q_fallback", conceptKey: "c_fail" },
        "I want a glass of water.",
        { language: "ur" },
        { llm: mockLlm },
      );

      expect(verdict.verdict).toBe("not_an_answer");
      expect(verdict.score).toBe(0);
      expect(verdict.question).toBe("q_fallback");
      expect(verdict.concept).toBe("c_fail");
      expect(GradeLine.safeParse(verdict).success).toBe(true);
    });

    it("falls back to not_an_answer without crashing when called with minimal arguments", async () => {
      const verdict = await modelVerdict({}, "hello");
      expect(verdict.verdict).toBe("not_an_answer");
      expect(verdict.score).toBe(0);
      expect(GradeLine.safeParse(verdict).success).toBe(true);
    });
  });
});
