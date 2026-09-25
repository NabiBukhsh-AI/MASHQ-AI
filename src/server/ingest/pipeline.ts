import { eq } from "drizzle-orm";
import { loadContent } from "../design/context";
import { prepareContent } from "./prepare";
import { contents, journeys } from "../db/schema";
import { generateOutline } from "../design/outline";
import { ensureMission } from "../design/missions";
import { buildGlossary } from "../design/glossary";
import { getOrgConfig } from "../config/service";
import type { Config } from "../config/schema";
import { db as defaultDb, type Db } from "../db/client";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { log } from "../obs/logger";

export type PipelineSend = (event: string, data: unknown) => void;

export interface PipelineOptions {
  deadlineMs?: number;
  send: PipelineSend;
  signal?: AbortSignal;
}

export interface PipelineResult {
  journeyId: string;
  missionId?: string;
}

/**
 * Ingestion pipeline (single stage with a 240 s guard).
 * Sequences outline generation, Mission 1 practice pack creation, and glossary extraction.
 * Streams SSE events: stage.start, stage.done, outline.partial, mission.ready, playable, done, error.
 */
export async function runPipeline(
  contentId: string,
  orgId: string,
  opts: PipelineOptions,
  deps: { db?: Db; llm?: Llm; config?: Config } = {},
): Promise<PipelineResult> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? defaultLlm;
  const deadlineMs = opts.deadlineMs ?? 240_000;
  const startAt = Date.now();

  const isTimedOut = () => Date.now() - startAt >= deadlineMs;

  try {
    // 0. Stage: prepare (normalize, redact, scan, chunk, store). Idempotent.
    const config = deps.config ?? (await getOrgConfig(orgId)).config;
    opts.send("stage.start", {
      stage: "prepare",
      name: "Cleaning, redacting and splitting the text",
    });
    const prepared = await prepareContent(contentId, orgId, config, db);
    for (const w of prepared.warnings) opts.send("warning", { code: "PREPARE", message: w });
    opts.send("stage.done", {
      stage: "prepare",
      chunks: prepared.chunks,
      redactions: prepared.redactions,
      injectionFlags: prepared.injectionFlags,
      reused: prepared.reused,
      // The document's language, as the uploader set it or as detected. The client uses it to
      // preselect the practice language, which is what picks the tutor's voice.
      language: prepared.langPrimary,
    });

    // 1. Stage: Load content
    opts.send("stage.start", { stage: "load", name: "Loading and verifying document" });
    const content = await loadContent(contentId, orgId, db);

    const flaggedCount = content.chunks.filter((c) => c.injectionFlag).length;
    if (flaggedCount > 0) {
      opts.send("warning", {
        code: "FLAGGED_CHUNKS",
        message: `${flaggedCount} passage(s) were flagged by injection scan and held back.`,
      });
    }
    opts.send("stage.done", { stage: "load", chunks: content.chunks.length });

    if (isTimedOut()) {
      opts.send("continue", { stage: "outline" });
      return { journeyId: "" };
    }

    // 2. Stage: Outline generation
    opts.send("stage.start", { stage: "outline", name: "Mapping concepts and chapters" });

    const outlineRes = await generateOutline(
      content,
      config,
      (ev, data) => {
        opts.send(ev, data);
      },
      { db, llm },
    );
    opts.send("stage.done", { stage: "outline", reused: outlineRes.reused });

    if (isTimedOut()) {
      opts.send("continue", { stage: "mission_1" });
      return { journeyId: outlineRes.journeyId };
    }

    // 3. Stage: Mission 1 generation
    let firstMissionId: string | undefined;
    if (outlineRes.missionIds.length > 0) {
      const firstMission = outlineRes.missionIds[0]!;
      firstMissionId = firstMission.id;
      opts.send("stage.start", { stage: "mission_1", name: "Generating practice mission 1" });

      const pack = await ensureMission(firstMission.id, { db, llm, config });
      opts.send("mission.ready", {
        missionId: firstMission.id,
        key: firstMission.key,
        title: pack.title,
      });
      opts.send("stage.done", { stage: "mission_1" });
    }

    // 4. Stage: Glossary extraction
    // Glossary is not blocking for the first mission: a failure is a warning.
    opts.send("stage.start", { stage: "glossary", name: "Extracting domain glossary" });
    try {
      const terms = await buildGlossary(contentId, { db, llm });
      opts.send("stage.done", { stage: "glossary", count: terms.length });
    } catch (err) {
      log.warn({ event: "glossary_failed", contentId, err });
      opts.send("warning", {
        code: "GLOSSARY",
        message: "The glossary could not be built this time; the journey works without it.",
      });
      opts.send("stage.done", { stage: "glossary", count: 0, failed: true });
    }

    // 5. Completion: content and journey become ready, then the playable signal.
    await db.update(journeys).set({ status: "ready" }).where(eq(journeys.id, outlineRes.journeyId));
    await db.update(contents).set({ status: "ready" }).where(eq(contents.id, contentId));
    opts.send("playable", {
      journeyId: outlineRes.journeyId,
      missionId: firstMissionId,
      title: outlineRes.outline.title,
    });
    opts.send("done", { journeyId: outlineRes.journeyId });

    log.info({
      event: "pipeline_done",
      contentId,
      journeyId: outlineRes.journeyId,
      durationMs: Date.now() - startAt,
    });

    return {
      journeyId: outlineRes.journeyId,
      missionId: firstMissionId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ event: "pipeline_failed", contentId, err });
    await db
      .update(contents)
      .set({ status: "failed" })
      .where(eq(contents.id, contentId))
      .catch(() => undefined);
    opts.send("error", { message: publicMessage(err) });
    throw err;
  }
}

/** Errors we wrote for people pass through; anything else gets a generic line. */
function publicMessage(err: unknown): string {
  if (err && typeof err === "object" && "publicMessage" in err)
    return String((err as { publicMessage: string }).publicMessage);
  return "Designing the journey failed on our side. Try again in a moment; if it keeps failing, paste a shorter section.";
}
