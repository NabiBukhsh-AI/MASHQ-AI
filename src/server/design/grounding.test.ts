import { describe, it, expect, vi } from "vitest";
import { checkGrounding } from "./grounding";
import type { Llm } from "../llm/provider";

describe("grounding check", () => {
  it("returns empty results for empty claims array", async () => {
    const mockLlm: Partial<Llm> = { object: vi.fn() };
    const res = await checkGrounding([], [{ id: "c1", text: "Some text" }], {
      llm: mockLlm as Llm,
    });
    expect(res.results).toEqual([]);
    expect(mockLlm.object).not.toHaveBeenCalled();
  });

  it("marks all claims unsupported when excerpts are empty", async () => {
    const mockLlm: Partial<Llm> = { object: vi.fn() };
    const claims = [
      { id: "claim-1", claim: "The branch opens at 9am." },
      { id: "claim-2", claim: "Staff must wear uniforms." },
    ];
    const res = await checkGrounding(claims, [], { llm: mockLlm as Llm });
    expect(res.results.length).toBe(2);
    expect(res.results[0]?.verdict).toBe("unsupported");
    expect(res.results[1]?.verdict).toBe("unsupported");
    expect(mockLlm.object).not.toHaveBeenCalled();
  });

  it("calls llm.object and formats grounding verdicts", async () => {
    const claims = [
      { id: "claim-1", claim: "Identity verification requires original CNIC." },
      { id: "claim-2", claim: "Photocopies of CNIC are acceptable." },
    ];
    const excerpts = [
      {
        id: "chunk-1",
        text: "Every account change starts with identity verification. Ask for the original CNIC. A photocopy is not accepted.",
      },
    ];

    const mockLlm: Partial<Llm> = {
      object: vi.fn().mockResolvedValue({
        value: {
          results: [
            {
              id: "claim-1",
              verdict: "supported",
              note: null,
              corrected: null,
            },
            {
              id: "claim-2",
              verdict: "unsupported",
              note: "Excerpts explicitly state photocopies are not accepted.",
              corrected: "Photocopies are not accepted for account changes.",
            },
          ],
        },
      }),
    };

    const res = await checkGrounding(claims, excerpts, { llm: mockLlm as Llm });
    expect(res.results.length).toBe(2);
    expect(res.results[0]?.verdict).toBe("supported");
    expect(res.results[1]?.verdict).toBe("unsupported");
    expect(mockLlm.object).toHaveBeenCalledWith(
      "grounding.check",
      expect.anything(),
      expect.objectContaining({
        packBlocks: expect.arrayContaining([expect.stringContaining("chunk-1")]),
      }),
      expect.anything(),
    );
  });

  it("fills unsupported verdict if model omits a claim", async () => {
    const claims = [
      { id: "claim-1", claim: "Claim 1 statement." },
      { id: "claim-2", claim: "Claim 2 statement." },
    ];
    const excerpts = [{ id: "chunk-1", text: "Text here." }];

    const mockLlm: Partial<Llm> = {
      object: vi.fn().mockResolvedValue({
        value: {
          results: [
            {
              id: "claim-1",
              verdict: "supported",
              note: null,
              corrected: null,
            },
            // claim-2 missing
          ],
        },
      }),
    };

    const res = await checkGrounding(claims, excerpts, { llm: mockLlm as Llm });
    expect(res.results.length).toBe(2);
    expect(res.results.find((r) => r.id === "claim-2")?.verdict).toBe("unsupported");
  });
});
