import { GroundingResult, type GroundingResult as GroundingOutput } from "@/lib/schemas/design";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { DESIGN_PROMPT_VERSION, GROUNDING_TASK } from "../llm/prompts/design";

export interface ClaimItem {
  id: string;
  claim: string;
}

export interface ExcerptItem {
  id: string;
  text: string;
}

/**
 * Grounding check. Evaluates whether claims are supported,
 * partially supported, or unsupported by the provided excerpts.
 */
export async function checkGrounding(
  claims: ClaimItem[],
  excerpts: ExcerptItem[],
  deps: { llm?: Llm; orgId?: string; contentId?: string } = {},
): Promise<GroundingOutput> {
  if (claims.length === 0) {
    return { results: [] };
  }

  if (excerpts.length === 0) {
    return {
      results: claims.map((c) => ({
        id: c.id,
        verdict: "unsupported",
        note: "No excerpts provided to support claim.",
        corrected: null,
      })),
    };
  }

  const llm = deps.llm ?? defaultLlm;

  const excerptsBlock = `<excerpts>\n${excerpts
    .map((e) => `<excerpt id="${e.id}">${e.text}</excerpt>`)
    .join("\n")}\n</excerpts>`;

  const claimsBlock = `<claims>\n${claims
    .map((c) => `<claim id="${c.id}">${c.claim}</claim>`)
    .join("\n")}\n</claims>`;

  const { value } = await llm.object(
    "grounding.check",
    GroundingResult,
    {
      system: GROUNDING_TASK,
      packBlocks: [excerptsBlock],
      history: [],
      final: `${claimsBlock}\nEvaluate grounding for each claim against the excerpts.`,
      orgId: deps.orgId ?? "00000000-0000-0000-0000-000000000000",
      contentId: deps.contentId,
    },
    { promptVersion: DESIGN_PROMPT_VERSION },
  );

  // Guarantee every input claim has a verdict
  const resultMap = new Map(value.results.map((r) => [r.id, r]));
  const results = claims.map((c) => {
    const found = resultMap.get(c.id);
    if (found) return found;
    return {
      id: c.id,
      verdict: "unsupported" as const,
      note: "Claim was not evaluated by the grounding model.",
      corrected: null,
    };
  });

  return { results };
}
