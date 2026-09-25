import { uuidv7 } from "@/lib/ids";
import { MissionPack, type MissionPack as Pack, type Question } from "@/lib/schemas/design";
import { GradeLine, type TurnEvent } from "@/lib/schemas/turn-events";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Lang } from "../config/schema";
import { resolveOrgConfig } from "../config/service";
import { db as defaultDb, type Db } from "../db/client";
import {
  concepts,
  evidenceEvents,
  adaptationEvents,
  facts,
  glossaryTerms,
  journeys,
  learningSessions,
  missions,
  turns,
} from "../db/schema";
import { ensureMission, prefetchNext } from "../design/missions";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { log } from "../obs/logger";
import { createRedactor } from "../security/redact";
import { detectLang } from "../ingest/lang";
import { buildEvidence, getSignalGuess, getSignalWeight } from "./evidence";
import { runExtractor } from "./extract";
import { applyEvent, masteryParams, type MasteryState } from "./mastery";
import { engagementFlags, paceOf, parseEngagement, updateEngagement } from "./engagement";
import { loadMastery, replayConcept } from "./mastery-store";
import { awardXp } from "./xp";
import { updateStreak } from "./streaks";
import { evaluateBadges } from "./badges";
import {
  EMPTY_STATE,
  advance,
  currentQuestion,
  decideMove,
  decideByVerdict,
  logAdaptation,
  slotContext,
  openingMove,
  uiPayload,
  type Move,
  type TurnState,
  type DecideContext,
  buildSnapshot,
} from "./policy";
import { buildEngineRequest } from "./prompt";
import { parseTurnStream } from "./turnstream";
import { keyVerdict, type QuestionLike } from "./verdict";
import { applyNumberGuard, checkNumbers } from "./number-guard";
import { auditTurn, shouldAudit } from "./turn-audit";
import { redact } from "../security/redact";
import { getCanary } from "../security/canary";
import { normalizeDashes, toSpeech } from "./speech";
import { signSpeech } from "../voice/speech-token";
import { isLearnerQuestion, runInTurnRetrieval } from "../retrieval/question";

export interface TurnInput {
  mode?: "text" | "voice" | "tap" | "drag" | "idle" | "start";
  text?: string;
  answer?: unknown;
  questionId?: string;
  clientTimings?: Record<string, number>;
  interrupted?: boolean;
  heardUntilSentence?: number;
}

export interface ExecuteTurnParams {
  sessionId: string;
  userId: string;
  orgId: string;
  input?: TurnInput;
  signal?: AbortSignal;
}

export interface TurnDeps {
  db?: Db;
  llm?: Pick<Llm, "stream">;
  now?: () => number;
  /** Runs work after the response (the route passes Next's `after`); default: fire and forget. */
  defer?: (fn: () => Promise<unknown>) => void;
}

interface LoadedSession {
  id: string;
  orgId: string;
  userId: string;
  journeyId: string;
  missionId: string;
  personaId: string;
  language: Lang;
  presets: string[];
  state: TurnState;
  status: string;
  contentId: string;
  story: Record<string, unknown>;
  outline: Record<string, unknown>;
  pack: Pack;
  missionTitle: string;
  chapterKey: string;
  modality: string;
  register: string | null;
  pendingSwitch: { id: string; kind: string; to: string; reason: string }[];
}

async function loadSession(params: ExecuteTurnParams, db: Db): Promise<LoadedSession | null> {
  const [row] = await db
    .select()
    .from(learningSessions)
    .where(
      and(
        eq(learningSessions.id, params.sessionId),
        eq(learningSessions.userId, params.userId),
        eq(learningSessions.orgId, params.orgId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [journey] = await db
    .select({
      id: journeys.id,
      contentId: journeys.contentId,
      story: journeys.story,
      outline: journeys.outline,
    })
    .from(journeys)
    .where(eq(journeys.id, row.journeyId))
    .limit(1);
  if (!journey) return null;
  const missionId =
    row.currentMissionId ??
    (
      await db
        .select({ id: missions.id })
        .from(missions)
        .where(eq(missions.journeyId, journey.id))
        .orderBy(asc(missions.ordinal))
        .limit(1)
    )[0]?.id;
  if (!missionId) return null;
  // Lazy generation: the first mission is built by the pipeline, later ones on demand.
  const pack = await ensureMission(missionId, { db });
  const [mission] = await db
    .select({ title: missions.title, chapterKey: missions.chapterKey })
    .from(missions)
    .where(eq(missions.id, missionId))
    .limit(1);
  const stateParsed = { ...EMPTY_STATE, ...((row.state ?? {}) as Partial<TurnState>) };
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    journeyId: row.journeyId,
    missionId,
    personaId: row.personaId,
    language: (row.language as Lang) ?? "en",
    presets: row.presets,
    state: stateParsed,
    status: row.status,
    contentId: journey.contentId,
    story: journey.story,
    outline: journey.outline,
    pack: MissionPack.parse(pack),
    missionTitle: mission?.title ?? "Mission",
    chapterKey: mission?.chapterKey ?? "",
    modality: row.modality ?? "text",
    register: row.register ?? null,
    pendingSwitch: row.pendingSwitch ?? [],
  };
}

/** The cached content pack layer: facts, misconceptions, characters, glossary, and this mission. */
async function buildPack(s: LoadedSession, db: Db) {
  const conceptRows = await db
    .select({
      id: concepts.id,
      key: concepts.key,
      name: concepts.name,
      summary: concepts.summary,
      misconceptions: concepts.misconceptions,
    })
    .from(concepts)
    .where(eq(concepts.contentId, s.contentId));
  const conceptKeyById = new Map(conceptRows.map((c) => [c.id, c.key]));
  const factRows = await db
    .select({
      id: facts.id,
      key: facts.key,
      conceptId: facts.conceptId,
      statement: facts.statement,
      anchors: facts.anchors,
      groundingStatus: facts.groundingStatus,
    })
    .from(facts)
    .where(
      and(
        eq(facts.contentId, s.contentId),
        inArray(facts.groundingStatus, ["supported", "partial", "pending", "unchecked"]),
      ),
    );
  const glossary = await db
    .select({
      termEn: glossaryTerms.termEn,
      termUr: glossaryTerms.termUr,
      termRoman: glossaryTerms.termRoman,
      definition: glossaryTerms.definition,
      speechHint: glossaryTerms.speechHint,
    })
    .from(glossaryTerms)
    .where(eq(glossaryTerms.contentId, s.contentId))
    .limit(30);

  const factIds = new Set<string>();
  const factsXml = factRows
    .map((f) => {
      const id = f.key ?? f.id;
      factIds.add(id);
      factIds.add(f.id);
      return `<fact id="${id}" concept="${conceptKeyById.get(f.conceptId) ?? ""}" status="${f.groundingStatus}">${esc(f.statement)}</fact>`;
    })
    .join("\n");
  const misconceptionsXml = conceptRows
    .flatMap((c) =>
      (c.misconceptions ?? []).map(
        (m) =>
          `<misconception id="${m.id}" concept="${c.key}">${esc(m.belief)} | correction: ${esc(m.correction)}</misconception>`,
      ),
    )
    .join("\n");
  const story = s.story as {
    setting?: string;
    premise?: string;
    characters?: { id: string; name: string; role: string; mood: string; voiceProfile: string }[];
  };
  const charactersXml = (story.characters ?? [])
    .map(
      (c) =>
        `<character id="${c.id}" role="${esc(c.role)}" mood="${esc(c.mood)}" voice="${c.voiceProfile}">${esc(c.name)}</character>`,
    )
    .join("\n");
  const glossaryXml = glossary
    .map(
      (g) =>
        `<term en="${esc(g.termEn)}" ur="${esc(g.termUr ?? "")}" roman="${esc(g.termRoman ?? "")}" speech="${esc(g.speechHint ?? "")}">${esc(g.definition)}</term>`,
    )
    .join("\n");
  const conceptsXml = conceptRows
    .map((c) => `<concept key="${c.key}">${esc(c.name)}: ${esc(c.summary)}</concept>`)
    .join("\n");
  // The model sees the whole mission pack for this mission (answer keys included: it grades against them).
  const missionsXml = `<mission id="${s.missionId}" title="${esc(s.pack.title.en)}" mechanic="${s.pack.mechanic}">${esc(JSON.stringify({ objective: s.pack.objective, beats: s.pack.beats, questions: s.pack.questions, roleplay: s.pack.roleplay, teachBack: s.pack.teachBack }))}</mission>`;

  return {
    pack: {
      contentId: s.contentId,
      chapterKey: s.chapterKey,
      outline: esc(
        JSON.stringify({
          setting: story.setting,
          premise: story.premise,
          title: (s.outline as { title?: string }).title,
        }),
      ),
      characters: charactersXml,
      glossary: glossaryXml,
      concepts: conceptsXml,
      facts: factsXml,
      misconceptions: misconceptionsXml,
      missions: missionsXml,
    },
    factIds,
    allowedFacts: factRows.map((f) => ({
      id: f.key ?? f.id,
      statement: f.statement,
      anchors: f.anchors,
    })),
    glossary: glossary.map((g) => ({
      termEn: g.termEn,
      termUr: g.termUr,
      termRoman: g.termRoman,
      speechHint: g.speechHint,
    })),
    conceptIdByKey: new Map<string, string>([
      ...conceptRows.map((c) => [c.key, c.id] as [string, string]),
      ...conceptRows.map((c) => [c.id, c.id] as [string, string]),
    ]),
    defaultConceptId: conceptRows[0]?.id,
  };
}

const esc = (t: string) => t.replace(/(^|\n)@@/g, "$1@ @").replaceAll("<", "＜");

/**
 * One tutor turn: load state, verdict (deterministic for
 * taps, inline for text), policy move, render through the fast tier, stream
 * events, advance state, persist minimized turn rows.
 */
export async function* executeTurn(
  params: ExecuteTurnParams,
  deps: TurnDeps = {},
): AsyncGenerator<TurnEvent> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? defaultLlm;
  const now = deps.now ?? (() => performance.now());
  const defer =
    deps.defer ??
    ((fn: () => Promise<unknown>) => {
      void fn().catch((err) => log.warn({ event: "deferred_failed", err }));
    });
  const turnId = uuidv7();
  const input: TurnInput = params.input ?? { mode: "start" };
  const started = now();

  const s = await loadSession(params, db);
  if (!s) {
    yield {
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: "This session does not exist or is not yours. Start a new session.",
    };
    yield { type: "end" };
    return;
  }
  if (s.status !== "active") {
    yield {
      type: "error",
      code: "SESSION_ENDED",
      message: "This session has ended. Start a new one to continue.",
    };
    yield { type: "end" };
    return;
  }

  const resolved = await resolveOrgConfig(
    {
      orgId: s.orgId,
      personaId: s.personaId,
      presets: s.presets,
      learnerChoices: { language: s.language },
    },
    db,
  );
  const config = resolved.config;
  const persona = config.personas.find((p) => p.id === s.personaId) ?? config.personas[0]!;
  const state = s.state;
  const q = currentQuestion(s.pack, state);

  if (!q || state.finished) {
    yield { type: "turn.start", turnId, moveTypes: ["wrap_up"] };
    yield { type: "display.delta", text: "You have completed this mission. Well done." };
    yield {
      type: "display.sentence",
      index: 0,
      text: "You have completed this mission. Well done.",
    };
    yield { type: "turn.end", turnId, timings: { latencyMs: Math.round(now() - started) } };
    yield { type: "end" };
    return;
  }

  // Verdict and move
  const learnerText = input.text?.trim() ?? "";
  const isStart = input.mode === "start" || (!learnerText && input.answer === undefined);
  const isKeyed =
    input.answer !== undefined &&
    (input.mode === "tap" || input.mode === "drag" || q.kind !== "free_text");
  let verdict: GradeLine | null = null;
  let move: Move;
  let moves: Record<string, Move> | undefined;

  const { pack, factIds, allowedFacts, glossary, conceptIdByKey, defaultConceptId } =
    await buildPack(s, db);

  // In-turn retrieval for questions outside the mission
  let excerptsForThisTurn: string | undefined;
  let retrievedExcerpts: string[] = [];
  let retrievalInSource: boolean | null = null;
  let retrievalMs = 0;

  if (learnerText && !isStart && !isKeyed) {
    const retRes = await runInTurnRetrieval(
      {
        text: learnerText,
        orgId: s.orgId,
        contentId: s.contentId,
        sessionId: s.id,
        glossary,
        retrievalConfig: config.grounding.retrieval,
      },
      { db, llm, now },
    );
    if (retRes.retrievalRan) {
      retrievalMs = retRes.latencyMs;
      retrievalInSource = retRes.inSource;
      if (retRes.inSource) {
        excerptsForThisTurn = retRes.excerptsForThisTurn;
        retrievedExcerpts = retRes.excerptTexts;
      }
    }
  }

  // Mastery for the current concept is read once: the policy (R11) and the evidence row use it.
  const masteryConceptId = conceptIdByKey.get(q.conceptKey) ?? defaultConceptId;
  const mParams = masteryParams(config, persona.pInit);
  const masteryBefore = masteryConceptId
    ? await loadMastery({ userId: s.userId, conceptId: masteryConceptId }, mParams, db)
    : undefined;
  const signal =
    q.kind === "choice"
      ? "choice"
      : q.kind === "sequence" || q.kind === "match" || q.kind === "spot_error"
        ? "puzzle"
        : q.kind === "free_text"
          ? "free_text"
          : q.kind === "explanation"
            ? "explanation"
            : q.kind === "teach_back"
              ? "teach_back"
              : "choice";
  // R11 judges "band at least proficient" on the mastery a correct answer would produce.
  const masteryIfCorrect = masteryBefore
    ? applyEvent(
        masteryBefore,
        {
          credit: 1,
          weight: getSignalWeight(signal, {}, config),
          guess: getSignalGuess(signal, q.options?.length, config),
          signal,
        },
        mParams,
      )
    : undefined;

  // Engagement signals known before the verdict (text cues) feed the decision; the stored
  // state is recomputed after the verdict below.
  const engagementAction = {
    text: learnerText,
    mode: input.mode ?? (input.answer !== undefined ? ("tap" as const) : ("text" as const)),
    questionId: q.id,
    latencyMs: input.clientTimings?.responseMs,
    voiceOn: s.modality === "voice",
  };
  const preEngagement = updateEngagement(
    parseEngagement(state.engagement),
    { ...engagementAction, verdict: null },
    config.engagement,
  );
  const preFlags = engagementFlags(preEngagement.state, config.engagement);
  const pendingSwitch = s.pendingSwitch;
  const SWITCH_KINDS = ["language", "persona", "modality", "register", "preset"] as const;
  const first = pendingSwitch[0];
  const explicitSwitch =
    first && (SWITCH_KINDS as readonly string[]).includes(first.kind)
      ? { kind: first.kind as (typeof SWITCH_KINDS)[number], to: first.to }
      : null;
  const decideCtx: DecideContext = {
    cues: {
      explicitSwitch,
      idk: preEngagement.signals.idk,
      inSourceQuestion: retrievalInSource === true,
      outOfSource: retrievalInSource === false && !isKeyed,
    },
    engagement: {
      frustrated: preFlags.frustrated,
      frustratedBy: preFlags.frustratedBy,
      fatigued: preFlags.fatigued,
      pace: paceOf(preEngagement.state.latencies, persona.latencyBaselineMs, config.engagement),
    },
    mastery: masteryBefore ? { band: masteryBefore.band, p: masteryBefore.p } : null,
    masteryIfCorrect: masteryIfCorrect
      ? { band: masteryIfCorrect.band, p: masteryIfCorrect.p }
      : null,
    latencyMs: input.clientTimings?.responseMs ?? null,
    persona,
  };
  // The context the chosen move was decided with; the adaptation row stores exactly this.
  let decidedCtx: DecideContext = decideCtx;

  if (isStart) {
    move = openingMove(s.pack, q);
  } else if (isKeyed) {
    const v = keyVerdict(q as unknown as QuestionLike, input.answer);
    verdict = { ...v, question: q.id, concept: q.conceptKey, lang: s.language };
    decidedCtx = {
      ...slotContext(decideCtx, v.verdict),
      misconceptionId: v.misconception,
    };
    decidedCtx.cues = { ...decidedCtx.cues, helpRequest: v.help_request };
    move = decideMove(s.pack, state, q, v.verdict, config, decidedCtx);
    const chosen =
      typeof input.answer === "string" ? q.options?.find((o) => o.id === input.answer) : undefined;
    yield { type: "verdict", data: { ...verdict, consequence: chosen?.consequence ?? null } };
  } else {
    moves = decideByVerdict(s.pack, state, q, config, decideCtx);
    const slot = decideCtx.cues?.outOfSource ? "out_of_source" : "not_an_answer";
    move = moves[slot]!;
    decidedCtx = slotContext(decideCtx, slot);
  }

  yield {
    type: "turn.start",
    turnId,
    moveTypes: moves ? Object.values(moves).map((m) => m.type) : [move.type],
  };

  // Prompt layers

  const historyRows = await db
    .select({ role: turns.role, text: turns.text })
    .from(turns)
    .where(eq(turns.sessionId, s.id))
    .orderBy(desc(turns.ordinal))
    .limit(config.session.historyTurns);
  const history = historyRows
    .reverse()
    .filter((t) => t.text)
    .map((t) => ({
      role: t.role === "learner" ? ("user" as const) : ("assistant" as const),
      content: t.text!,
    }));

  const movesForPrompt = moves
    ? Object.fromEntries(
        Object.entries(moves).map(([k, m]) => [k, { id: m.id, type: m.type, params: m.params }]),
      )
    : undefined;
  // Session choice wins; otherwise the resolved config (persona, then any session preset).
  const register =
    s.register === "formal" || s.register === "colleague" ? s.register : config.language.register;
  // Voice sessions get a speech channel; text sessions ask for none.
  const speechMode =
    s.modality === "voice" ? (config.voice.speechMode[s.language] ?? "mirror") : "none";
  const speechScope = { orgId: s.orgId, userId: s.userId, sessionId: s.id };
  const speechGlossary = glossary.map((g) => ({
    term: g.termEn,
    speechUr: g.termUr ?? undefined,
    speechHint: g.speechHint ?? undefined,
  }));
  const req = buildEngineRequest({
    task: "RESPOND",
    speechMode,
    session: s.id,
    config: { orgId: s.orgId },
    pack,
    history,
    moves: movesForPrompt,
    singleMove: moves ? undefined : { id: move.id, type: move.type, params: move.params },
    learnerInput: learnerText || (input.answer !== undefined ? JSON.stringify(input.answer) : ""),
    persona: persona.id,
    personaDescription: `${persona.level}; ${persona.pace} pace; ${persona.turnLength} turns; ${register} register`,
    language: s.language,
    register,
    grounding: config.grounding.strictness,
    missionId: s.missionId,
    missionTitle: s.missionTitle,
    mechanic: s.pack.mechanic,
    questionId: q.id,
    questionKind: q.kind,
    attempts: (state.attempts[q.id] ?? 0) + 1,
    hintLevel: state.hintLevel[q.id] ?? 0,
    allowedFactIds: [...factIds],
    inputMode: input.mode ?? "text",
    detectedLang: learnerText ? detectLang(learnerText) : s.language,
    excerptsForThisTurn,
    interrupted: input.interrupted ?? (input.heardUntilSentence !== undefined ? true : undefined),
  });

  let ttftMs = 0;
  const sentences: string[] = [];
  /** The sentence being streamed, and whether a figure in it has stopped its deltas. */
  let deltaSentence = "";
  let holdingFigure = false;
  let protocolOk = true;
  let modelMoveId: string | null = null;
  let providerTier: string | undefined;
  let usageCostUsd = 0;

  try {
    const handle = await llm.stream(
      "turn.respond",
      {
        system: req.system,
        packBlocks: [req.packBlock],
        history: req.history.map((h) => ({ role: h.role, text: h.content })),
        final: req.final,
        orgId: s.orgId,
        sessionId: s.id,
        contentId: s.contentId,
        lang: s.language,
      },
      { signal: params.signal },
    );
    handle.usage
      .then((u) => {
        providerTier = u.tier;
        usageCostUsd = u.costUsd;
      })
      .catch(() => undefined);

    const offered = new Set(moves ? Object.values(moves).map((m) => m.id) : [move.id]);
    for await (const ev of parseTurnStream(handle.textStream, {
      allowedFactIds: factIds,
      offeredMoveIds: offered,
      turnId,
      lang: s.language,
      speechMode,
      scope: speechScope,
      canary: getCanary(process.env.VERCEL_DEPLOYMENT_ID || "dev"),
      maxSpeechChars: config.voice.tts.maxChars,
    })) {
      if (params.signal?.aborted) break;
      if (ev.type === "display.delta") {
        if (!ttftMs) ttftMs = Math.round(now() - started);
        deltaSentence += ev.text;
        // A delta cannot be taken back. The learner page appends deltas straight into the live
        // transcript, so an invented figure was on screen in full and only corrected when the
        // sentence arrived. The moment this sentence starts to carry a figure, stop streaming
        // it: display.sentence delivers the guarded text a moment later. Prose without figures
        // streams exactly as before, which is nearly every sentence.
        if (
          !holdingFigure &&
          checkNumbers(deltaSentence, allowedFacts, retrievedExcerpts).unverified.length > 0
        ) {
          holdingFigure = true;
        }
        if (holdingFigure) continue;
      }
      if (ev.type === "display.sentence") {
        deltaSentence = "";
        holdingFigure = false;
        const guardRes = applyNumberGuard(
          ev.text,
          allowedFacts,
          retrievedExcerpts,
          config.grounding.strictness,
        );
        // The model writes em dashes whatever the prompt says, and they are forbidden in
        // any copy, so the engine strips them rather than trusting the instruction.
        const sentenceText = normalizeDashes(guardRes.text);
        sentences.push(sentenceText);
        // In assisted mode the sentence is shown as written, so the unverified figures travel
        // with it and the learner sees them marked. Discarding them here meant an invented
        // figure rendered exactly like a sourced one.
        const unverified = guardRes.replaced ? [] : guardRes.unverified;
        if (unverified.length > 0) {
          log.warn({
            event: "unverified_figure_shown",
            sessionId: s.id,
            turnId,
            strictness: config.grounding.strictness,
            count: unverified.length,
          });
        }
        yield {
          ...ev,
          text: sentenceText,
          ...(unverified.length > 0 ? { unverified } : {}),
        };
        // mirror and normalize derive speech here; llm mode gets it from the model @@s line.
        if (speechMode === "mirror" || speechMode === "normalize") {
          const spokenRaw = toSpeech(sentenceText, {
            lang: s.language,
            mode: speechMode,
            glossary: speechGlossary,
            mixedStrategy: config.voice.tts.mixedStrategy,
          });
          // Redact before signing: the signed text is what reaches Uplift, Soniox and the
          // browser-direct path, so this is the one place that covers all three.
          const spoken = redact(spokenRaw).text.slice(0, config.voice.tts.maxChars);
          if (spoken) {
            const token = signSpeech(spoken, s.language, turnId, speechScope);
            yield {
              type: "speech.item",
              index: ev.index,
              text: spoken,
              lang: s.language,
              sig: token.sig,
              exp: token.exp,
            };
          }
        }
        continue;
      }
      if (ev.type === "warning") {
        protocolOk = false;
        // The system prompt leaked into the reply, which means an injection landed. The
        // turn is withdrawn rather than shown with the canary blanked out: the rest of
        // that reply is whatever the attacker asked for.
        if (ev.message === "canary_leaked") {
          log.warn({ event: "canary_leaked", sessionId: s.id, turnId });
          yield { type: "retract", turnId, reason: "canary_leaked" };
          yield {
            type: "error",
            code: "TURN_WITHDRAWN",
            message: "That reply was withdrawn. Ask again in your own words.",
          };
          yield { type: "end" };
          return;
        }
      }
      if (ev.type === "move") modelMoveId = ev.id;
      if (ev.type === "verdict") {
        const parsed = GradeLine.safeParse(ev.data);
        if (parsed.success && !verdict) {
          verdict = parsed.data;
          if (retrievalInSource === false && verdict.verdict === "not_an_answer") {
            verdict.out_of_source = true;
          }
          if (moves) {
            if (verdict.out_of_source && moves.out_of_source) {
              move = moves.out_of_source;
              decidedCtx = slotContext(decideCtx, "out_of_source");
            } else {
              move = moves[verdict.verdict] ?? move;
              decidedCtx = slotContext(decideCtx, verdict.verdict);
            }
          }
        } else if (!parsed.success) {
          protocolOk = false;
          continue;
        }
      }
      if (ev.type === "end") continue;
      yield ev;
    }
    if (params.signal?.aborted) {
      yield { type: "retract", turnId, reason: "aborted" };
      yield { type: "end" };
      return;
    }
  } catch (err) {
    log.error({ event: "turn_stream_failed", sessionId: s.id, err });
    yield { type: "retract", turnId, reason: "stream_error" };
    yield {
      type: "error",
      code: "TUTOR_UNAVAILABLE",
      message: "The tutor did not answer this time. Try again.",
    };
    yield { type: "end" };
    return;
  }

  if (
    retrievalInSource === false &&
    moves?.out_of_source &&
    (!verdict || verdict.verdict === "not_an_answer") &&
    isLearnerQuestion(learnerText)
  ) {
    move = moves.out_of_source;
    if (verdict) verdict.out_of_source = true;
  }

  if (
    moves &&
    verdict &&
    moves[verdict.verdict] &&
    modelMoveId &&
    modelMoveId !== moves[verdict.verdict]!.id
  ) {
    // The model rendered a move that does not match its own verdict; the verdict wins for state.
    protocolOk = false;
  }

  // Advance state from the verdict (code decides progress, never the model).
  const advanced = isStart
    ? { ...state, started: true }
    : advance(state, s.pack, q, move, verdict?.verdict ?? null);
  // Engagement updates on every learner action; the policy reads the flags.
  const engagement = updateEngagement(
    parseEngagement(state.engagement),
    { ...engagementAction, verdict: verdict?.verdict ?? null },
    config.engagement,
  );
  const nextState: TurnState = { ...advanced, engagement: engagement.state };
  const flags = engagementFlags(engagement.state, config.engagement);
  const nextQ = currentQuestion(s.pack, nextState);
  const showNext = isStart || (verdict?.verdict === "correct" && !nextState.finished);
  if (showNext && nextQ) yield { type: "ui", payload: uiPayload(nextQ) };
  const latencyMs = Math.round(now() - started);
  const learnerTurnId = uuidv7();
  const hasLearnerInput = Boolean(learnerText) || input.answer !== undefined;
  const learnerTurnSavedId = hasLearnerInput ? learnerTurnId : undefined;

  // Evidence and mastery: built here so the Inspector can show the move,
  // written in the persistence batch below. Code decides; the model only supplied the verdict.
  let provisionalEvidenceRow: typeof evidenceEvents.$inferInsert | undefined;
  let masteryAfter: MasteryState | undefined;
  if (verdict && q && verdict.verdict !== "not_an_answer") {
    const conceptId = masteryConceptId;
    if (conceptId && masteryBefore) {
      const isTap = input.mode === "tap" || input.mode === "drag";
      const built = buildEvidence(
        {
          verdict: verdict.verdict,
          score: verdict.score,
          self_correction: verdict.self_correction,
          help_request: verdict.help_request,
          misconception: verdict.misconception,
          confidence_cue: verdict.confidence_cue,
        },
        {
          userId: s.userId,
          orgId: s.orgId,
          sessionId: s.id,
          turnId: learnerTurnSavedId,
          conceptId,
          missionId: s.missionId,
          questionId: q.id,
          signal,
          numOptions: q.options?.length,
          // The hint the learner had when answering, not the one this move is about to give.
          hintLevel: state.hintLevel[q.id] ?? 0,
          isWorkedExample: Boolean(state.workedShown[q.id]),
          latencyMs,
          lang: s.language,
          modality: s.modality,
          source: isTap ? "key" : "inline",
          pBefore: masteryBefore.p,
        },
        config,
      );
      masteryAfter = applyEvent(
        masteryBefore,
        { credit: built.credit, weight: built.weight, guess: built.guess, signal, at: new Date() },
        mParams,
      );
      provisionalEvidenceRow = {
        id: uuidv7(),
        orgId: built.orgId,
        userId: built.userId,
        sessionId: built.sessionId,
        turnId: built.turnId,
        conceptId: built.conceptId,
        missionId: built.missionId,
        questionId: built.questionId,
        signal: built.signal,
        verdict: built.verdict,
        score: built.score,
        hintLevel: built.hintLevel,
        latencyMs: built.latencyMs,
        selfCorrected: built.selfCorrected,
        confidence: built.confidence,
        lang: built.lang,
        modality: built.modality,
        misconceptionId: built.misconceptionId,
        weight: built.weight,
        credit: built.credit,
        guess: built.guess,
        pBefore: masteryBefore.p,
        pAfter: masteryAfter.p,
        source: built.source,
      };
    }
  }

  yield {
    type: "inspector",
    delta: {
      turnId,
      verdict: verdict
        ? {
            verdict: verdict.verdict,
            score: verdict.score,
            misconception: verdict.misconception,
            helpRequest: verdict.help_request,
            outOfSource: verdict.out_of_source,
          }
        : null,
      move: {
        id: move.id,
        type: move.type,
        ruleId: move.ruleId,
        reason: move.reason,
        params: move.params,
      },
      question: q.id,
      attempts: nextState.attempts[q.id] ?? 0,
      hintLevel: nextState.hintLevel[q.id] ?? 0,
      completed: nextState.completed.length,
      total: s.pack.questions.length,
      configVersion: resolved.version,
      configHash: resolved.hash,
      tier: providerTier ?? "fast",
      protocolOk,
      switches: pendingSwitch.map((p) => ({ kind: p.kind, to: p.to, reason: p.reason })),
      engagement: {
        frustration: Math.round(engagement.state.frustration * 100) / 100,
        fatigue: Math.round(engagement.state.fatigue * 100) / 100,
        pace: paceOf(engagement.state.latencies, persona.latencyBaselineMs, config.engagement),
        frustrated: flags.frustrated,
        fatigued: flags.fatigued,
        signals: engagement.signals,
      },
      mastery:
        masteryBefore && masteryAfter && masteryConceptId
          ? {
              conceptId: masteryConceptId,
              conceptKey: q.conceptKey,
              before: masteryBefore.p,
              after: masteryAfter.p,
              band: masteryAfter.band,
              limitedEvidence: masteryAfter.limitedEvidence,
              lower: masteryAfter.lower,
              upper: masteryAfter.upper,
              nEvents: masteryAfter.nEvents,
            }
          : null,
    },
  };
  yield {
    type: "turn.end",
    turnId,
    timings: {
      ttftMs,
      latencyMs,
      ...(retrievalMs ? { retrievalMs } : {}),
      ...(input.clientTimings ?? {}),
    },
  };
  // Persist before `end`: the client and the session lock treat `end` as "state is written",
  // so the next turn never loads a stale question. Rows are redacted and capped at 2,000 chars.
  // Hoisted above the persistence block so the mission.changed event below can read them.
  let nextMission: { id: string; ordinal: number } | null = null;
  let journeyDone = false;
  try {
    const redactor = createRedactor();
    const [last] = await db
      .select({ ordinal: turns.ordinal })
      .from(turns)
      .where(eq(turns.sessionId, s.id))
      .orderBy(desc(turns.ordinal))
      .limit(1);
    let ordinal = (last?.ordinal ?? 0) + 1;
    const rows = [];
    const tutorTurnId = uuidv7();
    if (hasLearnerInput) {
      rows.push({
        id: learnerTurnId,
        sessionId: s.id,
        orgId: s.orgId,
        ordinal: ordinal++,
        role: "learner" as const,
        inputMode: (input.mode === "start" ? "text" : (input.mode ?? "text")) as
          "text" | "voice" | "tap" | "drag" | "idle",
        text: redactor.redact((learnerText || describeAnswer(q, input.answer)).slice(0, 2000)).text,
        lang: learnerText ? detectLang(learnerText) : s.language,
        missionId: s.missionId,
        heardUntilSentence: input.heardUntilSentence ?? null,
        timings: input.clientTimings ?? {},
        protocolOk: true,
      });
    }
    if (sentences.length) {
      rows.push({
        id: tutorTurnId,
        sessionId: s.id,
        orgId: s.orgId,
        ordinal: ordinal++,
        role: "tutor" as const,
        inputMode: null,
        text: redactor.redact(sentences.join(" ").slice(0, 2000)).text,
        lang: s.language,
        missionId: s.missionId,
        moveType: move.type,
        timings: { ttftMs, latencyMs },
        protocolOk,
        providerTier,
      });
    }

    // A finished mission is not a finished journey. currentMissionId was written once, when
    // the session was created, and nothing ever moved it on, so completing mission 1 ended the
    // whole session and the route strip stayed on station 1 of 7. Look for the next mission by
    // ordinal: if there is one, move to it and start its questions from the top; only the last
    // mission in the journey ends the session.
    if (nextState.finished) {
      const [candidate] = await db
        .select({ id: missions.id, ordinal: missions.ordinal })
        .from(missions)
        .where(
          and(
            eq(missions.journeyId, s.journeyId),
            sql`${missions.ordinal} > (select ordinal from missions where id = ${s.missionId})`,
          ),
        )
        .orderBy(asc(missions.ordinal))
        .limit(1);
      nextMission = candidate ?? null;
    }
    journeyDone = Boolean(nextState.finished && !nextMission);
    // Carry engagement across the mission boundary: frustration and fatigue belong to the
    // learner in this sitting, not to the questions they just answered.
    const persistedState: TurnState = nextMission
      ? { ...EMPTY_STATE, started: true, engagement: nextState.engagement }
      : nextState;

    const updateSession = db
      .update(learningSessions)
      .set({
        state: { ...persistedState } as Record<string, unknown>,
        ...(nextMission ? { currentMissionId: nextMission.id } : {}),
        // Drop exactly the switches this turn saw, by id; any that arrived mid-turn stay queued.
        ...(pendingSwitch.length
          ? {
              pendingSwitch: sql`(
                select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
                from jsonb_array_elements(${learningSessions.pendingSwitch}) with ordinality t(e, i)
                where not (e->>'id' = any(${sql.param(pendingSwitch.map((p) => p.id))}::text[]))
              )`,
            }
          : {}),
        lastActiveAt: new Date(),
        ...(journeyDone ? { status: "ended", endedAt: new Date() } : {}),
      })
      .where(eq(learningSessions.id, s.id));

    // One round trip for rows and state (Neon HTTP batch).
    const batchStatements: unknown[] = [];
    if (rows.length) batchStatements.push(db.insert(turns).values(rows));
    if (provisionalEvidenceRow) {
      batchStatements.push(db.insert(evidenceEvents).values(provisionalEvidenceRow));
    }
    if (!isStart) {
      batchStatements.push(
        db.insert(adaptationEvents).values({
          id: uuidv7(),
          ...logAdaptation(
            move,
            buildSnapshot(s.pack, state, q, verdict?.verdict ?? null, decidedCtx),
            {
              orgId: s.orgId,
              sessionId: s.id,
              turnId: hasLearnerInput ? learnerTurnId : null,
              configVersion: resolved.version,
            },
          ),
        }),
      );
    }
    batchStatements.push(updateSession);

    if (batchStatements.length === 1) {
      await updateSession;
    } else {
      await (db as unknown as { batch: (ops: unknown[]) => Promise<unknown> }).batch(
        batchStatements,
      );
    }

    // Mastery is a replay of the committed log, so a concurrent extractor
    // correction and this turn can never leave the stored state behind either of them.
    if (provisionalEvidenceRow && masteryConceptId) {
      // The turn is saved at this point; a replay failure is logged and healed by the next turn.
      try {
        await replayConcept(
          { userId: s.userId, conceptId: masteryConceptId, orgId: s.orgId },
          masteryParams(config, persona.pInit),
          resolved.version,
          db,
        );
      } catch (err) {
        log.warn({ event: "mastery_replay_failed", sessionId: s.id, err });
      }
    }

    // The extractor re-grades free text only ; keyed verdicts are exact.
    if (
      provisionalEvidenceRow &&
      provisionalEvidenceRow.source === "inline" &&
      learnerTurnSavedId
    ) {
      const turnToExtract = learnerTurnSavedId;
      defer(() =>
        runExtractor(turnToExtract, { db, llm }).catch((err) => {
          log.warn({ event: "extractor_async_failed", turnId: turnToExtract, err });
        }),
      );
    }

    // Sampled audit of what the tutor actually said. Everything else in
    // the grounding story checks the material at design time; this is the only check on the
    // turn itself, and without it the unsupported claim rate was unknown rather than zero.
    // Deferred and log only: it must never hold up a turn or change what was already shown.
    if (sentences.length > 0 && shouldAudit(config.grounding.turnAuditRate)) {
      const auditInput = {
        sessionId: s.id,
        turnId,
        orgId: s.orgId,
        contentId: s.contentId,
        sentences: [...sentences],
        factStatements: allowedFacts.map((f) => f.statement).filter(Boolean),
        excerpts: [...retrievedExcerpts],
      };
      defer(() =>
        auditTurn(auditInput, { llm: llm as Llm }).catch((err) => {
          log.warn({ event: "turn_audit_failed", turnId, err });
        }),
      );
    }

    // Build the next mission while the learner works through this one. Missions after the
    // first are built on demand, and prefetchNext existed for exactly this but nothing called
    // it, so the next station was only built once the learner reached it, and they waited.
    defer(() =>
      prefetchNext(s.id, { db, llm: llm as Llm }).catch((err) => {
        log.warn({ event: "mission_prefetch_failed", sessionId: s.id, err });
      }),
    );

    // Gamification: deterministic XP, streaks, and badges
    if (config.gamification?.enabled !== false) {
      try {
        const xpAwards: Array<{
          amount: number;
          reasonCode: string;
          totalXp: number;
          level: number;
          levelUp: boolean;
        }> = [];

        // 1. Update streak for active day in Asia/Karachi
        let streakResult: Awaited<ReturnType<typeof updateStreak>> | null = null;
        if (config.gamification.streaks.enabled) {
          streakResult = await updateStreak(s.userId, new Date(), { db, config });
          if (streakResult.status !== "same_day") {
            const firstDayAward = await awardXp(
              {
                orgId: s.orgId,
                userId: s.userId,
                sessionId: s.id,
                reasonCode: "first_session_of_day",
              },
              { db, config },
            );
            if (firstDayAward.amount > 0) xpAwards.push(firstDayAward);
          }
        }

        // 2. Verdict-based XP awards
        if (verdict && verdict.verdict !== "not_an_answer") {
          if (verdict.verdict === "correct") {
            const hintLvl = state.hintLevel[q.id] ?? 0;
            const isFirstTry = (state.attempts[q.id] ?? 0) === 0 && hintLvl === 0;
            const code = isFirstTry ? "correct_first_try" : "correct_after_hint";
            const correctAward = await awardXp(
              {
                orgId: s.orgId,
                userId: s.userId,
                sessionId: s.id,
                reasonCode: code,
                refId: learnerTurnSavedId,
              },
              { db, config },
            );
            if (correctAward.amount > 0) xpAwards.push(correctAward);

            if (verdict.self_correction) {
              const selfCorrAward = await awardXp(
                {
                  orgId: s.orgId,
                  userId: s.userId,
                  sessionId: s.id,
                  reasonCode: "self_correction",
                  refId: learnerTurnSavedId,
                },
                { db, config },
              );
              if (selfCorrAward.amount > 0) xpAwards.push(selfCorrAward);
            }

            if (signal === "teach_back" && verdict.score >= 0.7) {
              const tbAward = await awardXp(
                {
                  orgId: s.orgId,
                  userId: s.userId,
                  sessionId: s.id,
                  reasonCode: "teach_back",
                  refId: learnerTurnSavedId,
                },
                { db, config },
              );
              if (tbAward.amount > 0) xpAwards.push(tbAward);
            }
          } else if (verdict.verdict === "partial") {
            const partialAward = await awardXp(
              {
                orgId: s.orgId,
                userId: s.userId,
                sessionId: s.id,
                reasonCode: "partial",
                refId: learnerTurnSavedId,
              },
              { db, config },
            );
            if (partialAward.amount > 0) xpAwards.push(partialAward);
          }
        }

        // 3. Mission complete award
        if (nextState.finished) {
          const missionAward = await awardXp(
            {
              orgId: s.orgId,
              userId: s.userId,
              sessionId: s.id,
              reasonCode: "mission_complete",
              refId: s.missionId,
            },
            { db, config },
          );
          if (missionAward.amount > 0) xpAwards.push(missionAward);
        }

        // 4. Badges evaluation
        const newBadges = await evaluateBadges(
          s.userId,
          {
            missionsCompleted: nextState.finished ? 1 : undefined,
            streakDays: streakResult?.currentDays,
            teachBackScore: signal === "teach_back" ? verdict?.score : undefined,
            selfCorrected: verdict?.self_correction,
            language: s.language,
            evidenceRef: learnerTurnSavedId,
          },
          { db },
        );

        if (xpAwards.length > 0 || newBadges.length > 0 || streakResult?.freezeUsed) {
          yield {
            type: "gamification",
            data: {
              xpAwards,
              streak: streakResult
                ? {
                    currentDays: streakResult.currentDays,
                    freezesLeft: streakResult.freezesLeft,
                    freezeUsed: streakResult.freezeUsed,
                  }
                : undefined,
              newBadges,
            },
          };
        }
      } catch (gamificationErr) {
        log.warn({ event: "gamification_eval_failed", sessionId: s.id, err: gamificationErr });
      }
    }

    log.info({
      event: "turn_done",
      sessionId: s.id,
      move: move.type,
      verdict: verdict?.verdict ?? null,
      ttftMs,
      latencyMs,
      costUsd: usageCostUsd,
      evidenceRecorded: !!provisionalEvidenceRow,
    });
  } catch (err) {
    log.error({ event: "turn_persist_failed", sessionId: s.id, err });
    yield {
      type: "error",
      code: "TURN_NOT_SAVED",
      message: "Your answer was not saved. Send it again.",
    };
  }
  // After the state is persisted, so the client refetches a session that has already moved.
  if (nextState.finished) {
    yield {
      type: "mission.changed",
      missionId: nextMission?.id ?? s.missionId,
      ordinal: nextMission?.ordinal ?? -1,
      journeyComplete: journeyDone,
    };
  }
  yield { type: "end" };
}

/** Collect every event of a turn; used by tests and scripts. */
export async function collectTurnEvents(
  params: ExecuteTurnParams,
  deps: TurnDeps = {},
): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const ev of executeTurn(params, deps)) out.push(ev);
  return out;
}

/** A keyed answer as a transcript line: option labels rather than ids where the pack knows them. */
function describeAnswer(q: Question, answer: unknown): string {
  const label = (id: string) =>
    q.options?.find((o) => o.id === id)?.label.en ??
    q.sequence?.steps.find((st) => st.id === id)?.label.en ??
    q.passage?.sentences.find((se) => se.id === id)?.text.en ??
    id;
  if (typeof answer === "string") return label(answer);
  if (Array.isArray(answer)) return answer.map((a) => label(String(a))).join(" > ");
  if (answer && typeof answer === "object")
    return Object.entries(answer as Record<string, unknown>)
      .map(([l, r]) => `${l}: ${String(r)}`)
      .join("; ");
  return JSON.stringify(answer) ?? "";
}
