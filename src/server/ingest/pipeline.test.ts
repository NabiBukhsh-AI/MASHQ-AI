import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "./pipeline";
import type { Db } from "../db/client";
import type { Llm } from "../llm/provider";
import { DEFAULT_CONFIG } from "../config/defaults";

// The prepare stage has its own live test; here it is a stub so the sequencing test stays DB-free.
vi.mock("./prepare", () => ({
  prepareContent: vi.fn(async () => ({
    chunks: 3,
    redactions: 0,
    injectionFlags: 0,
    langPrimary: "en",
    warnings: [],
    reused: false,
  })),
}));

describe("ingestion pipeline", () => {
  const contentId = "00000000-0000-0000-0000-000000000001";
  const orgId = "00000000-0000-0000-0000-000000000002";

  it("sequences outline, mission 1, and glossary stages with SSE events", async () => {
    const events: { event: string; data: unknown }[] = [];
    const send = vi.fn((event: string, data: unknown) => {
      events.push({ event, data });
    });

    const sampleContent = {
      id: contentId,
      orgId,
      title: "Branch Care Policy",
      sourceHash: "hash-123",
      chunks: [
        {
          id: "c1",
          ordinal: 0,
          anchor: { kind: "section", ref: "s1", start: 0, end: 50 },
          headingPath: ["Intro"],
          text: "Every customer must be greeted promptly within thirty seconds.",
          tokenCount: 15,
          lang: "en",
          injectionFlag: true, // test warning emission
        },
        {
          id: "c2",
          ordinal: 1,
          anchor: { kind: "section", ref: "s2", start: 51, end: 100 },
          headingPath: ["Identity"],
          text: "Verify the original CNIC card carefully.",
          tokenCount: 12,
          lang: "en",
          injectionFlag: false,
        },
      ],
      quotable: [
        {
          id: "c2",
          ordinal: 1,
          anchor: { kind: "section", ref: "s2", start: 51, end: 100 },
          headingPath: ["Identity"],
          text: "Verify the original CNIC card carefully.",
          tokenCount: 12,
          lang: "en",
          injectionFlag: false,
        },
      ],
    };

    let selectCount = 0;
    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCount++;
            if (selectCount === 1) {
              // loadContent contents query
              return { limit: () => Promise.resolve([sampleContent]) };
            }
            if (selectCount === 2) {
              // loadContent contentChunks query
              return {
                orderBy: () =>
                  Promise.resolve(
                    sampleContent.chunks.map((c) => ({
                      id: c.id,
                      ordinal: c.ordinal,
                      anchorKind: c.anchor.kind,
                      anchorRef: c.anchor.ref,
                      charStart: c.anchor.start,
                      charEnd: c.anchor.end,
                      headingPath: c.headingPath,
                      text: c.text,
                      tokenCount: c.tokenCount,
                      lang: c.lang,
                      injectionFlag: c.injectionFlag,
                    })),
                  ),
              };
            }
            if (selectCount === 3) {
              // generateOutline existing journey query
              return { limit: () => Promise.resolve([]) };
            }
            if (selectCount === 4) {
              // ensureMission initial mission query
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: "m-1",
                      journeyId: "j-1",
                      chapterKey: "ch_intro",
                      ordinal: 0,
                      title: "Greeting and ID",
                      conceptIds: ["concept-1"],
                      primaryMechanic: "scenario",
                      packStatus: "ready",
                      pack: {
                        missionKey: "m_1",
                        title: { en: "Greeting", ur: "خوش آمدید", urLatn: "Khush Aamdeed" },
                        objective: "Practice greeting",
                        mechanic: "scenario",
                        alternates: [],
                        beats: [
                          {
                            id: "b1",
                            kind: "intro",
                            speaker: "Tariq",
                            text: "Intro text",
                            questionId: null,
                            next: { correct: "b2", partial: "b2", incorrect: "b2" },
                          },
                          {
                            id: "b2",
                            kind: "question",
                            speaker: "Tariq",
                            text: "Question text",
                            questionId: "q1",
                            next: { correct: "b3", partial: "b3", incorrect: "b3" },
                          },
                          {
                            id: "b3",
                            kind: "wrap",
                            speaker: "Tariq",
                            text: "Wrap text",
                            questionId: null,
                            next: { correct: null, partial: null, incorrect: null },
                          },
                        ],
                        questions: [
                          {
                            id: "q1",
                            conceptKey: "c_identity",
                            kind: "choice",
                            prompt: "Prompt",
                            variants: { foundation: "F", standard: "S", advanced: "A" },
                            options: [
                              {
                                id: "o1",
                                label: { en: "A", ur: "الف", urLatn: "A" },
                                correct: true,
                                consequence: "Good",
                                factIds: ["f1"],
                                misconceptionId: null,
                              },
                              {
                                id: "o2",
                                label: { en: "B", ur: "ب", urLatn: "B" },
                                correct: false,
                                consequence: "Bad",
                                factIds: ["f1"],
                                misconceptionId: null,
                              },
                            ],
                            sequence: null,
                            pairs: null,
                            passage: null,
                            answerKey: null,
                            hints: ["H1", "H2", "H3"],
                            workedExample: "Ex",
                            factIds: ["f1"],
                          },
                          {
                            id: "q2",
                            conceptKey: "c_identity",
                            kind: "choice",
                            prompt: "Prompt 2",
                            variants: { foundation: "F", standard: "S", advanced: "A" },
                            options: [
                              {
                                id: "o1",
                                label: { en: "A", ur: "الف", urLatn: "A" },
                                correct: true,
                                consequence: "Good",
                                factIds: ["f1"],
                                misconceptionId: null,
                              },
                              {
                                id: "o2",
                                label: { en: "B", ur: "ب", urLatn: "B" },
                                correct: false,
                                consequence: "Bad",
                                factIds: ["f1"],
                                misconceptionId: null,
                              },
                            ],
                            sequence: null,
                            pairs: null,
                            passage: null,
                            answerKey: null,
                            hints: ["H1", "H2", "H3"],
                            workedExample: "Ex",
                            factIds: ["f1"],
                          },
                        ],
                        roleplay: null,
                        teachBack: null,
                        callbacks: [
                          { id: "c1", conceptKey: "c_identity", prompt: "P1", keyPoints: ["K1"] },
                          { id: "c2", conceptKey: "c_identity", prompt: "P2", keyPoints: ["K2"] },
                        ],
                        glossaryHints: [],
                      },
                    },
                  ]),
              };
            }
            // buildGlossary existing terms query
            return Promise.resolve([
              {
                id: "term-1",
                contentId,
                termEn: "CNIC",
                termUr: "سی این آئی سی",
                termRoman: "CNIC",
                definition: "Identity Card",
                speechHint: "",
                chunkIds: ["c2"],
              },
            ]);
          }),
          orderBy: () => Promise.resolve(sampleContent.chunks),
        }),
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi
          .fn()
          .mockImplementation((vals: Record<string, unknown> | Record<string, unknown>[]) => {
            const returning = vi.fn().mockImplementation(() => {
              const first = Array.isArray(vals) ? vals[0] : vals;
              if (first && "designHash" in first) return Promise.resolve([{ id: "j-1" }]);
              if (first && "key" in first)
                return Promise.resolve([{ id: "concept-1", key: "c_identity" }]);
              return Promise.resolve([{ id: "m-1", ordinal: 0, chapterKey: "ch_intro" }]);
            });
            return {
              returning,
              // Concepts upsert on (contentId, key) rather than delete and recreate.
              onConflictDoUpdate: vi.fn().mockReturnValue({ returning }),
              onConflictDoNothing: vi.fn().mockResolvedValue([]),
            };
          }),
      })),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
    };

    const mockLlm: Partial<Llm> = {
      object: vi.fn().mockResolvedValue({
        value: {
          title: "Branch Care Journey",
          summary: "Branch summary",
          concepts: [
            {
              key: "c_identity",
              name: "Identity",
              nameUr: "شناخت",
              summary: "ID check",
              difficulty: 1,
              importance: 5,
              prerequisites: [],
              chunkIds: ["c2"],
            },
            {
              key: "c_greeting",
              name: "Greeting",
              nameUr: "خوش آمدید",
              summary: "Greeting check",
              difficulty: 2,
              importance: 4,
              prerequisites: ["c_identity"],
              chunkIds: ["c2"],
            },
            {
              key: "c_exceptions",
              name: "Exceptions",
              nameUr: "استثنیٰ",
              summary: "Exception handling",
              difficulty: 3,
              importance: 3,
              prerequisites: ["c_greeting"],
              chunkIds: ["c2"],
            },
          ],
          chapters: [
            {
              key: "ch_intro",
              title: "Intro",
              arcBeat: "Arrival",
              missions: [
                {
                  key: "m_first",
                  title: "Greeting and ID",
                  objective: "Practice",
                  conceptKeys: ["c_identity"],
                  mechanic: "scenario",
                  alternates: [],
                },
              ],
            },
          ],
          story: {
            setting: "Branch",
            premise: "Morning arrival",
            characters: [
              { id: "t1", name: "Tariq", role: "Officer", mood: "calm", voiceProfile: "guide" },
              {
                id: "r1",
                name: "Rasheed",
                role: "Customer",
                mood: "hurried",
                voiceProfile: "customer_elder",
              },
            ],
          },
          warnings: [],
        },
      }),
    };

    const res = await runPipeline(
      contentId,
      orgId,
      { send },
      { db: mockDb as Db, llm: mockLlm as Llm, config: DEFAULT_CONFIG },
    );

    expect(res.journeyId).toBe("j-1");
    expect(res.missionId).toBe("m-1");

    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain("stage.start");
    expect(eventNames).toContain("warning");
    expect(eventNames).toContain("outline.partial");
    expect(eventNames).toContain("mission.ready");
    expect(eventNames).toContain("playable");
    expect(eventNames).toContain("done");
  });
});
