import { GroundingResult, type GroundingResult as GroundingOutput } from "@/lib/schemas/design";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { TURN_AUDIT_TASK } from "../llm/prompts/design";
import { log } from "../obs/logger";

/**
 * Sampled audit of a completed tutor turn (OWASP LLM07 row of the threat model).
 *
 * Everything else in the grounding story checks the material at design time: quotes are
 * verified against chunks, facts get an entailment verdict, fact ids are filtered. None of it
 * checks what the tutor actually said in a turn. This does, after the fact, on a sample, so
 * "unsupported claim rate" is a measured number rather than an assumption.
 *
 * It runs on the fast tier, after the response, and it only logs: it must never hold up a turn
 * or change what the learner already saw.
 */

export interface TurnAuditInput {
  sessionId: string;
  turnId: string;
  orgId: string;
  contentId?: string;
  /** The display sentences as the learner saw them, after the number guard. */
  sentences: string[];
  /** Statements of the facts this turn was allowed to cite. */
  factStatements: string[];
  /** Retrieved excerpts that were in the prompt for this turn. */
  excerpts: string[];
}

export interface TurnAuditSummary {
  turnId: string;
  claims: number;
  supported: number;
  partial: number;
  unsupported: number;
  /** Unsupported plus partial, over claims. The number the eval report quotes. */
  unsupportedRate: number;
  notes: string[];
}

/** True when this turn is in the sample. Rate 0 disables the audit, 1 audits everything. */
export function shouldAudit(rate: number, random = Math.random): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return random() < rate;
}

/**
 * Audits one turn. Returns null when there is nothing to judge, which is the common case for
 * a turn that only asked a question or gave a hint with no factual content.
 */
export async function auditTurn(
  input: TurnAuditInput,
  deps: { llm?: Llm } = {},
): Promise<TurnAuditSummary | null> {
  const sentences = input.sentences.map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return null;

  // With no facts and no excerpts there is nothing to judge against, and calling the model
  // would mark every sentence unsupported for the wrong reason.
  const sources = [...input.factStatements, ...input.excerpts].filter(Boolean);
  if (sources.length === 0) return null;

  const llm = deps.llm ?? defaultLlm;

  const excerptsBlock = `<excerpts>\n${sources
    .map((text, i) => `<excerpt id="src-${i}">${text}</excerpt>`)
    .join("\n")}\n</excerpts>`;
  const claimsBlock = `<claims>\n${sentences
    .map((text, i) => `<claim id="s-${i}">${text}</claim>`)
    .join("\n")}\n</claims>`;

  let value: GroundingOutput;
  try {
    ({ value } = await llm.object("turn.audit", GroundingResult, {
      system: TURN_AUDIT_TASK,
      packBlocks: [excerptsBlock],
      history: [],
      final: `${claimsBlock}\nJudge each sentence the tutor said against the excerpts.`,
      orgId: input.orgId,
      contentId: input.contentId,
    }));
  } catch (err) {
    // An audit that fails is a gap in measurement, never a failed turn.
    log.warn({ event: "turn_audit_failed", sessionId: input.sessionId, turnId: input.turnId, err });
    return null;
  }

  const counts = { supported: 0, partial: 0, unsupported: 0 };
  const notes: string[] = [];
  for (const r of value.results) {
    if (r.verdict === "supported") counts.supported += 1;
    else if (r.verdict === "partial") counts.partial += 1;
    else counts.unsupported += 1;
    if (r.verdict !== "supported" && r.note) notes.push(r.note);
  }

  const claims = value.results.length;
  const summary: TurnAuditSummary = {
    turnId: input.turnId,
    claims,
    ...counts,
    // Partial counts against the rate: half a supported claim is still a claim the material
    // does not carry in the form the learner heard it.
    unsupportedRate: claims > 0 ? (counts.unsupported + counts.partial) / claims : 0,
    notes,
  };

  // Log only. The eval suite aggregates these into a rate.
  log.info({
    event: "turn_audit",
    sessionId: input.sessionId,
    turnId: input.turnId,
    orgId: input.orgId,
    ...counts,
    claims,
    unsupportedRate: Number(summary.unsupportedRate.toFixed(3)),
    // Truncated: a note is a model sentence about the source, and the log is not a transcript.
    notes: notes.slice(0, 3).map((n) => n.slice(0, 160)),
  });

  return summary;
}
