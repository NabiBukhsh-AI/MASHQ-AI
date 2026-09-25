import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Live: one real session on the demo journey. Covers what the Inspector must not get wrong:
// tenancy, model-id withholding, the cache share and cost maths, and evidence that reflects a
// later correction (the extractor updates rows in place, so a cursor would hide it).
describe.skipIf(!process.env.LIVE_DB)("inspectorSnapshot (live rows)", () => {
  let db: typeof import("../db/client").db;
  let s: typeof import("../db/schema");
  let inspectorSnapshot: typeof import("./inspector").inspectorSnapshot;
  let sessionId: string;
  let userId: string;
  let orgId: string;
  let conceptId: string;

  beforeAll(async () => {
    ({ inspectorSnapshot } = await import("./inspector"));
    db = (await import("../db/client")).db;
    s = await import("../db/schema");
    const { eq, and } = await import("drizzle-orm");
    const { uuidv7 } = await import("@/lib/ids");
    const [journey] = await db
      .select({ id: s.journeys.id, orgId: s.journeys.orgId, contentId: s.journeys.contentId })
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
    const [concept] = await db
      .select({ id: s.concepts.id })
      .from(s.concepts)
      .where(eq(s.concepts.contentId, journey.contentId))
      .limit(1);
    conceptId = concept!.id;
    const { createSession } = await import("./session");
    sessionId = await createSession({
      journeyId: journey.id,
      userId,
      orgId,
      personaId: "branch_new_joiner",
      language: "en",
    });

    await db.insert(s.evidenceEvents).values({
      id: uuidv7(),
      orgId,
      userId,
      sessionId,
      conceptId,
      signal: "choice",
      verdict: "incorrect",
      score: 0,
      hintLevel: 1,
      selfCorrected: false,
      weight: 0.4,
      credit: 0,
      guess: 0.33,
      pBefore: 0.2,
      pAfter: 0.16,
      source: "inline",
    });
    await db.insert(s.adaptationEvents).values({
      id: uuidv7(),
      orgId,
      sessionId,
      ruleId: "R07",
      moveType: "feedback_incorrect",
      modifiers: [],
      params: {},
      reason: "First incorrect answer on q1. Rule R07: gentle correction plus a level 1 hint.",
      inputs: {},
      configVersion: 1,
      source: "policy",
    });
    await db.insert(s.llmCalls).values({
      id: uuidv7(),
      orgId,
      sessionId,
      task: "turn.respond",
      tier: "fast",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 400,
      outputTokens: 120,
      cacheReadTokens: 3600,
      cacheWriteTokens: 0,
      costUsd: "0.002500",
      latencyMs: 2100,
      ttftMs: 900,
      status: "ok",
    });
  }, 60_000);

  afterAll(async () => {
    const { eq } = await import("drizzle-orm");
    if (!sessionId) return;
    await db.delete(s.llmCalls).where(eq(s.llmCalls.sessionId, sessionId));
    await db.delete(s.evidenceEvents).where(eq(s.evidenceEvents.sessionId, sessionId));
    await db.delete(s.adaptationEvents).where(eq(s.adaptationEvents.sessionId, sessionId));
    await db.delete(s.learningSessions).where(eq(s.learningSessions.id, sessionId));
  });

  it("returns this session's evidence, rules and timings with tiers but no model id", async () => {
    const snap = await inspectorSnapshot({ sessionId, userId, orgId });
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]).toMatchObject({
      verdict: "incorrect",
      signal: "choice",
      source: "inline",
    });
    expect(snap.events[0]!.conceptKey).toBeTruthy();
    expect(snap.rules.map((r) => r.ruleId)).toEqual(["R07"]);
    expect(snap.timings.calls).toHaveLength(1);
    // ui.showModelIdentifiers is off by default: the browser gets a tier, never a model id.
    expect(snap.timings.calls[0]!.model).toBeNull();
    expect(snap.timings.calls[0]!.tier).toBe("fast");
    expect(JSON.stringify(snap)).not.toContain("claude");
    // cache share is cached input over all input: 3600 / (400 + 3600)
    expect(snap.timings.totals.cacheShare).toBeCloseTo(0.9, 5);
    expect(snap.timings.totals.costUsd).toBeCloseTo(0.0025, 6);
    expect(snap.mode.showModelIdentifiers).toBe(false);
  }, 60_000);

  it("shows an extractor correction that updated a row in place, with or without a cursor", async () => {
    const { eq } = await import("drizzle-orm");
    const first = await inspectorSnapshot({ sessionId, userId, orgId });
    await db
      .update(s.evidenceEvents)
      .set({ verdict: "correct", score: 1, credit: 1, source: "extractor" })
      .where(eq(s.evidenceEvents.sessionId, sessionId));
    // The row kept its created_at, so a "since" filter would hide the correction.
    const after = await inspectorSnapshot({
      sessionId,
      userId,
      orgId,
      since: first.cursor ?? undefined,
    });
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ verdict: "correct", source: "extractor", score: 1 });
  }, 60_000);

  it("fails closed for another learner and for another organization", async () => {
    await expect(
      inspectorSnapshot({ sessionId, userId: "someone-else", orgId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      inspectorSnapshot({ sessionId, userId, orgId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ status: 404 });
  }, 60_000);
});
