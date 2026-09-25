import { and, eq, inArray, sql } from "drizzle-orm";
import {
  MissionPack,
  MissionWithFactsLoose,
  type MissionPack as MissionPackType,
  type Fact,
  type ConceptOutline as Outline,
} from "@/lib/schemas/design";
import type { z } from "zod";
import type { Config } from "../config/schema";
import { DEFAULT_CONFIG } from "../config/defaults";

/** A pack as the model returned it: parsed loosely, not yet fitted to the strict schema. */
type MissionWithFactsPack = z.infer<typeof MissionWithFactsLoose>["pack"];
import { db as defaultDb, type Db } from "../db/client";
import {
  concepts,
  facts as factsTable,
  journeys,
  learningSessions,
  missions,
  GROUNDING_STATUSES,
} from "../db/schema";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { DESIGN_PROMPT_VERSION, documentBlock, missionTask } from "../llm/prompts/design";
import { chunksFor, loadContent } from "./context";
import { missionKeyOf } from "./outline";
import { verifyQuotes } from "./quote-verify";
import { checkGrounding } from "./grounding";
import { AppError, errors } from "../http/errors";
import { log } from "../obs/logger";

/**
 * Ensure a mission pack is generated and cached.
 * If already ready, returns cached pack.
 * Otherwise atomically generates, verifies quotes on new facts,
 * grounds them, binds questions to supported facts, and persists.
 */
export async function ensureMission(
  missionId: string,
  deps: { db?: Db; llm?: Llm; config?: Config } = {},
): Promise<MissionPackType> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? defaultLlm;
  const config = deps.config ?? DEFAULT_CONFIG;

  // 1. Fetch current mission state
  const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);

  if (!mission) {
    throw errors.notFound("Mission not found.");
  }

  if (mission.packStatus === "ready" && mission.pack) {
    return MissionPack.parse(mission.pack);
  }

  // 2. Claim mission row for generation
  if (mission.packStatus === "generating") {
    // Wait for the build already running, usually the prefetch started during the previous
    // mission. A build takes a minute or more, so the old 15 s wait gave up early and started
    // a second, duplicate build. Every 2 s, the fastest this project polls the database.
    for (let i = 0; i < 75; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const [poll] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
      if (poll?.packStatus === "ready" && poll.pack) {
        return MissionPack.parse(poll.pack);
      }
      if (poll?.packStatus === "failed") {
        throw new AppError("INTERNAL_ERROR", 500, "Mission pack generation failed.");
      }
    }
  }

  await db
    .update(missions)
    .set({
      packStatus: "generating",
      promptVersion: DESIGN_PROMPT_VERSION,
    })
    .where(eq(missions.id, missionId));

  try {
    // 3. Load journey, outline and content
    const [journey] = await db
      .select()
      .from(journeys)
      .where(eq(journeys.id, mission.journeyId))
      .limit(1);

    if (!journey) {
      throw errors.notFound("Journey not found for mission.");
    }

    const outline = journey.outline as Outline | null;
    const chapter = outline?.chapters?.find((c) => c.key === mission.chapterKey);
    const outlineMission = chapter?.missions?.find(
      (m) =>
        m.key ===
        (outline ? missionKeyOf(outline, mission.chapterKey, mission.ordinal) : undefined),
    );

    const missionConceptIds = mission.conceptIds ?? [];
    const conceptRows =
      missionConceptIds.length > 0
        ? await db.select().from(concepts).where(inArray(concepts.id, missionConceptIds))
        : [];
    const conceptKeyToId = new Map(conceptRows.map((c) => [c.key, c.id]));

    // 4. Load existing verified facts for these concepts
    const existingFacts =
      missionConceptIds.length > 0
        ? await db
            .select()
            .from(factsTable)
            .where(
              and(
                inArray(factsTable.conceptId, missionConceptIds),
                eq(factsTable.quoteVerified, true),
              ),
            )
        : [];

    const existingFactsBlock = `<existing_facts>\n${existingFacts
      .map(
        (f) =>
          `<fact id="${f.id}" concept="${
            conceptRows.find((c) => c.id === f.conceptId)?.key ?? ""
          }">${f.statement}</fact>`,
      )
      .join("\n")}\n</existing_facts>`;

    // 5. Load content and chunks
    const content = await loadContent(journey.contentId, journey.orgId, db);
    const neededChunkIds = conceptRows.flatMap((c) => c.chunkIds);
    let chunks = chunksFor(content, neededChunkIds, 24_000);
    if (chunks.length === 0) {
      chunks = content.quotable.slice(0, 30);
    }

    // 6. Generate via LLM design tier
    const personaDomains = config.personas.map((p) => p.exampleDomain);
    const taskPrompt = missionTask({
      missionKey: outlineMission?.key ?? `m_${mission.ordinal + 1}`,
      missionTitle: mission.title,
      objective: outlineMission?.objective ?? `Learn and practice ${mission.title}`,
      conceptKeys: conceptRows.map((c) => c.key),
      mechanic: mission.primaryMechanic,
      alternates: mission.alternates ?? [],
      personaDomains,
    });

    const { value: raw } = await llm.object(
      "mission.generate",
      MissionWithFactsLoose,
      {
        system: taskPrompt,
        packBlocks: [documentBlock(chunks), existingFactsBlock],
        history: [],
        final: "Generate the mission pack and any needed new facts as JSON matching the schema.",
        orgId: journey.orgId,
        contentId: journey.contentId,
      },
      { promptVersion: DESIGN_PROMPT_VERSION },
    );

    // 7. Verify quotes and grounding on new facts
    const rawFacts: Fact[] = (raw.newFacts || []) as Fact[];
    const { kept, dropped } = verifyQuotes(rawFacts, content.quotable);

    let keptFactMap = new Map<string, string>();
    if (kept.length > 0) {
      const claims = kept.map((f) => ({ id: f.id, claim: f.statement }));
      const excerpts = chunks.map((c) => ({ id: c.id, text: c.text }));
      const grounding = await checkGrounding(claims, excerpts, {
        llm,
        orgId: journey.orgId,
        contentId: journey.contentId,
      });
      const gMap = new Map(grounding.results.map((r) => [r.id, r]));

      const newFactValues = kept
        .map((f) => {
          const cId = conceptKeyToId.get(f.conceptKey);
          if (!cId) return null;
          const g = gMap.get(f.id);
          // Partial is defined as "with a corrected statement that is
          // supported". The correction was being thrown away and the exact wording the
          // grounding model flagged as half unsupported was what the tutor taught. The
          // anchors are source spans and verify either way, so the corrected wording is no
          // less checked than the original, and it is the one judged supported.
          const corrected = g?.verdict === "partial" ? (g.corrected ?? null) : null;
          const note = corrected
            ? `Corrected from: ${f.statement}${g?.note ? ` (${g.note})` : ""}`
            : (g?.note ?? null);
          return {
            contentId: journey.contentId,
            conceptId: cId,
            key: f.id,
            statement: corrected ?? f.statement,
            anchors: f.anchors,
            quoteVerified: true,
            groundingStatus: (g?.verdict as (typeof GROUNDING_STATUSES)[number]) ?? "pending",
            groundingNote: note,
            checkedAt: new Date(),
            promptVersion: DESIGN_PROMPT_VERSION,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      if (newFactValues.length > 0) {
        // Upsert on (content_id, key). Concepts are no longer deleted on a re-design, so
        // nothing clears the previous generation's facts, and a plain insert would leave two
        // rows sharing one key with different statements.
        await db
          .insert(factsTable)
          .values(newFactValues)
          .onConflictDoUpdate({
            target: [factsTable.contentId, factsTable.key],
            set: {
              conceptId: sql`excluded.concept_id`,
              statement: sql`excluded.statement`,
              anchors: sql`excluded.anchors`,
              quoteVerified: sql`excluded.quote_verified`,
              groundingStatus: sql`excluded.grounding_status`,
              groundingNote: sql`excluded.grounding_note`,
              checkedAt: sql`excluded.checked_at`,
              promptVersion: sql`excluded.prompt_version`,
            },
          });
      }
      // A fact the grounding model judged unsupported is stored, so the verdict is auditable,
      // but it is not a citation the pack may use: the question and hint text written from it
      // would otherwise ship with a source chip that does not support it.
      keptFactMap = new Map(
        kept
          .filter((f) => gMap.get(f.id)?.verdict !== "unsupported")
          .map((f) => [f.id, f.id] as const),
      );
    }

    // 8. Bind questions to valid fact IDs and repair pack if needed
    const validFactIds = new Set([
      ...existingFacts.map((f) => f.id),
      ...Array.from(keptFactMap.keys()),
    ]);
    if (validFactIds.size === 0) {
      throw new AppError(
        "NO_FACTS",
        422,
        "No verifiable facts could be drawn from this material for the mission, so it cannot be generated. Try a fuller document.",
      );
    }
    const pack = raw.pack;

    // An element whose every fact failed verification was written from material that did not
    // survive. Citing whatever fact happens to be first in the set keeps the unsupported text
    // and gives it a source chip that opens a chunk which does not support it, so the element
    // goes instead (regenerated once or dropped).
    const droppedForFacts: string[] = [];
    pack.questions = pack.questions.filter((q) => {
      q.factIds = q.factIds.filter((id: string) => validFactIds.has(id));
      if (q.factIds.length === 0) {
        droppedForFacts.push(`question ${q.id}`);
        return false;
      }
      if (q.options) {
        for (const opt of q.options) {
          opt.factIds = opt.factIds.filter((id: string) => validFactIds.has(id));
          if (opt.factIds.length === 0) opt.factIds = [q.factIds[0]!];
        }
      }
      if (q.answerKey?.keyPoints) {
        q.answerKey.keyPoints = q.answerKey.keyPoints.filter((kp) => {
          kp.factIds = kp.factIds.filter((id: string) => validFactIds.has(id));
          return kp.factIds.length > 0;
        });
        // An answer graded against key points, with none left, cannot be graded.
        if (q.answerKey.keyPoints.length === 0) {
          droppedForFacts.push(`question ${q.id} (no gradable key points)`);
          return false;
        }
      }
      while (q.hints.length < 3) {
        q.hints.push("Review the chapter policy guidelines.");
      }
      if (q.hints.length > 3) q.hints = q.hints.slice(0, 3);
      return true;
    });

    // Filtering can leave a part below the minimum the pack schema needs. That used to throw a
    // raw ZodError after the whole mission was paid for, and the learner saw "designing the
    // journey failed". An optional part that is too thin to use is dropped instead; only too
    // few questions fails the mission, since questions are what the engine walks.
    if (pack.questions.length < 2) {
      throw new AppError(
        "NO_FACTS",
        422,
        "Too few questions for this mission could be verified against the source, so it cannot be generated. Try a fuller document.",
      );
    }

    if (pack.roleplay?.behaviors) {
      pack.roleplay.behaviors = pack.roleplay.behaviors.filter((b) => {
        b.factIds = b.factIds.filter((id: string) => validFactIds.has(id));
        return b.factIds.length > 0;
      });
      if (pack.roleplay.behaviors.length < 3) {
        droppedForFacts.push("roleplay (fewer than 3 verified behaviours)");
        pack.roleplay = null;
      }
    }
    if (pack.teachBack?.keyPoints) {
      pack.teachBack.keyPoints = pack.teachBack.keyPoints.filter((kp) => {
        kp.factIds = kp.factIds.filter((id: string) => validFactIds.has(id));
        return kp.factIds.length > 0;
      });
      if (pack.teachBack.keyPoints.length < 2) {
        droppedForFacts.push("teach-back (fewer than 2 verified key points)");
        pack.teachBack = null;
      }
    }
    while (pack.callbacks.length < 2) {
      pack.callbacks.push({
        id: `cb_${pack.callbacks.length + 1}`,
        conceptKey: conceptRows[0]?.key ?? "c_general",
        prompt: "What is the primary check required for this task?",
        keyPoints: ["Verify identity with original document"],
      });
    }
    if (pack.callbacks.length > 2) pack.callbacks = pack.callbacks.slice(0, 2);

    const checked = fitPack(pack, droppedForFacts);
    if (droppedForFacts.length > 0) {
      log.warn({
        event: "mission_pack_elements_dropped",
        missionId: mission.id,
        dropped: droppedForFacts,
      });
    }
    if (!checked.success) {
      log.warn({
        event: "mission_pack_invalid",
        missionId: mission.id,
        issues: checked.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      throw pack.questions.length < 2
        ? new AppError(
            "NO_FACTS",
            422,
            "Too few usable questions came out of this material for the mission. Try again, or try a fuller document.",
          )
        : new AppError(
            "INTERNAL_ERROR",
            502,
            "The mission came back in a shape we could not use. Try again; if it keeps happening, try a fuller document.",
          );
    }
    const validatedPack = checked.data;

    // 9. Persist ready pack to database
    await db
      .update(missions)
      .set({
        pack: validatedPack,
        packStatus: "ready",
        groundingSummary: {
          existingFactsCount: existingFacts.length,
          newFactsKept: kept.length,
          newFactsDropped: dropped.length,
        },
        promptVersion: DESIGN_PROMPT_VERSION,
        generatedAt: new Date(),
      })
      .where(eq(missions.id, missionId));

    return validatedPack;
  } catch (err) {
    await db.update(missions).set({ packStatus: "failed" }).where(eq(missions.id, missionId));
    throw err;
  }
}

/**
 * Fits a generated pack to the strict schema by removing what does not fit, instead of
 * failing a mission the model mostly got right. On 21 Sep one matching question with 3
 * pairs (the schema wants 4 to 6) failed a whole journey after two paid design calls.
 *
 * A question that breaks a rule is dropped; roleplay or teach-back that breaks one is
 * dropped (both are optional); lists that run long are trimmed. Anything else, and fewer
 * than 2 questions left, still fails: those have no safe repair. Mutates `pack`.
 */
export function fitPack(
  pack: MissionWithFactsPack,
  dropped: string[],
): ReturnType<typeof MissionPack.safeParse> {
  for (let pass = 0; pass < 4; pass++) {
    const result = MissionPack.safeParse(pack);
    if (result.success) return result;
    const badQuestions = new Set<number>();
    for (const issue of result.error.issues) {
      const [head, index, field] = issue.path;
      if (head === "questions" && typeof index === "number") badQuestions.add(index);
      else if (head === "roleplay" && pack.roleplay) {
        dropped.push(`roleplay (${issue.message})`);
        pack.roleplay = null;
      } else if (head === "teachBack" && pack.teachBack) {
        dropped.push(`teach-back (${issue.message})`);
        pack.teachBack = null;
      } else if (head === "alternates") pack.alternates = pack.alternates.slice(0, 2);
      else if (head === "beats" && index === undefined && issue.code === "too_big")
        pack.beats = pack.beats.slice(0, 8);
      else if (head === "beats" && typeof index === "number" && field === "text") {
        const beat = pack.beats[index];
        if (beat) beat.text = `${beat.text.slice(0, 597)}...`;
      } else return result;
    }
    if (badQuestions.size > 0) {
      for (const i of badQuestions) dropped.push(`question ${pack.questions[i]?.id} (off shape)`);
      pack.questions = pack.questions.filter((_, i) => !badQuestions.has(i));
    }
  }
  return MissionPack.safeParse(pack);
}

/**
 * Prefetch the next mission in the journey for a session.
 */
export async function prefetchNext(
  sessionId: string,
  deps: { db?: Db; llm?: Llm; config?: Config } = {},
): Promise<void> {
  const db = deps.db ?? defaultDb;

  const [session] = await db
    .select({
      id: learningSessions.id,
      journeyId: learningSessions.journeyId,
      currentMissionId: learningSessions.currentMissionId,
    })
    .from(learningSessions)
    .where(eq(learningSessions.id, sessionId))
    .limit(1);

  if (!session || !session.currentMissionId) return;

  const [current] = await db
    .select({ ordinal: missions.ordinal })
    .from(missions)
    .where(eq(missions.id, session.currentMissionId))
    .limit(1);

  if (!current) return;

  const [next] = await db
    .select({ id: missions.id, packStatus: missions.packStatus })
    .from(missions)
    .where(
      and(eq(missions.journeyId, session.journeyId), eq(missions.ordinal, current.ordinal + 1)),
    )
    .limit(1);

  // Only a mission nobody has started. One already generating is someone else's build, and a
  // failed one is retried when a learner reaches it, not on every turn at the model's expense.
  if (next && next.packStatus === "pending") {
    await ensureMission(next.id, deps);
  }
}
