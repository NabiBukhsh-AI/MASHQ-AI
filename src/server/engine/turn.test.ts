import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import {
  acquireTurnLock,
  releaseTurnLock,
  getIdempotentTurn,
  saveIdempotentTurn,
  clearTurnLocks,
} from "./lock";
import type { TurnEvent } from "@/lib/schemas/turn-events";

describe("Turn Engine & Locks", () => {
  beforeEach(() => {
    clearTurnLocks();
  });

  describe("Lock & Idempotency", () => {
    it("locks session and rejects concurrent turn", async () => {
      const sessionId = "session_lock_test";
      const locked1 = await acquireTurnLock(sessionId);
      expect(locked1).toBe(true);

      const locked2 = await acquireTurnLock(sessionId);
      expect(locked2).toBe(false);

      await releaseTurnLock(sessionId);
      const locked3 = await acquireTurnLock(sessionId);
      expect(locked3).toBe(true);
    });

    it("saves and retrieves idempotent turn event payloads", async () => {
      const sessionId = "session_idem_test";
      const key = "idem_key_1";
      const sampleEvents: TurnEvent[] = [
        { type: "turn.start", turnId: "t1" },
        { type: "display.delta", text: "Welcome" },
        { type: "end" },
      ];

      expect(await getIdempotentTurn(sessionId, key)).toBeNull();

      await saveIdempotentTurn(sessionId, key, sampleEvents);
      const retrieved = await getIdempotentTurn(sessionId, key);
      expect(retrieved).toEqual(sampleEvents);
    });
  });
});

// Live: a real session on the demo journey, with a fake model stream. Exercises
// loadSession, the content pack layers, policy, state progression and persistence.
describe.skipIf(!process.env.LIVE_DB)("executeTurn (live rows, fake model)", () => {
  let db: typeof import("../db/client").db;
  let s: typeof import("../db/schema");
  let sessionId: string;
  let userId: string;
  let orgId: string;
  let executeTurn: typeof import("./turn").executeTurn;
  type Ev = import("@/lib/schemas/turn-events").TurnEvent;

  const usage = {
    tier: "fast",
    provider: "anthropic",
    model: "x",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    ttftMs: 1,
    latencyMs: 1,
    fallback: false,
  };
  const fakeLlm = (lines: string[]) => ({
    stream: vi.fn(async () => ({
      textStream: (async function* () {
        for (const l of lines) yield l + "\n";
      })(),
      usage: Promise.resolve(usage),
      abort: () => {},
    })),
  });

  const collect = async (
    input: Record<string, unknown> | undefined,
    lines: string[],
    signal?: AbortSignal,
  ) => {
    const out: Ev[] = [];
    for await (const ev of executeTurn(
      { sessionId, userId, orgId, input: input as never, signal },
      { llm: fakeLlm(lines) as never },
    ))
      out.push(ev);
    return out;
  };

  beforeAll(async () => {
    ({ executeTurn } = await import("./turn"));
    db = (await import("../db/client")).db;
    s = await import("../db/schema");
    const { eq, and } = await import("drizzle-orm");
    const [journey] = await db
      .select({ id: s.journeys.id, orgId: s.journeys.orgId })
      .from(s.journeys)
      .where(eq(s.journeys.status, "ready"))
      .limit(1);
    if (!journey) throw new Error("Run pnpm pipeline:live once so a ready journey exists.");
    orgId = journey.orgId;
    const [learner] = await db
      .select({ id: s.user.id })
      .from(s.user)
      .where(and(eq(s.user.orgId, orgId), eq(s.user.role, "learner")))
      .limit(1);
    userId = learner!.id;
    const { createSession } = await import("./session");
    sessionId = await createSession({
      journeyId: journey.id,
      userId,
      orgId,
      personaId: "branch_new_joiner",
      language: "en",
    });
  }, 60_000);

  afterAll(async () => {
    const { eq } = await import("drizzle-orm");
    if (sessionId) {
      await db.delete(s.evidenceEvents).where(eq(s.evidenceEvents.sessionId, sessionId));
      await db.delete(s.adaptationEvents).where(eq(s.adaptationEvents.sessionId, sessionId));
      await db.delete(s.learningSessions).where(eq(s.learningSessions.id, sessionId));
    }
  });

  it("opens the mission with the first question and a ui payload", async () => {
    const events = await collect({ mode: "start" }, [
      "@@m mv_open",
      "@@d Welcome to the branch.",
      "@@d What would you do first?",
      "@@end",
    ]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("turn.start");
    expect(types).toEqual(
      expect.arrayContaining([
        "move",
        "display.delta",
        "display.sentence",
        "ui",
        "inspector",
        "turn.end",
        "end",
      ]),
    );
    const ui = events.find((e) => e.type === "ui") as {
      payload: { questionId: string; kind: string };
    };
    expect(ui.payload.questionId).toBeTruthy();
    const insp = events.find((e) => e.type === "inspector") as {
      delta: { move: { ruleId: string } };
    };
    expect(insp.delta.move.ruleId).toBe("R99");
  }, 60_000);

  it("grades a wrong text answer inline, applies R07 (hint level 1) and persists redacted turns", async () => {
    const events = await collect(
      { mode: "text", text: "I would ask for a photocopy of the CNIC, my number is 0300-1234567" },
      [
        '@@g {"verdict":"incorrect","question":"q1","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
        "@@m mv_incorrect",
        "@@d Not quite, a photocopy is not accepted.",
        "@@d Look at what the guide says about the original card.",
        "@@end",
      ],
    );
    const verdict = events.find((e) => e.type === "verdict") as { data: { verdict: string } };
    expect(verdict.data.verdict).toBe("incorrect");
    const insp = events.find((e) => e.type === "inspector") as {
      delta: { move: { ruleId: string; type: string }; hintLevel: number; attempts: number };
    };
    expect(insp.delta.move.ruleId).toBe("R07");
    expect(insp.delta.move.type).toBe("feedback_incorrect");
    expect(insp.delta.hintLevel).toBe(1);
    expect(insp.delta.attempts).toBe(1);
    expect(events.some((e) => e.type === "ui")).toBe(false);

    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ role: s.turns.role, text: s.turns.text })
      .from(s.turns)
      .where(eq(s.turns.sessionId, sessionId));
    const learner = rows.find((r) => r.role === "learner");
    expect(learner?.text).toContain("[PHONE-1]");
    expect(learner?.text).not.toContain("0300");

    const evRows = await db
      .select()
      .from(s.evidenceEvents)
      .where(eq(s.evidenceEvents.sessionId, sessionId));
    expect(evRows.length).toBeGreaterThanOrEqual(1);
    expect(evRows[0]?.verdict).toBe("incorrect");
    expect(evRows[0]?.score).toBe(0);
  }, 60_000);

  it("second wrong answer gets the worked example (R06); a correct answer advances the question", async () => {
    const wrong = await collect({ mode: "text", text: "Still a photocopy" }, [
      '@@g {"verdict":"incorrect","question":"q1","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
      "@@m mv_worked",
      "@@d Here is how it works step by step.",
      "@@end",
    ]);
    const insp = wrong.find((e) => e.type === "inspector") as {
      delta: { move: { ruleId: string; type: string } };
    };
    expect(insp.delta.move.type).toBe("worked_example");

    const right = await collect(
      { mode: "text", text: "Ask for the original CNIC and compare the photo." },
      [
        '@@g {"verdict":"correct","question":"q1","concept":"c","misconception":null,"score":1,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
        "@@m mv_correct",
        "@@d Exactly right.",
        "@@d Next, a customer arrives upset.",
        "@@end",
      ],
    );
    const i2 = right.find((e) => e.type === "inspector") as {
      delta: { completed: number; move: { type: string } };
    };
    expect(["feedback_correct", "celebrate_unlock"]).toContain(i2.delta.move.type);
    expect(i2.delta.completed).toBe(1);
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ state: s.learningSessions.state })
      .from(s.learningSessions)
      .where(eq(s.learningSessions.id, sessionId));
    expect((row!.state as { completed: string[] }).completed).toHaveLength(1);
  }, 60_000);

  it("retracts on a stream error and on abort", async () => {
    const failing = {
      stream: vi.fn(async () => ({
        textStream: (async function* () {
          yield "@@d Starting...\n";
          throw new Error("boom");
        })(),
        usage: Promise.resolve(usage),
        abort: () => {},
      })),
    };
    const out: string[] = [];
    for await (const ev of executeTurn(
      { sessionId, userId, orgId, input: { mode: "text", text: "hello" } },
      { llm: failing as never },
    ))
      out.push(ev.type);
    expect(out).toContain("retract");
    expect(out[out.length - 1]).toBe("end");

    const ac = new AbortController();
    ac.abort();
    const aborted = await collect(
      { mode: "text", text: "hi" },
      ["@@d one", "@@d two", "@@end"],
      ac.signal,
    );
    expect(aborted.map((e) => e.type)).toContain("retract");
  }, 60_000);

  it("panel controls: the next turn acknowledges the switch (R03), renders with the new persona and language, and the Inspector carries the reason", async () => {
    const { applySessionControls } = await import("./controls");
    const { eq } = await import("drizzle-orm");
    const result = await applySessionControls({
      sessionId,
      userId,
      orgId,
      controls: { persona: "senior_manager", language: "ur-Latn", register: "formal" },
      actorId: userId,
    });
    expect(result.applied.map((a) => a.kind)).toEqual(["persona", "language", "register"]);
    expect(result.applied[0]!.reason).toContain("Senior manager");
    const [row] = await db
      .select({
        personaId: s.learningSessions.personaId,
        language: s.learningSessions.language,
        register: s.learningSessions.register,
      })
      .from(s.learningSessions)
      .where(eq(s.learningSessions.id, sessionId));
    expect(row).toEqual({ personaId: "senior_manager", language: "ur-Latn", register: "formal" });
    const panelRows = await db
      .select({
        ruleId: s.adaptationEvents.ruleId,
        source: s.adaptationEvents.source,
        moveType: s.adaptationEvents.moveType,
      })
      .from(s.adaptationEvents)
      .where(eq(s.adaptationEvents.sessionId, sessionId));
    // The three rows are written in one insert, so compare them as a multiset, not in row order.
    expect(
      panelRows
        .filter((r) => r.source === "panel_control")
        .map((r) => `${r.ruleId}:${r.moveType}`)
        .sort(),
    ).toEqual(["R03:restyle", "R03:restyle", "R03:switch_language"]);

    // A non-answer after the switch: R03 acknowledges it; the prompt's final message carries the new values.
    const llm = fakeLlm([
      '@@g {"verdict":"not_an_answer","question":"q","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"ur-Latn","confidence_cue":"none"}',
      "@@m mv_restyle",
      "Theek hai, chalein.",
      "@@end",
    ]);
    const out: Ev[] = [];
    for await (const ev of executeTurn(
      { sessionId, userId, orgId, input: { mode: "text", text: "theek hai" } },
      { llm: llm as never },
    ))
      out.push(ev);
    const inspector = out.find((e) => e.type === "inspector") as {
      delta: { move: { ruleId: string; type: string }; switches: { kind: string }[] };
    };
    expect(inspector.delta.move).toMatchObject({ ruleId: "R03", type: "restyle" });
    expect(inspector.delta.switches.map((sw) => sw.kind)).toEqual([
      "persona",
      "language",
      "register",
    ]);
    const call = (llm.stream.mock.calls as unknown as [string, { final: string }][])[0]!;
    const req = call[1].final;
    expect(req).toContain("language: ur-Latn");
    expect(req).toContain("register: formal");
    expect(req).toContain("persona: senior_manager");
    // acknowledged once: the queue is cleared and the turn's own state survived
    const [after] = await db
      .select({
        pendingSwitch: s.learningSessions.pendingSwitch,
        state: s.learningSessions.state,
      })
      .from(s.learningSessions)
      .where(eq(s.learningSessions.id, sessionId));
    expect(after!.pendingSwitch).toEqual([]);
    expect((after!.state as { started?: boolean }).started).toBe(true);
  }, 60_000);

  it("a control posted while a turn is in flight is queued, not lost, and does not revert the turn's state", async () => {
    const { applySessionControls } = await import("./controls");
    const { eq } = await import("drizzle-orm");
    const [before] = await db
      .select({ state: s.learningSessions.state })
      .from(s.learningSessions)
      .where(eq(s.learningSessions.id, sessionId));
    const questionIndexBefore = (before!.state as { questionIndex?: number }).questionIndex ?? 0;

    // Force the interleaving: the stream does not finish until the control has been written,
    // so the turn's persist definitely runs after it.
    let releaseStream: () => void = () => {};
    const controlWritten = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const lines = [
      '@@g {"verdict":"not_an_answer","question":"q","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
      "@@m mv_clarify",
      "Let us try again.",
      "@@end",
    ];
    const llm = {
      stream: vi.fn(async () => ({
        textStream: (async function* () {
          yield lines[0] + "\n";
          await controlWritten;
          for (const l of lines.slice(1)) yield l + "\n";
        })(),
        usage: Promise.resolve(usage),
        abort: () => {},
      })),
    };
    const events: Ev[] = [];
    const turn = (async () => {
      for await (const ev of executeTurn(
        { sessionId, userId, orgId, input: { mode: "text", text: "hmm" } },
        { llm: llm as never },
      ))
        events.push(ev);
    })();
    await applySessionControls({
      sessionId,
      userId,
      orgId,
      controls: { modality: "voice" },
      actorId: userId,
    });
    releaseStream();
    await turn;
    expect(events.some((e) => e.type === "turn.end")).toBe(true);

    const [after] = await db
      .select({
        pendingSwitch: s.learningSessions.pendingSwitch,
        state: s.learningSessions.state,
        modality: s.learningSessions.modality,
      })
      .from(s.learningSessions)
      .where(eq(s.learningSessions.id, sessionId));
    // The switch survives for the next turn, and the turn's own progress survives the control.
    expect(after!.pendingSwitch.map((sw) => sw.kind)).toEqual(["modality"]);
    expect(after!.modality).toBe("voice");
    expect((after!.state as { questionIndex?: number }).questionIndex).toBe(questionIndexBefore);
    expect((after!.state as { engagement?: unknown }).engagement).toBeDefined();
  }, 60_000);

  it("a preset switch changes the persona, language and register the next turn actually uses", async () => {
    const { applySessionControls } = await import("./controls");
    const { eq } = await import("drizzle-orm");
    await applySessionControls({
      sessionId,
      userId,
      orgId,
      controls: { persona: "branch_new_joiner", language: "en", register: "colleague" },
      actorId: userId,
    });
    // Drain anything the previous test left queued, so this test reads its own switch first.
    await collect({ mode: "text", text: "ok" }, [
      '@@g {"verdict":"not_an_answer","question":"q","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
      "@@m mv_restyle",
      "Sure.",
      "@@end",
    ]);
    const result = await applySessionControls({
      sessionId,
      userId,
      orgId,
      controls: { preset: "senior_manager" },
      actorId: userId,
    });
    // The preset is acknowledged and its session-visible choices are applied.
    expect(result.applied.map((a) => a.kind)).toEqual(["preset", "persona", "register"]);
    expect(result.personaId).toBe("senior_manager");
    const [row] = await db
      .select({
        personaId: s.learningSessions.personaId,
        register: s.learningSessions.register,
        presets: s.learningSessions.presets,
      })
      .from(s.learningSessions)
      .where(eq(s.learningSessions.id, sessionId));
    expect(row).toMatchObject({ personaId: "senior_manager", register: "formal" });
    expect(row!.presets).toContain("senior_manager");

    const llm = fakeLlm([
      '@@g {"verdict":"not_an_answer","question":"q","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
      "@@m mv_restyle",
      "Noted.",
      "@@end",
    ]);
    const out: Ev[] = [];
    for await (const ev of executeTurn(
      { sessionId, userId, orgId, input: { mode: "text", text: "ok" } },
      { llm: llm as never },
    ))
      out.push(ev);
    const inspector = out.find((e) => e.type === "inspector") as {
      delta: {
        move: { ruleId: string; params: Record<string, unknown> };
        switches: { kind: string }[];
      };
    };
    // R03 names the preset rather than falling through to another kind.
    expect(inspector.delta.move.ruleId).toBe("R03");
    expect(inspector.delta.move.params).toMatchObject({ kind: "preset", to: "senior_manager" });
    expect(inspector.delta.switches[0]).toMatchObject({ kind: "preset" });
    const call = (llm.stream.mock.calls as unknown as [string, { final: string }][])[0]!;
    expect(call[1].final).toContain("persona: senior_manager");
    expect(call[1].final).toContain("register: formal");

    const unknown = applySessionControls({
      sessionId,
      userId,
      orgId,
      controls: { preset: "no_such_preset" },
      actorId: userId,
    });
    await expect(unknown).rejects.toMatchObject({ status: 400 });
  }, 90_000);

  it("fails closed for a session that belongs to someone else", async () => {
    const out: Ev[] = [];
    for await (const ev of executeTurn(
      { sessionId, userId: "someone-else", orgId, input: { mode: "start" } },
      { llm: fakeLlm(["@@end"]) as never },
    ))
      out.push(ev);
    expect(out[0]).toMatchObject({ type: "error", code: "SESSION_NOT_FOUND" });
  }, 60_000);
});
