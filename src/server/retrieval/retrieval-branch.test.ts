import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { isLearnerQuestion, runInTurnRetrieval } from "./question";
import { DEFAULT_CONFIG } from "../config/defaults";
import type { GlossaryEntry } from "./rewrite";

const retrieval = DEFAULT_CONFIG.grounding.retrieval;

describe("isLearnerQuestion", () => {
  it("detects English questions with question mark or interrogatives", () => {
    expect(isLearnerQuestion("What is the locker fee?")).toBe(true);
    expect(isLearnerQuestion("what is the locker fee")).toBe(true);
    expect(isLearnerQuestion("Can you explain the procedure?")).toBe(true);
    expect(isLearnerQuestion("can I open an account without CNIC")).toBe(true);
    expect(isLearnerQuestion("How do I verify customer identity?")).toBe(true);
    expect(isLearnerQuestion("Is a photocopy accepted?")).toBe(true);
    expect(isLearnerQuestion("Tell me about card replacement")).toBe(true);
    expect(isLearnerQuestion("Where is NADRA office?")).toBe(true);
  });

  it("detects Urdu script questions with Arabic question mark or interrogatives", () => {
    expect(isLearnerQuestion("لاکَر فیس کیا ہے؟")).toBe(true);
    expect(isLearnerQuestion("کیا شناختی کارڈ ضروری ہے؟")).toBe(true);
    expect(isLearnerQuestion("کیا بغیر شناختی کارڈ کے اکاؤنٹ کھل سکتا ہے")).toBe(true);
    expect(isLearnerQuestion("شکایت کہاں درج کرائیں؟")).toBe(true);
    expect(isLearnerQuestion("لاکَر کی فیس کتنی ہے")).toBe(true);
    expect(isLearnerQuestion("معلومات بتائیں")).toBe(true);
    expect(isLearnerQuestion("کون سا فارم چاہیے؟")).toBe(true);
  });

  it("detects Roman Urdu questions with question mark or interrogatives", () => {
    expect(isLearnerQuestion("locker ki fee kitni hai?")).toBe(true);
    expect(isLearnerQuestion("kya account khol sakte hain")).toBe(true);
    expect(isLearnerQuestion("kya photocopy accept hoti hai?")).toBe(true);
    expect(isLearnerQuestion("complaint kahan karein")).toBe(true);
    expect(isLearnerQuestion("fees batao")).toBe(true);
    expect(isLearnerQuestion("kesy verify karein")).toBe(true);
    expect(isLearnerQuestion("account opening procedure bataen")).toBe(true);
  });

  it("rejects non-question statements and learner mission answers", () => {
    expect(isLearnerQuestion("The original CNIC is required.")).toBe(false);
    expect(isLearnerQuestion("Offer a seat and smile.")).toBe(false);
    expect(isLearnerQuestion("A customer in his seventies arrives looking confused.")).toBe(false);
    expect(isLearnerQuestion("NADRA verification is complete.")).toBe(false);
    expect(isLearnerQuestion("I will check the form and verify signature.")).toBe(false);
    expect(isLearnerQuestion("")).toBe(false);
  });
});

describe("runInTurnRetrieval unit", () => {
  const glossary: GlossaryEntry[] = [
    { termEn: "CNIC verification", termUr: "شناختی کارڈ کی تصدیق", termRoman: "CNIC verification" },
    { termEn: "photocopy", termUr: "فوٹو کاپی", termRoman: "photocopy" },
  ];

  it("skips retrieval for non-question inputs", async () => {
    const res = await runInTurnRetrieval({
      text: "The customer provided an original CNIC.",
      orgId: "org-1",
      contentId: "content-1",
      glossary,
      retrievalConfig: retrieval,
    });
    expect(res.isQuestion).toBe(false);
    expect(res.retrievalRan).toBe(false);
    expect(res.inSource).toBe(false);
    expect(res.chunks).toEqual([]);
    expect(res.latencyMs).toBe(0);
  });

  it("uses glossary lookup for cross-lingual questions without calling LLM object", async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "c1",
            anchor_kind: "page",
            anchor_ref: "1",
            text: "A photocopy is not accepted for account changes.",
            injection_flag: false,
            rrf: "0.032",
            in_sem: false,
            in_kw: true,
          },
        ],
      }),
    };

    const res = await runInTurnRetrieval(
      {
        text: "kya photocopy accept hoti hai?",
        orgId: "org-1",
        contentId: "content-1",
        glossary,
        retrievalConfig: retrieval,
      },
      { db: mockDb as never },
    );

    expect(res.isQuestion).toBe(true);
    expect(res.retrievalRan).toBe(true);
    expect(res.inSource).toBe(true);
    expect(res.rewrittenQuery?.source).toBe("glossary");
    expect(res.chunks).toHaveLength(1);
    expect(res.excerptsForThisTurn).toContain('<chunk id="c1" anchor="page:1">');
    expect(res.excerptTexts).toEqual(["A photocopy is not accepted for account changes."]);
  });

  it("marks out-of-source when database returns no matches", async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const res = await runInTurnRetrieval(
      {
        text: "What is the mortgage interest rate?",
        orgId: "org-1",
        contentId: "content-1",
        glossary: [],
        retrievalConfig: retrieval,
      },
      { db: mockDb as never },
    );

    expect(res.isQuestion).toBe(true);
    expect(res.retrievalRan).toBe(true);
    expect(res.inSource).toBe(false);
    expect(res.chunks).toEqual([]);
    expect(res.excerptsForThisTurn).toBeUndefined();
    expect(res.excerptTexts).toEqual([]);
  });
});

describe.skipIf(!process.env.LIVE_DB)("retrieval-branch (live db)", () => {
  let db: typeof import("../db/client").db;
  let s: typeof import("../db/schema");
  let orgIdA: string;
  let orgIdB: string;
  let contentIdA: string;
  let contentIdB: string;
  let userId: string;

  const glossaryA: GlossaryEntry[] = [
    {
      termEn: "CNIC identity verification",
      termUr: "شناختی کارڈ کی تصدیق",
      termRoman: "CNIC verification",
    },
    { termEn: "photocopy", termUr: "فوٹو کاپی", termRoman: "photocopy" },
  ];

  beforeAll(async () => {
    db = (await import("../db/client")).db;
    s = await import("../db/schema");

    const [demoUser] = await db.select({ id: s.user.id }).from(s.user).limit(1);
    userId = demoUser!.id;

    // Org A
    const [orgA] = await db
      .insert(s.organizations)
      .values({ name: "Branch Retrieval A", slug: `ret-a-${Date.now()}` })
      .returning();
    orgIdA = orgA!.id;

    const [contentA] = await db
      .insert(s.contents)
      .values({
        orgId: orgIdA,
        ownerId: userId,
        title: "Welcoming Customers A",
        sourceType: "paste",
        sourceHash: `h-a-${Date.now()}`,
        parserVersion: "v1",
      })
      .returning();
    contentIdA = contentA!.id;

    await db.insert(s.contentChunks).values([
      {
        contentId: contentIdA,
        orgId: orgIdA,
        ordinal: 0,
        anchorKind: "section",
        anchorRef: "Identity first",
        charStart: 0,
        charEnd: 150,
        text: "Every account change starts with identity verification. Ask for the original CNIC. A photocopy is not accepted for account changes.",
        tokenCount: 25,
      },
      {
        contentId: contentIdA,
        orgId: orgIdA,
        ordinal: 1,
        anchorKind: "section",
        anchorRef: "Common requests",
        charStart: 151,
        charEnd: 300,
        text: "Mobile number or address update takes 5 minutes at the counter with original CNIC.",
        tokenCount: 20,
      },
    ]);

    // Org B
    const [orgB] = await db
      .insert(s.organizations)
      .values({ name: "Branch Retrieval B", slug: `ret-b-${Date.now()}` })
      .returning();
    orgIdB = orgB!.id;

    const [contentB] = await db
      .insert(s.contents)
      .values({
        orgId: orgIdB,
        ownerId: userId,
        title: "Welcoming Customers B",
        sourceType: "paste",
        sourceHash: `h-b-${Date.now()}`,
        parserVersion: "v1",
      })
      .returning();
    contentIdB = contentB!.id;

    await db.insert(s.contentChunks).values([
      {
        contentId: contentIdB,
        orgId: orgIdB,
        ordinal: 0,
        anchorKind: "section",
        anchorRef: "Different Org",
        charStart: 0,
        charEnd: 150,
        text: "Org B secret chunk regarding customer identity and verification procedures.",
        tokenCount: 20,
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.delete(s.contents).where(inArray(s.contents.id, [contentIdA, contentIdB]));
    await db.delete(s.organizations).where(inArray(s.organizations.id, [orgIdA, orgIdB]));
  });

  it("retrieves the right English chunk for an Urdu question with glossary match", async () => {
    const res = await runInTurnRetrieval(
      {
        text: "کیا شناختی کارڈ کی فوٹو کاپی قبول کی جاتی ہے؟",
        orgId: orgIdA,
        contentId: contentIdA,
        glossary: glossaryA,
        retrievalConfig: retrieval,
      },
      { db },
    );

    expect(res.isQuestion).toBe(true);
    expect(res.retrievalRan).toBe(true);
    expect(res.inSource).toBe(true);
    expect(res.chunks.length).toBeGreaterThanOrEqual(1);
    expect(res.chunks[0]!.text).toContain("A photocopy is not accepted");
    expect(res.excerptsForThisTurn).toContain("Identity first");
    expect(res.excerptTexts.some((t) => t.includes("original CNIC"))).toBe(true);
  });

  it("retrieves the right English chunk for a Roman Urdu question with glossary match", async () => {
    const res = await runInTurnRetrieval(
      {
        text: "kya photocopy accept hoti hai?",
        orgId: orgIdA,
        contentId: contentIdA,
        glossary: glossaryA,
        retrievalConfig: retrieval,
      },
      { db },
    );

    expect(res.isQuestion).toBe(true);
    expect(res.inSource).toBe(true);
    expect(res.chunks[0]!.text).toContain("photocopy is not accepted");
  });

  it("marks an unrelated question as out-of-source", async () => {
    const res = await runInTurnRetrieval(
      {
        text: "What is the mortgage home loan interest rate?",
        orgId: orgIdA,
        contentId: contentIdA,
        glossary: glossaryA,
        retrievalConfig: retrieval,
      },
      { db },
    );

    expect(res.isQuestion).toBe(true);
    expect(res.retrievalRan).toBe(true);
    expect(res.inSource).toBe(false);
    expect(res.chunks).toHaveLength(0);
    expect(res.excerptsForThisTurn).toBeUndefined();
  });

  it("maintains tenant isolation and never retrieves chunks from another org", async () => {
    const crossRes = await runInTurnRetrieval(
      {
        text: "identity verification",
        orgId: orgIdA,
        contentId: contentIdB,
        glossary: glossaryA,
        retrievalConfig: retrieval,
      },
      { db },
    );

    expect(crossRes.chunks).toHaveLength(0);
    expect(crossRes.inSource).toBe(false);
  });

  it("executes retrieval under 400 ms p50", async () => {
    const latencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await runInTurnRetrieval(
        {
          text: "kya photocopy accept hoti hai?",
          orgId: orgIdA,
          contentId: contentIdA,
          glossary: glossaryA,
          retrievalConfig: retrieval,
        },
        { db },
      );
      latencies.push(res.latencyMs);
    }
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length / 2)]!;
    expect(p50).toBeLessThan(400);
  });
});

describe.skipIf(!process.env.LIVE_DB)("executeTurn retrieval integration", () => {
  let db: typeof import("../db/client").db;
  let s: typeof import("../db/schema");
  let sessionId: string;
  let userId: string;
  let orgId: string;
  let executeTurn: typeof import("../engine/turn").executeTurn;
  let createSession: typeof import("../engine/session").createSession;

  function fakeLlm(lines: string[], capture?: { lastReq?: unknown }) {
    return {
      stream: vi.fn(async (_task: string, req: unknown) => {
        if (capture) capture.lastReq = req;
        return {
          textStream: (async function* () {
            for (const l of lines) yield l + "\n";
          })(),
          usage: Promise.resolve({
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
          }),
          abort: () => {},
        };
      }),
    };
  }

  beforeAll(async () => {
    db = (await import("../db/client")).db;
    s = await import("../db/schema");
    ({ executeTurn } = await import("../engine/turn"));
    ({ createSession } = await import("../engine/session"));

    const [journey] = await db
      .select({ id: s.journeys.id, orgId: s.journeys.orgId })
      .from(s.journeys)
      .where(eq(s.journeys.status, "ready"))
      .limit(1);
    if (!journey) return;

    orgId = journey.orgId;
    const [u] = await db.select({ id: s.user.id }).from(s.user).limit(1);
    userId = u!.id;

    sessionId = await createSession({
      journeyId: journey.id,
      userId,
      orgId,
      personaId: "branch_new_joiner",
      language: "en",
    });
  });

  afterAll(async () => {
    if (sessionId) {
      await db.delete(s.learningSessions).where(eq(s.learningSessions.id, sessionId));
    }
  });

  it("handles out-of-source questions by selecting out_of_source move and recording retrievalMs", async () => {
    if (!sessionId) return;
    const events: import("@/lib/schemas/turn-events").TurnEvent[] = [];
    const llm = fakeLlm([
      '@@g {"verdict":"not_an_answer","question":"q1","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
      "@@m mv_oos_strict",
      "@@d Your material does not cover that. Would you like to continue with the mission?",
      "@@end",
    ]);

    for await (const ev of executeTurn(
      {
        sessionId,
        userId,
        orgId,
        input: { mode: "text", text: "What is the mortgage home loan interest rate?" },
      },
      { llm: llm as never },
    )) {
      events.push(ev);
    }

    const insp = events.find((e) => e.type === "inspector") as {
      delta: {
        verdict: { outOfSource: boolean; verdict: string };
        move: { type: string; ruleId: string };
      };
    };
    expect(insp).toBeDefined();
    expect(insp.delta.verdict.outOfSource).toBe(true);
    expect(insp.delta.move.type).toBe("out_of_source");

    const turnEnd = events.find((e) => e.type === "turn.end") as {
      timings?: { retrievalMs?: number; latencyMs?: number };
    };
    expect(turnEnd).toBeDefined();
    expect(turnEnd.timings?.retrievalMs).toBeGreaterThanOrEqual(0);
  });

  it("passes excerpts for in-source questions outside the mission", async () => {
    if (!sessionId) return;
    const capture: { lastReq?: { final?: string } } = {};
    const llm = fakeLlm(
      [
        '@@g {"verdict":"not_an_answer","question":"q1","concept":"c","misconception":null,"score":0,"self_correction":false,"help_request":false,"out_of_source":false,"lang":"en","confidence_cue":"none"}',
        "@@m mv_clarify",
        "@@d Identity verification requires the original CNIC.",
        "@@end",
      ],
      capture,
    );

    const events: import("@/lib/schemas/turn-events").TurnEvent[] = [];
    for await (const ev of executeTurn(
      {
        sessionId,
        userId,
        orgId,
        input: { mode: "text", text: "How is identity verified at the branch?" },
      },
      { llm: llm as never },
    )) {
      events.push(ev);
    }

    // Verify excerpts_for_this_turn was injected in the prompt's final message
    expect(capture.lastReq?.final).toBeDefined();
    expect(capture.lastReq?.final).toContain("<excerpts_for_this_turn>");
  });
});
