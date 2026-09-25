import { describe, it, expect, vi } from "vitest";
import { auditTurn, shouldAudit } from "./turn-audit";
import type { Llm } from "../llm/provider";

/**
 * The only check on what the tutor actually said. Everything else in the
 * grounding story checks the material at design time, so without this the unsupported claim
 * rate was unknown rather than zero.
 */

const llmReturning = (results: Array<{ id: string; verdict: string; note?: string }>) =>
  ({
    object: vi.fn().mockResolvedValue({
      value: { results: results.map((r) => ({ note: null, corrected: null, ...r })) },
      usage: {},
    }),
  }) as unknown as Llm;

const input = {
  sessionId: "sess-1",
  turnId: "t-1",
  orgId: "org-1",
  contentId: "c-1",
  sentences: ["Greet her within thirty seconds.", "The fee is PKR 900."],
  factStatements: ["Greet every customer within thirty seconds."],
  excerpts: ["Branch staff greet customers promptly."],
};

describe("shouldAudit", () => {
  it("audits everything at 1 and nothing at 0", () => {
    expect(shouldAudit(1)).toBe(true);
    expect(shouldAudit(0)).toBe(false);
  });

  it("samples in between", () => {
    expect(shouldAudit(0.5, () => 0.4)).toBe(true);
    expect(shouldAudit(0.5, () => 0.6)).toBe(false);
  });
});

describe("auditTurn", () => {
  it("counts partial against the rate, because the learner heard it as stated", async () => {
    const llm = llmReturning([
      { id: "s-0", verdict: "supported" },
      { id: "s-1", verdict: "partial", note: "the figure is not in the source" },
    ]);
    const res = await auditTurn(input, { llm });

    expect(res).not.toBeNull();
    expect(res!.claims).toBe(2);
    expect(res!.supported).toBe(1);
    expect(res!.partial).toBe(1);
    expect(res!.unsupportedRate).toBe(0.5);
    expect(res!.notes).toContain("the figure is not in the source");
  });

  it("reports a clean turn as zero", async () => {
    const llm = llmReturning([
      { id: "s-0", verdict: "supported" },
      { id: "s-1", verdict: "supported" },
    ]);
    const res = await auditTurn(input, { llm });
    expect(res!.unsupportedRate).toBe(0);
  });

  it("judges nothing when there is no source, rather than marking everything unsupported", async () => {
    const llm = llmReturning([]);
    const res = await auditTurn({ ...input, factStatements: [], excerpts: [] }, { llm });

    expect(res).toBeNull();
    expect(llm.object).not.toHaveBeenCalled();
  });

  it("skips a turn that said nothing", async () => {
    const llm = llmReturning([]);
    expect(await auditTurn({ ...input, sentences: [] }, { llm })).toBeNull();
    expect(llm.object).not.toHaveBeenCalled();
  });

  // The audit runs after the response. A failure is a gap in measurement, never a failed turn.
  it("returns null instead of throwing when the model call fails", async () => {
    const llm = { object: vi.fn().mockRejectedValue(new Error("upstream down")) } as unknown as Llm;
    await expect(auditTurn(input, { llm })).resolves.toBeNull();
  });

  it("sends the tutor sentences as claims and the facts and excerpts as sources", async () => {
    const llm = llmReturning([{ id: "s-0", verdict: "supported" }]);
    await auditTurn(input, { llm });

    const [task, , req] = (llm.object as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(task).toBe("turn.audit");
    const sent = JSON.stringify(req);
    expect(sent).toContain("Greet her within thirty seconds.");
    expect(sent).toContain("Greet every customer within thirty seconds.");
    expect(sent).toContain("Branch staff greet customers promptly.");
  });
});
