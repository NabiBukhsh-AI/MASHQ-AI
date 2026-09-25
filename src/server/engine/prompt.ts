import crypto from "crypto";
import {
  buildEngineSystemPrompt,
  buildContentPackBlock,
  buildFinalMessage,
  type ContentPackBlockOptions,
  type FinalMessageOptions,
} from "../llm/prompts/engine";
import { getCanary } from "../security/canary";

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface EngineRequest {
  system: string;
  packBlock: string;
  history: HistoryTurn[];
  final: string;
  orgId: string;
  sessionId?: string;
  contentId?: string;
  cached: boolean;
  breakpoints: number[];
  estimatedTokens: number;
}

export interface BuildEngineRequestParams {
  task?: "RESPOND" | "GRADE" | "EXTRACT";
  session?: string;
  pack?: Partial<ContentPackBlockOptions> & {
    id?: string;
    chapterKey?: string;
    hash?: string;
  };
  history?: HistoryTurn[];
  moves?: Record<string, unknown>;
  learnerInput?: string;
  config?: { orgId?: string };
  persona?: string;
  language?: string;
  register?: "colleague" | "formal";
  speechMode?: "none" | "mirror" | "normalize" | "llm";
  deploymentId?: string;
  excerptsForThisTurn?: string;
  missionId?: string;
  missionTitle?: string;
  beat?: string;
  mechanic?: string;
  questionId?: string;
  attempts?: number;
  hintLevel?: number;
  allowedFactIds?: string[];
  learnerState?: string;
  interrupted?: boolean;
  singleMove?: { id: string; type: string; params?: Record<string, unknown> };
  questionKind?: string;
  personaDescription?: string;
  grounding?: "strict" | "assisted";
  inputMode?: string;
  detectedLang?: string;
}

/**
 * Calculates a canonical SHA-256 hash of a content pack.
 */
export function packHash(pack: unknown): string {
  if (!pack) return "empty_pack_hash";
  const str =
    typeof pack === "string" ? pack : JSON.stringify(pack, Object.keys(pack as object).sort());
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

/**
 * Estimates token count using standard 4 characters per token heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Builds an EngineRequest with three cached layers and an un-cached final message.
 * Volatile inputs (persona, language, register, moves, learnerInput) sit exclusively in the final message.
 */
export function buildEngineRequest(params: BuildEngineRequestParams): EngineRequest {
  const canary = getCanary(params.deploymentId || "dev");
  const system = buildEngineSystemPrompt({ canary });

  const resolvedPackHash = params.pack?.packHash || packHash(params.pack);
  const packBlock = buildContentPackBlock({
    contentId: params.pack?.contentId || "content_pack_default",
    chapterKey: params.pack?.chapterKey || "chapter_1",
    packHash: resolvedPackHash,
    outline: params.pack?.outline,
    characters: params.pack?.characters,
    glossary: params.pack?.glossary,
    concepts: params.pack?.concepts,
    facts: params.pack?.facts,
    misconceptions: params.pack?.misconceptions,
    missions: params.pack?.missions,
    excerpts: params.pack?.excerpts,
  });

  const finalOpts: FinalMessageOptions = {
    task: params.task || "RESPOND",
    language: params.language,
    register: params.register,
    speechMode: params.speechMode,
    persona: params.persona,
    missionId: params.missionId,
    missionTitle: params.missionTitle,
    beat: params.beat,
    mechanic: params.mechanic,
    questionId: params.questionId,
    attempts: params.attempts,
    hintLevel: params.hintLevel,
    movesByVerdict: params.moves,
    singleMove: params.singleMove,
    questionKind: params.questionKind,
    personaDescription: params.personaDescription,
    grounding: params.grounding,
    inputMode: params.inputMode === "voice" ? "voice" : "text",
    detectedLang: params.detectedLang,
    allowedFactIds: params.allowedFactIds,
    learnerState: params.learnerState,
    interrupted: params.interrupted,
    excerptsForThisTurn: params.excerptsForThisTurn,
    learnerInput: params.learnerInput,
  };

  const final = buildFinalMessage(finalOpts);
  const history = params.history || [];

  // Breakpoints: Breakpoint 1 after content pack block (end of prefix layer 2);
  // Breakpoint 2 after history window if history turns are present.
  const breakpoints: number[] = [1];
  if (history.length > 0) {
    breakpoints.push(2);
  }

  const prefixText = `${system}\n\n${packBlock}`;
  const totalPrefixTokens = estimateTokens(prefixText);

  return {
    system,
    packBlock,
    history,
    final,
    orgId: params.config?.orgId || "default",
    sessionId: params.session,
    contentId: params.pack?.contentId || "content_pack_default",
    cached: true,
    breakpoints,
    estimatedTokens: totalPrefixTokens,
  };
}

export const CACHE_FLOORS = {
  fast: 4096,
  design: 1024,
};

export interface TopUpMaterial {
  additionalExcerpts?: string[];
  workedExamples?: string[];
  glossaryTerms?: string[];
}

/**
 * Ensures the prefix clears the minimum cache floor for the provider tier.
 * Fast tier floor is 4,096 tokens; design tier floor is 1,024 tokens.
 * Tops up with useful educational material in priority order or marks uncached. Never filler.
 */
export function ensureCacheFloor(
  request: EngineRequest,
  tier: "fast" | "design" = "fast",
  topUpMaterial?: TopUpMaterial,
): EngineRequest {
  const floor = CACHE_FLOORS[tier] ?? CACHE_FLOORS.fast;
  const prefixText = `${request.system}\n\n${request.packBlock}`;
  let currentTokens = estimateTokens(prefixText);

  if (currentTokens >= floor) {
    request.cached = true;
    request.estimatedTokens = currentTokens;
    return request;
  }

  // Attempt top up with legitimate educational content
  if (topUpMaterial) {
    const additions: string[] = [];

    // 1. More chapter excerpts
    if (topUpMaterial.additionalExcerpts && topUpMaterial.additionalExcerpts.length > 0) {
      additions.push(
        `<additional_excerpts>\n${topUpMaterial.additionalExcerpts.join("\n")}\n</additional_excerpts>`,
      );
    }

    // 2. Worked examples from other missions in the chapter
    if (topUpMaterial.workedExamples && topUpMaterial.workedExamples.length > 0) {
      additions.push(
        `<worked_examples>\n${topUpMaterial.workedExamples.join("\n")}\n</worked_examples>`,
      );
    }

    // 3. Glossary definitions
    if (topUpMaterial.glossaryTerms && topUpMaterial.glossaryTerms.length > 0) {
      additions.push(
        `<glossary_supplement>\n${topUpMaterial.glossaryTerms.join("\n")}\n</glossary_supplement>`,
      );
    }

    if (additions.length > 0) {
      request.packBlock += `\n${additions.join("\n")}`;
      currentTokens = estimateTokens(`${request.system}\n\n${request.packBlock}`);
    }
  }

  // If still below floor, the call runs uncached
  if (currentTokens < floor) {
    request.cached = false;
  } else {
    request.cached = true;
  }

  request.estimatedTokens = currentTokens;
  return request;
}
