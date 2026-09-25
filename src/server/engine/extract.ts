import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb } from "../db/client";
import { evidenceEvents, learningSessions, turns } from "../db/schema/learning";
import { concepts } from "../db/schema/journey";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { buildEngineRequest } from "./prompt";
import { buildEvidence } from "./evidence";
import { resolveOrgConfig } from "../config/service";
import type { Lang } from "../config/schema";
import { log } from "../obs/logger";
import { uuidv7 } from "@/lib/ids";
import { masteryParams } from "./mastery";
import { loadMastery, replayConcept } from "./mastery-store";

export const ExtractedEvidenceLine = z.object({
  concept: z.string(),
  signal: z
    .enum([
      "choice",
      "puzzle",
      "decision",
      "free_text",
      "explanation",
      "application",
      "teach_back",
      "retention",
      "question",
    ])
    .or(z.string()),
  verdict: z.enum(["correct", "partial", "incorrect", "na", "not_an_answer"]).or(z.string()),
  score: z.number().min(0).max(1),
  accuracy: z.number().min(0).max(1).optional(),
  self_correction: z.boolean().optional(),
  misconception: z.string().nullable().optional(),
  confidence_cue: z.string().optional(),
  lang: z.string().optional(),
  quote: z.string().optional(),
  reason: z.string().optional(),
});

export type ExtractedEvidenceLine = z.infer<typeof ExtractedEvidenceLine>;

export interface ExtractorDeps {
  db?: typeof defaultDb;
  llm?: Pick<Llm, "stream">;
  resolveConfig?: typeof resolveOrgConfig;
  /** Mastery replay after a corrected row (mastery-store.replayConcept). */
  replay?: typeof replayConcept;
}

export interface ExtractorResult {
  success: boolean;
  turnId: string;
  disagreements: number;
  extractedCount: number;
  replayTriggered: boolean;
  provisionalKept: boolean;
  error?: string;
}

/**
 * Parses raw text from an EXTRACT model response to extract @@e evidence lines.
 */
export function parseExtractedEvidence(text: string): ExtractedEvidenceLine[] {
  const lines = text.split("\n");
  const result: ExtractedEvidenceLine[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("@@e ")) continue;
    const jsonStr = line.slice(4).trim();
    try {
      const parsedJson = JSON.parse(jsonStr);
      const validated = ExtractedEvidenceLine.safeParse(parsedJson);
      if (validated.success) {
        result.push(validated.data);
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return result;
}

/**
 * Checks whether an extracted evidence item disagrees significantly with a provisional row.
 */
export function hasDisagreement(
  provisional: typeof evidenceEvents.$inferSelect,
  extracted: ExtractedEvidenceLine,
): boolean {
  // Disagreement in verdict classification
  if (provisional.verdict !== extracted.verdict) {
    return true;
  }

  // Disagreement in score beyond 0.15
  if (Math.abs(provisional.score - extracted.score) > 0.15) {
    return true;
  }

  // Disagreement in identified misconception
  const provMis = provisional.misconceptionId ?? null;
  const extMis = extracted.misconception ?? null;
  if (provMis !== extMis) {
    return true;
  }

  return false;
}

/**
 * Runs the asynchronous evidence extractor for a completed turn.
 * If the extractor disagrees with the provisional verdict, updates the row (source = 'extractor')
 * and signals a replay trigger.
 * If the extractor fails, leaves provisional rows intact.
 */
export async function runExtractor(
  turnId: string,
  deps: ExtractorDeps = {},
): Promise<ExtractorResult> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? defaultLlm;
  const resolveConfig = deps.resolveConfig ?? resolveOrgConfig;
  const replay = deps.replay ?? replayConcept;

  try {
    // 1. Fetch learner turn
    const [turn] = await db.select().from(turns).where(eq(turns.id, turnId)).limit(1);

    if (!turn || turn.role !== "learner") {
      return {
        success: false,
        turnId,
        disagreements: 0,
        extractedCount: 0,
        replayTriggered: false,
        provisionalKept: true,
        error: "Learner turn not found",
      };
    }

    // 2. Fetch session
    const [session] = await db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.id, turn.sessionId))
      .limit(1);

    if (!session) {
      return {
        success: false,
        turnId,
        disagreements: 0,
        extractedCount: 0,
        replayTriggered: false,
        provisionalKept: true,
        error: "Session not found",
      };
    }

    // 3. Resolve config
    const resolved = await resolveConfig(
      {
        orgId: session.orgId,
        personaId: session.personaId,
        presets: session.presets,
        learnerChoices: { language: session.language as Lang },
      },
      db,
    );
    const config = resolved.config;

    // 4. Fetch provisional evidence rows already recorded for this turn
    const provisionalRows = await db
      .select()
      .from(evidenceEvents)
      .where(eq(evidenceEvents.turnId, turnId));

    // 5. Fetch preceding tutor turn for context (most recent before learner)
    const [prevTutorTurn] = await db
      .select()
      .from(turns)
      .where(and(eq(turns.sessionId, session.id), eq(turns.role, "tutor")))
      .orderBy(desc(turns.ordinal))
      .limit(1);

    // 6. Build EXTRACT request
    // Map existing concept IDs for lookup
    const orgConcepts = await db
      .select({ id: concepts.id, key: concepts.key, name: concepts.name })
      .from(concepts)
      .where(eq(concepts.orgId, session.orgId));

    const conceptMap = new Map<string, string>();
    for (const c of orgConcepts) {
      conceptMap.set(c.id, c.id);
      if (c.key) conceptMap.set(c.key, c.id);
    }

    // Call model with TASK: EXTRACT
    const engineReq = buildEngineRequest({
      task: "EXTRACT",
      session: session.id,
      history: prevTutorTurn?.text
        ? [
            {
              role: "assistant",
              content: prevTutorTurn.text,
            },
          ]
        : [],
      learnerInput: turn.text ?? "",
      inputMode: turn.inputMode ?? "text",
      detectedLang: turn.lang ?? session.language,
      config: { orgId: session.orgId },
    });

    const callResult = await llm.stream("turn.extract_evidence", {
      system: engineReq.system,
      packBlocks: [engineReq.packBlock],
      history: engineReq.history.map((h) => ({ role: h.role, text: h.content })),
      final: engineReq.final,
      orgId: session.orgId,
      sessionId: session.id,
      lang: session.language as Lang,
    });
    let fullText = "";
    for await (const chunk of callResult.textStream) {
      fullText += chunk;
    }

    const extractedItems = parseExtractedEvidence(fullText);
    let disagreements = 0;
    let replayTriggered = false;
    const replayedConcepts: string[] = [];

    for (const item of extractedItems) {
      // Resolve concept ID
      const resolvedConceptId =
        conceptMap.get(item.concept) ??
        provisionalRows.find((p) => p.conceptId === item.concept)?.conceptId ??
        provisionalRows[0]?.conceptId;

      if (!resolvedConceptId) continue;

      const provisional = provisionalRows.find((p) => p.conceptId === resolvedConceptId);

      if (!provisional) {
        // Extractor found evidence for a concept not covered provisionally. The row chains
        // from the learner's current P for that concept (or the persona prior), not a literal.
        const persona =
          config.personas.find((p) => p.id === session.personaId) ?? config.personas[0]!;
        const current = await loadMastery(
          { userId: session.userId, conceptId: resolvedConceptId },
          masteryParams(config, persona.pInit),
          db,
        );
        const newEv = buildEvidence(
          {
            verdict: item.verdict,
            score: item.score,
            self_correction: item.self_correction,
            misconception: item.misconception,
            confidence_cue: item.confidence_cue,
            lang: item.lang,
          },
          {
            orgId: session.orgId,
            userId: session.userId,
            sessionId: session.id,
            turnId: turn.id,
            conceptId: resolvedConceptId,
            missionId: turn.missionId ?? undefined,
            signal: item.signal,
            lang: item.lang ?? turn.lang ?? session.language,
            modality: turn.inputMode ?? "text",
            source: "extractor",
            pBefore: current.p,
          },
          config,
        );

        await db.insert(evidenceEvents).values({
          id: uuidv7(),
          ...newEv,
        });
        replayedConcepts.push(resolvedConceptId);

        disagreements++;
        replayTriggered = true;
      } else if (hasDisagreement(provisional, item)) {
        // Disagreement detected: update the provisional row with extractor verdict
        const recalculated = buildEvidence(
          {
            verdict: item.verdict,
            score: item.score,
            self_correction: item.self_correction,
            misconception: item.misconception,
            confidence_cue: item.confidence_cue,
            lang: item.lang,
          },
          {
            orgId: session.orgId,
            userId: session.userId,
            sessionId: session.id,
            turnId: turn.id,
            conceptId: resolvedConceptId,
            missionId: turn.missionId ?? provisional.missionId ?? undefined,
            questionId: provisional.questionId ?? undefined,
            signal: item.signal || provisional.signal,
            hintLevel: provisional.hintLevel,
            pBefore: provisional.pBefore,
            lang: item.lang ?? provisional.lang ?? undefined,
            modality: provisional.modality ?? undefined,
            source: "extractor",
          },
          config,
        );

        await db
          .update(evidenceEvents)
          .set({
            verdict: recalculated.verdict,
            score: recalculated.score,
            signal: recalculated.signal,
            guess: recalculated.guess,
            credit: recalculated.credit,
            weight: recalculated.weight,
            pAfter: recalculated.pAfter,
            misconceptionId: recalculated.misconceptionId,
            selfCorrected: recalculated.selfCorrected,
            confidence: recalculated.confidence,
            source: "extractor",
          })
          .where(eq(evidenceEvents.id, provisional.id));

        disagreements++;
        replayTriggered = true;
      }
    }

    // A corrected row means mastery is recomputed from the log.
    if (replayTriggered) {
      const persona =
        config.personas.find((p) => p.id === session.personaId) ?? config.personas[0]!;
      const params = masteryParams(config, persona.pInit);
      const touched = new Set(
        [...provisionalRows.map((r) => r.conceptId), ...replayedConcepts].filter(Boolean),
      );
      for (const conceptId of touched) {
        await replay(
          { userId: session.userId, conceptId, orgId: session.orgId },
          params,
          resolved.version,
          db,
        );
      }
    }

    return {
      success: true,
      turnId,
      disagreements,
      extractedCount: extractedItems.length,
      replayTriggered,
      provisionalKept: true,
    };
  } catch (err) {
    // Extractor failures must leave provisional rows intact
    log.warn({
      event: "extractor_failed",
      turnId,
      err: String(err),
    });

    return {
      success: false,
      turnId,
      disagreements: 0,
      extractedCount: 0,
      replayTriggered: false,
      provisionalKept: true,
      error: String(err),
    };
  }
}
