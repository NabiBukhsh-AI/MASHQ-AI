import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { contents, facts, journeys, learningSessions, missions, turns } from "../db/schema";
import { errors } from "../http/errors";
import type { Config, Lang } from "../config/schema";
import { MissionPack } from "@/lib/schemas/design";
import { currentQuestion, EMPTY_STATE, uiPayload, type TurnState } from "./policy";

export interface CreateSessionParams {
  journeyId: string;
  userId: string;
  orgId: string;
  personaId?: string;
  language?: string;
  presets?: string[];
  /** Defaults to voice when the org has speech output on. */
  modality?: "text" | "voice";
}

export interface SessionDeps {
  db?: Db;
  getOrgConfig?: (
    orgId: string,
    db?: Db,
  ) => Promise<{ version: number; hash: string; config?: Config }>;
}

export interface SessionTurn {
  id: string;
  ordinal: number;
  role: "learner" | "tutor" | "system";
  text: string;
  lang?: string;
}

export interface SessionFactAnchor {
  chunkId: string;
  quote: string;
  start?: number;
  end?: number;
}

export interface SessionFact {
  id: string;
  statement: string;
  anchors: SessionFactAnchor[];
}

export interface SessionState {
  sessionId: string;
  orgId: string;
  userId: string;
  journeyId: string;
  contentId: string;
  journeyTitle: string;
  currentMissionId: string | null;
  currentMission?: {
    id: string;
    key?: string;
    title: string;
    ordinal: number;
    chapterKey: string;
    packStatus: string;
  } | null;
  /** What the screen shows for the current question (never the answer key). */
  ui: ReturnType<typeof uiPayload>;
  progress: { started: boolean; finished: boolean; completed: number; total: number };
  personaId: string;
  language: string;
  presets: string[];
  /**
   * Resolved accessibility and voice flags for this session, after presets are applied.
   * The client cannot resolve these itself, and without them the screen reader preset
   * has no effect on the screen.
   */
  accessibility: { audioEnabled: boolean; reducedMotion: boolean; lowBandwidth: boolean };
  configVersion: number;
  configHash: string;
  status: string;
  turns: SessionTurn[];
  facts: SessionFact[];
  totalMissions: number;
}

/**
 * Create a learning session with resolved config version and hash.
 * Validates journey exists and belongs to the caller's organization.
 */
export async function createSession(
  params: CreateSessionParams,
  deps: SessionDeps = {},
): Promise<string> {
  const db = deps.db ?? defaultDb;

  // 1. Verify journey belongs to user's org
  const [journey] = await db
    .select({
      id: journeys.id,
      orgId: journeys.orgId,
      title: journeys.title,
      contentId: journeys.contentId,
    })
    .from(journeys)
    .where(and(eq(journeys.id, params.journeyId), eq(journeys.orgId, params.orgId)))
    .limit(1);

  if (!journey) {
    throw errors.notFound("Journey not found or not accessible.");
  }

  // 2. Resolve active org config version & hash
  let configVersion = 1;
  let configHash = "default-hash";
  let voiceOutputOn = false;
  if (deps.getOrgConfig) {
    const orgConfig = await deps.getOrgConfig(params.orgId, db);
    configVersion = orgConfig.version;
    configHash = orgConfig.hash;
    voiceOutputOn = orgConfig.config?.voice.output.enabled ?? false;
  } else {
    const { getOrgConfig } = await import("../config/service");
    const orgConfig = await getOrgConfig(params.orgId, db);
    configVersion = orgConfig.version;
    configHash = orgConfig.hash;
    voiceOutputOn = orgConfig.config.voice.output.enabled;
  }

  // 3. Find initial mission (first ordinal of journey)
  const [firstMission] = await db
    .select({ id: missions.id })
    .from(missions)
    .where(eq(missions.journeyId, journey.id))
    .orderBy(missions.ordinal)
    .limit(1);

  // With no language asked for, practise in the document's own language. It used to be a flat
  // "en", so an Urdu or Roman Urdu document opened any way other than the upload screen was
  // tutored and voiced in English. The session language is what routes speech to a voice.
  let language = params.language;
  if (!language) {
    const [content] = await db
      .select({ langPrimary: contents.langPrimary })
      .from(contents)
      .where(and(eq(contents.id, journey.contentId), eq(contents.orgId, params.orgId)))
      .limit(1);
    const lang = content?.langPrimary;
    language = lang === "ur" || lang === "ur-Latn" || lang === "en" ? lang : "en";
  }

  // 4. Insert row into learning_sessions
  const sessionId = crypto.randomUUID();
  await db.insert(learningSessions).values({
    id: sessionId,
    orgId: params.orgId,
    userId: params.userId,
    journeyId: journey.id,
    currentMissionId: firstMission?.id ?? null,
    personaId: params.personaId || "branch_new_joiner",
    language,
    // The engine derives the speech channel from this, so a session that starts as text
    // never produces audio. The learner can still switch it from the session controls.
    modality: params.modality ?? (voiceOutputOn ? "voice" : "text"),
    presets: params.presets || [],
    constraints: {},
    configVersion,
    configHash,
    state: {},
    tokensUsed: 0,
    costUsd: "0",
    status: "active",
  });

  return sessionId;
}

/**
 * Load session state.
 * Returns null if the session does not exist or belongs to another user (returning 404).
 */
export async function loadSessionState(
  sessionId: string,
  userId: string,
  orgId?: string,
  deps: { db?: Db } = {},
): Promise<SessionState | null> {
  const db = deps.db ?? defaultDb;

  const conditions = [eq(learningSessions.id, sessionId), eq(learningSessions.userId, userId)];
  if (orgId) {
    conditions.push(eq(learningSessions.orgId, orgId));
  }

  const [sessionRow] = await db
    .select()
    .from(learningSessions)
    .where(and(...conditions))
    .limit(1);

  if (!sessionRow) {
    return null;
  }

  // Load journey details
  const [journeyRow] = await db
    .select({ title: journeys.title, contentId: journeys.contentId })
    .from(journeys)
    .where(eq(journeys.id, sessionRow.journeyId))
    .limit(1);

  // Load facts for the journey content
  const factRows = journeyRow?.contentId
    ? await db
        .select({
          id: facts.id,
          key: facts.key,
          statement: facts.statement,
          anchors: facts.anchors,
        })
        .from(facts)
        .where(eq(facts.contentId, journeyRow.contentId))
    : [];

  // Load missions count
  const allMissions = await db
    .select({
      id: missions.id,
      ordinal: missions.ordinal,
      title: missions.title,
      chapterKey: missions.chapterKey,
      packStatus: missions.packStatus,
      pack: missions.pack,
    })
    .from(missions)
    .where(eq(missions.journeyId, sessionRow.journeyId))
    .orderBy(missions.ordinal);

  // Find current mission
  const currentMission = sessionRow.currentMissionId
    ? allMissions.find((m) => m.id === sessionRow.currentMissionId)
    : allMissions[0];

  // Load existing turns
  const turnRows = await db
    .select({
      id: turns.id,
      ordinal: turns.ordinal,
      role: turns.role,
      text: turns.text,
      lang: turns.lang,
    })
    .from(turns)
    .where(eq(turns.sessionId, sessionRow.id))
    .orderBy(turns.ordinal);

  // Presets live on the session, so the effective flags have to be resolved here. A config
  // read failure must not take the whole session down, so fall back to audio off, which is
  // the safe direction: captions always work.
  let accessibility = { audioEnabled: false, reducedMotion: false, lowBandwidth: false };
  try {
    const { resolveOrgConfig } = await import("../config/service");
    const resolved = await resolveOrgConfig(
      {
        orgId: sessionRow.orgId,
        personaId: sessionRow.personaId,
        presets: sessionRow.presets ?? [],
        learnerChoices: { language: (sessionRow.language ?? undefined) as Lang | undefined },
      },
      db,
    );
    accessibility = {
      audioEnabled: resolved.config.voice.output.enabled && sessionRow.modality === "voice",
      reducedMotion: resolved.config.ui.reducedMotion === "on",
      lowBandwidth: Boolean(resolved.config.ui.lowBandwidth),
    };
  } catch {
    // keep the safe defaults
  }

  const state: TurnState = { ...EMPTY_STATE, ...((sessionRow.state ?? {}) as Partial<TurnState>) };
  const pack = MissionPack.safeParse(currentMission?.pack);
  const q = pack.success ? currentQuestion(pack.data, state) : null;

  return {
    sessionId: sessionRow.id,
    orgId: sessionRow.orgId,
    userId: sessionRow.userId,
    journeyId: sessionRow.journeyId,
    contentId: journeyRow?.contentId || "",
    journeyTitle: journeyRow?.title || "Practice Journey",
    currentMissionId: currentMission?.id ?? null,
    currentMission: currentMission
      ? {
          id: currentMission.id,
          title: currentMission.title,
          ordinal: currentMission.ordinal,
          chapterKey: currentMission.chapterKey,
          packStatus: currentMission.packStatus,
        }
      : null,
    ui: state.started && !state.finished ? uiPayload(q) : null,
    progress: {
      started: state.started,
      finished: state.finished,
      completed: state.completed.length,
      total: pack.success ? pack.data.questions.length : 0,
    },
    personaId: sessionRow.personaId,
    language: sessionRow.language,
    presets: sessionRow.presets ?? [],
    accessibility,
    configVersion: sessionRow.configVersion,
    configHash: sessionRow.configHash,
    status: sessionRow.status,
    turns: turnRows.map((t) => ({
      id: t.id,
      ordinal: t.ordinal,
      role: t.role,
      text: t.text || "",
      lang: t.lang || undefined,
    })),
    facts: factRows.map((f) => ({
      id: f.key ?? f.id,
      statement: f.statement,
      anchors: (f.anchors ?? []).map((a) => ({
        chunkId: a.chunkId,
        quote: a.quote,
        start: a.start,
        end: a.end,
      })),
    })),
    totalMissions: allMissions.length,
  };
}
