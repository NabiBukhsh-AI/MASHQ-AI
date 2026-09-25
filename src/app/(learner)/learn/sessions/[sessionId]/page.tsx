"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RouteStrip } from "@/client/components/session/RouteStrip";
import { SessionToolbar } from "@/client/components/session/SessionToolbar";
import { Conversation, type TurnMessage } from "@/client/components/session/Conversation";
import { Composer } from "@/client/components/session/Composer";
import { useVoicePlayback } from "@/client/voice/useVoicePlayback";
import { detectVoiceCapabilities, type VoiceCapabilities } from "@/client/voice/capabilities";
import {
  GamificationLayer,
  parseGamification,
  type GamificationData,
} from "@/client/components/session/GamificationLayer";
import { BidiText } from "@/client/components/BidiText";
import {
  Mechanic,
  type MechanicAnswer,
  type UiLang,
  type UiPayload,
} from "@/client/components/mechanics";
import { Inspector, type InspectorDelta } from "@/client/components/Inspector/Panel";
import { useTurnStream, type TurnInputBody } from "@/client/session/useTurnStream";
import { useSessionControls } from "@/client/session/useSessionControls";
import { UiPayloadSchema, type TurnEvent } from "@/lib/schemas/turn-events";
import { FactChip } from "@/client/components/FactChip";
import { SourceDrawer } from "@/client/components/SourceDrawer";

interface SessionData {
  sessionId: string;
  journeyTitle: string;
  contentId?: string;
  currentMissionId: string | null;
  currentMission?: { id: string; title: string; ordinal: number; chapterKey: string } | null;
  personaId: string;
  language: string;
  presets: string[];
  accessibility?: { audioEnabled: boolean; reducedMotion: boolean; lowBandwidth: boolean };
  status: string;
  turns: TurnMessage[];
  facts?: {
    id: string;
    statement: string;
    anchors: { chunkId: string; quote: string; start?: number; end?: number }[];
  }[];
  totalMissions: number;
  ui?: UiPayload | null;
  progress?: { started: boolean; finished: boolean; completed: number; total: number };
}

interface PendingTurn {
  id: string;
  sentences: string[];
  facts: string[];
  move?: string;
  /** The engine's decided move was out_of_source, which is what the badge means. */
  outOfSource?: boolean;
  /** Figures shown as written because assisted mode allows it. */
  unverified?: string[];
}

const OUT_OF_SOURCE_BADGE = "General knowledge, not from your material";

export default function SessionPage(): React.JSX.Element {
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [session, setSession] = useState<SessionData | null>(null);
  const [turns, setTurns] = useState<TurnMessage[]>([]);
  const [persona, setPersona] = useState("branch_new_joiner");
  const [language, setLanguage] = useState<UiLang>("en");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspector, setInspector] = useState<InspectorDelta | null>(null);
  const [timings, setTimings] = useState<Record<string, number> | null>(null);
  const [ui, setUi] = useState<UiPayload | null>(null);
  const [lastAnswer, setLastAnswer] = useState<unknown>(null);
  const [finished, setFinished] = useState(false);
  const [missionAdvancing, setMissionAdvancing] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [consequence, setConsequence] = useState<string | null>(null);
  const [selectedFact, setSelectedFact] = useState<{
    id: string;
    statement?: string;
    quote?: string;
    anchorKind?: string;
    anchorRef?: string;
    chunkText?: string;
    loading?: boolean;
  } | null>(null);

  const { isStreaming, error: turnError, sendTurn, abort } = useTurnStream(sessionId);
  const voice = useVoicePlayback({ abortStream: abort, lang: language });
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  // Read inside onEvent, which is memoised, so a ref rather than the state value.
  const audioOffRef = useRef(false);
  const [gamification, setGamification] = useState<GamificationData | null>(null);
  const controls = useSessionControls(sessionId);
  const pending = useRef<PendingTurn | null>(null);
  const replyAt = useRef<number | null>(null);
  const streamRef = useRef("");
  const startedRef = useRef<string | null>(null);

  const pushSystem = useCallback((text: string) => {
    setTurns((prev) => [...prev, { id: `sys-${Date.now()}`, role: "system", text }]);
  }, []);

  const handleOpenSource = useCallback(
    async (factId: string) => {
      const fact = session?.facts?.find((f) => f.id === factId);
      const anchor = fact?.anchors?.[0];
      setSelectedFact({
        id: factId,
        statement: fact?.statement,
        quote: anchor?.quote,
        loading: !!(anchor?.chunkId && session?.contentId),
      });

      if (anchor?.chunkId && session?.contentId) {
        try {
          const res = await fetch(`/api/content/${session.contentId}/chunks/${anchor.chunkId}`);
          if (res.ok) {
            const data = (await res.json()) as {
              chunk?: { text: string; anchorKind: string; anchorRef: string };
            };
            setSelectedFact((prev) =>
              prev && prev.id === factId
                ? {
                    ...prev,
                    chunkText: data.chunk?.text,
                    anchorKind: data.chunk?.anchorKind,
                    anchorRef: data.chunk?.anchorRef,
                    loading: false,
                  }
                : prev,
            );
          } else {
            setSelectedFact((prev) => (prev ? { ...prev, loading: false } : null));
          }
        } catch {
          setSelectedFact((prev) => (prev ? { ...prev, loading: false } : null));
        }
      }
    },
    [session],
  );

  const finalizeTutor = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    const text = p?.sentences.filter(Boolean).join(" ") || streamRef.current.trim();
    streamRef.current = "";
    setStreamText("");
    setLastAnswer(null);
    replyAt.current = Date.now();
    if (!p || !text) return;
    setTurns((prev) => [
      ...prev,
      {
        id: p.id,
        role: "tutor",
        text,
        facts: p.facts,
        // The engine decides the move; the model only reports one. Reading @@m meant a reply
        // that omitted the tag, or tagged a different offered move, rendered its general
        // knowledge paragraph with no label at all.
        badge: p.outOfSource ? OUT_OF_SOURCE_BADGE : undefined,
        unverified: p.unverified?.length ? p.unverified : undefined,
      },
    ]);
  }, []);

  /**
   * Pulls the session again from the server. Used on first load and when the engine moves the
   * session to the next mission: the route strip, the station count and the first question of
   * the new mission then all come from the same source rather than being patched piecemeal.
   */
  const reloadSession = useCallback(async (): Promise<void> => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (!res.ok) return;
    const data: SessionData = await res.json();
    setSession(data);
    setTurns(data.turns || []);
    setUi(data.ui ?? null);
    setFinished(Boolean(data.progress?.finished));
    // Opening the mission is left to the effect below, which covers first load and a mission
    // change with one rule instead of two.
  }, [sessionId]);

  const onEvent = useCallback(
    (ev: TurnEvent) => {
      switch (ev.type) {
        case "turn.start":
          pending.current = { id: ev.turnId, sentences: [], facts: [] };
          voice.startTurn();
          break;
        case "speech.item":
          // Captions only: never fetch audio the learner has turned off.
          if (audioOffRef.current) break;
          voice.enqueue({
            index: ev.index,
            text: ev.text,
            lang: ev.lang,
            profile: ev.profile,
            sig: ev.sig,
            exp: ev.exp,
            // the signature binds the turn, which only turn.start carries
            turnId: pending.current?.id,
            sessionId,
          });
          break;
        case "display.delta":
          streamRef.current += ev.text;
          setStreamText(streamRef.current);
          break;
        case "display.sentence":
          if (pending.current) {
            pending.current.sentences[ev.index] = ev.text;
            // Assisted mode shows a figure the source does not carry, so it has to be marked.
            if (ev.unverified?.length) {
              pending.current.unverified = [
                ...(pending.current.unverified ?? []),
                ...ev.unverified,
              ];
            }
          }
          break;
        case "facts":
          pending.current?.facts.push(...ev.ids);
          break;
        case "move":
          if (pending.current) pending.current.move = ev.id;
          break;
        case "ui": {
          const parsed = UiPayloadSchema.safeParse(ev.payload);
          setUi(parsed.success ? parsed.data : null);
          break;
        }
        case "verdict": {
          const c = (ev.data as { consequence?: string | null } | null)?.consequence;
          if (c) setConsequence(c);
          break;
        }
        case "gamification":
          setGamification(parseGamification(ev.data));
          break;
        case "inspector": {
          const d = ev.delta as InspectorDelta;
          setInspector(d);
          if (pending.current && d?.move?.type === "out_of_source") {
            pending.current.outOfSource = true;
          }
          // completed and total count the questions in the current mission, not the missions
          // in the journey, so finishing them is not finishing the journey. mission.changed
          // says which it was.
          break;
        }
        case "mission.changed": {
          if (ev.journeyComplete) {
            setFinished(true);
          } else {
            // The server already moved the session on. Refetch so the route strip, the station
            // count and the first question of the new mission all come from one source.
            setMissionAdvancing(true);
            void reloadSession().finally(() => setMissionAdvancing(false));
          }
          break;
        }
        case "retract":
          pending.current = null;
          streamRef.current = "";
          setStreamText("");
          pushSystem("The tutor's reply was withdrawn. Send your answer again.");
          break;
        case "error":
          pushSystem(ev.message);
          if (ev.code === "TURN_NOT_SAVED") {
            void fetch(`/api/sessions/${sessionId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d: SessionData | null) => {
                if (d) setUi(d.ui ?? null);
              });
          }
          break;
        case "turn.end":
          setTimings(ev.timings ?? null);
          finalizeTutor();
          break;
        default:
          break;
      }
    },
    [finalizeTutor, pushSystem, sessionId, voice],
  );

  const runTurn = useCallback(
    async (input: TurnInputBody, learnerText?: string) => {
      const learnerId = `learner-${Date.now()}`;
      if (learnerText) {
        setTurns((prev) => [
          ...prev,
          { id: learnerId, role: "learner", text: learnerText, lang: language },
        ]);
      }
      pending.current = null;
      streamRef.current = "";
      setStreamText("");
      setConsequence(null);
      const responseMs = replyAt.current ? Date.now() - replyAt.current : undefined;
      // A barge-in tells the next prompt how much of the last reply the learner heard.
      const withInterruption = { ...input, ...voice.takeInterruption() };
      const result = await sendTurn(
        responseMs && input.mode !== "start"
          ? { ...withInterruption, clientTimings: { responseMs } }
          : withInterruption,
        { onEvent },
      );
      if (!result.sent) return;
      if (result.aborted) {
        // The server retracts an aborted turn and stores nothing, so the screen matches: no
        // partial reply, no learner bubble, one notice.
        pending.current = null;
        streamRef.current = "";
        setStreamText("");
        setLastAnswer(null);
        setTurns((prev) => [
          ...prev.filter((t) => t.id !== learnerId),
          {
            id: `sys-${Date.now()}`,
            role: "system",
            text: "You stopped the tutor's reply. Send your answer again when ready.",
          },
        ]);
        return;
      }
      finalizeTutor();
    },
    [sendTurn, onEvent, finalizeTutor, language, voice],
  );

  // Load the session, then open the mission if it has not started yet.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (res.status === 404) {
          if (!cancelled) {
            setNotFound(true);
            setLoading(false);
          }
          return;
        }
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(err.error?.message || "The session could not be loaded. Try again.");
        }
        const data: SessionData = await res.json();
        if (cancelled) return;
        setSession(data);
        setTurns(data.turns || []);
        setPersona(data.personaId || "branch_new_joiner");
        setLanguage((data.language as UiLang) || "en");
        setUi(data.ui ?? null);
        setFinished(Boolean(data.progress?.finished));
        setLoading(false);
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : "The session could not be loaded.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Opens a mission that has not begun: the first one on load, and each later station after
  // the engine moves the session on. Keyed on the mission id, so the same one is never opened
  // twice and a station change is not missed.
  useEffect(() => {
    if (!session || session.status !== "active") return;
    if (session.progress?.started) return;
    const missionId = session.currentMissionId ?? null;
    if (!missionId || startedRef.current === missionId) return;
    startedRef.current = missionId;
    void runTurn({ mode: "start" });
  }, [session, runTurn]);

  // What this device and network actually allow. Probed once per
  // language so a blocked WebSocket or a missing Urdu voice is caught before the learner
  // presses talk and gets nothing.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const audioEnabled = session.accessibility?.audioEnabled ?? true;
    audioOffRef.current = !audioEnabled;
    void detectVoiceCapabilities({ lang: language, outputEnabled: audioEnabled }).then((caps) => {
      if (!cancelled) setCapabilities(caps);
    });
    return () => {
      cancelled = true;
    };
  }, [session, language]);

  const handleSend = useCallback(
    (text: string) => {
      voice.unlock();
      void runTurn({ mode: "text", text }, text);
    },
    [runTurn, voice],
  );
  const handleHint = useCallback(() => {
    voice.unlock();
    void runTurn({ mode: "text", text: "I need a hint" }, "I need a hint");
  }, [runTurn, voice]);
  const handleAnswer = useCallback(
    (a: MechanicAnswer) => {
      voice.unlock();
      setLastAnswer(a.answer);
      const shown =
        typeof a.answer === "string"
          ? labelFor(ui, a.answer)
          : Array.isArray(a.answer)
            ? a.answer.map((id) => labelFor(ui, id)).join(" > ")
            : Object.entries(a.answer)
                .map(([l, r]) => `${l}: ${r}`)
                .join("; ");
      void runTurn({ mode: a.mode, answer: a.answer }, shown);
    },
    [runTurn, ui, voice],
  );

  const applyControls = useCallback(
    async (body: { language?: string; personaId?: string }) => {
      const applied = await controls.apply({ language: body.language, persona: body.personaId });
      // The panel reason is what the Inspector and the transcript show for the switch.
      for (const a of applied) pushSystem(a.reason);
    },
    [controls, pushSystem],
  );
  const handleLanguage = useCallback(
    (l: string) => {
      setLanguage(l as UiLang);
      void applyControls({ language: l });
    },
    [applyControls],
  );
  const handlePersona = useCallback(
    (p: string) => {
      setPersona(p);
      void applyControls({ personaId: p });
    },
    [applyControls],
  );

  if (loading) {
    return (
      <div
        data-testid="session-loading"
        className="bg-paper text-ink flex min-h-screen items-center justify-center"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="border-mist border-t-neem h-6 w-6 animate-spin rounded-full border-2" />
          <p className="text-ink/70 text-xs font-medium">Loading session...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <main
        id="main-content"
        data-testid="session-not-found"
        className="bg-paper text-ink flex min-h-screen flex-col items-center justify-center p-6 text-center"
      >
        <div className="border-mist max-w-md rounded-2xl border bg-white p-8 shadow-sm">
          <span className="text-kattha text-xs font-bold">404</span>
          <h1 className="text-ink mt-2 text-lg font-bold">Session Not Found</h1>
          <p className="text-ink/70 mt-2 text-xs">
            This practice session does not exist or belongs to another account.
          </p>
          <div className="mt-6">
            <Link
              href="/learn"
              className="bg-neem hover:bg-neem/90 inline-flex rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors focus-visible:outline-none"
            >
              Back to Practice
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (errorMessage) {
    return (
      <main
        id="main-content"
        className="bg-paper text-ink flex min-h-screen flex-col items-center justify-center p-6 text-center"
      >
        <div className="border-kattha/20 max-w-md rounded-2xl border bg-white p-8 shadow-sm">
          <h1 className="text-kattha text-lg font-bold">Unable to load session</h1>
          <p className="text-ink/70 mt-2 text-xs">{errorMessage}</p>
          <div className="mt-6">
            <Link
              href="/learn"
              className="bg-neem hover:bg-neem/90 inline-flex rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors focus-visible:outline-none"
            >
              Back to Practice
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const currentOrdinal = (session?.currentMission?.ordinal ?? 0) + 1;
  const totalMissions = session?.totalMissions || 1;
  const composerLocked = finished || session?.status !== "active";

  return (
    <div className="bg-paper text-ink flex min-h-0 flex-1 flex-col">
      <SessionToolbar
        journeyTitle={session?.journeyTitle}
        currentPersona={persona}
        onPersonaChange={handlePersona}
        currentLanguage={language}
        onLanguageChange={handleLanguage}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((prev) => !prev)}
      />

      <RouteStrip
        currentStation={currentOrdinal}
        totalStations={totalMissions}
        missionTitle={session?.currentMission?.title || "Practice Mission"}
        journeyTitle={session?.journeyTitle}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <Conversation
          language={language}
          turns={turns}
          isStreaming={isStreaming}
          streamingDelta={streamText}
          className="flex-1"
          renderAfter={(turn) => {
            if (turn.role !== "tutor" || !turn.facts?.length) return null;
            return (
              <div data-testid="turn-facts" className="mt-1 flex flex-wrap gap-1.5">
                {turn.facts.map((fid) => {
                  const fact = session?.facts?.find((f) => f.id === fid);
                  return (
                    <FactChip
                      key={fid}
                      factId={fid}
                      statement={fact?.statement}
                      onClick={() => handleOpenSource(fid)}
                    />
                  );
                })}
              </div>
            );
          }}
        >
          {consequence && (
            <aside
              data-testid="consequence"
              aria-label="What happens next"
              className="border-mist bg-paper text-ink border-s-mist rounded-lg border border-s-4 px-4 py-3 text-sm"
            >
              <span className="text-ink/70 text-xs font-semibold">What happens: </span>
              <BidiText text={consequence} as="span" />
            </aside>
          )}
          {missionAdvancing && (
            <div
              role="status"
              data-testid="mission-advancing"
              className="border-neem/50 bg-neem/10 text-ink flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
            >
              <span className="border-neem h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent" />
              Station complete. Opening the next one.
            </div>
          )}
          {ui && !finished && !missionAdvancing && (
            <div data-testid="mechanic" className="mt-2">
              <Mechanic
                ui={ui}
                lang={language}
                disabled={isStreaming}
                lastAnswer={lastAnswer}
                onAnswer={handleAnswer}
              />
            </div>
          )}
          {finished && !missionAdvancing && (
            <div
              role="status"
              data-testid="mission-complete"
              className="border-haldi/60 bg-haldi/10 text-ink rounded-lg border px-4 py-3 text-sm"
            >
              Journey complete. Well done.{" "}
              <Link href="/learn" className="text-neem font-semibold underline">
                Back to your journey
              </Link>
            </div>
          )}
          {(turnError || controls.error) && (
            <p role="alert" className="text-kattha text-xs">
              {turnError ?? controls.error}
            </p>
          )}
        </Conversation>

        <Inspector
          sessionId={sessionId}
          toggleId="toggle-inspector-btn"
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          delta={inspector}
          turnTimings={timings}
          persona={persona}
          language={language}
          station={`${currentOrdinal} of ${totalMissions}`}
        />
      </div>

      <Composer
        onSend={handleSend}
        onHint={handleHint}
        sessionId={sessionId}
        contentId={session?.contentId}
        voiceEnabled={capabilities ? capabilities.inputMode !== "none" : true}
        speechNotice={voice.notice ?? capabilities?.notice ?? null}
        onTalkStart={() => {
          voice.unlock();
          voice.bargeIn();
        }}
        isLoading={isStreaming}
        disabled={composerLocked}
        onStop={isStreaming ? abort : undefined}
        placeholder={
          composerLocked
            ? "This mission is complete."
            : "Type your reply... (Enter to send, Shift+Enter for a new line)"
        }
      />

      <GamificationLayer data={gamification} onDismiss={() => setGamification(null)} />

      <SourceDrawer
        open={!!selectedFact}
        onClose={() => setSelectedFact(null)}
        factId={selectedFact?.id ?? null}
        statement={selectedFact?.statement}
        quote={selectedFact?.quote}
        anchorKind={selectedFact?.anchorKind}
        anchorRef={selectedFact?.anchorRef}
        chunkText={selectedFact?.chunkText}
        loading={selectedFact?.loading}
      />
    </div>
  );
}

/** The learner's tap shown in their bubble: the option label rather than its id. */
function labelFor(ui: UiPayload | null, id: string): string {
  const items = ui?.options ?? ui?.steps ?? [];
  const hit = items.find((o) => o.id === id);
  if (hit) return hit.label.en;
  const sentence = ui?.sentences?.find((s) => s.id === id);
  return sentence ? sentence.text.en : id;
}
