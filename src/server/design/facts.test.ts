import { describe, it, expect, vi } from "vitest";
import { extractChapterFacts } from "./facts";
import type { Db } from "../db/client";
import type { Llm } from "../llm/provider";
import type { ConceptOutline } from "@/lib/schemas/design";

describe("facts extraction and verification", () => {
  const journeyId = "00000000-0000-0000-0000-000000000001";
  const contentId = "00000000-0000-0000-0000-000000000002";
  const orgId = "00000000-0000-0000-0000-000000000003";

  const sampleOutline: ConceptOutline = {
    title: "Verification Journey",
    summary: "Summary text",
    concepts: [
      {
        key: "c_identity",
        name: "Identity Verification",
        nameUr: "شناخت کی تصدیق",
        summary: "Verify customer ID.",
        difficulty: 1,
        importance: 5,
        prerequisites: [],
        chunkIds: ["chunk-1"],
      },
      {
        key: "c_biometric",
        name: "Biometric Verification",
        nameUr: "بائیومیٹرک تصدیق",
        summary: "Verify customer biometrics.",
        difficulty: 2,
        importance: 4,
        prerequisites: ["c_identity"],
        chunkIds: ["chunk-1"],
      },
      {
        key: "c_exception",
        name: "Exception Handling",
        nameUr: "استثنیٰ کا طریقہ کار",
        summary: "Handle verification exceptions.",
        difficulty: 3,
        importance: 3,
        prerequisites: ["c_biometric"],
        chunkIds: ["chunk-1"],
      },
    ],
    chapters: [
      {
        key: "ch_intro",
        title: "Introduction",
        arcBeat: "Arrival",
        missions: [
          {
            key: "m_check_id",
            title: "Check ID",
            objective: "ID check",
            conceptKeys: ["c_identity"],
            mechanic: "scenario",
            alternates: [],
          },
        ],
      },
    ],
    story: {
      setting: "Branch",
      premise: "Morning queue",
      characters: [
        {
          id: "tariq",
          name: "Tariq",
          role: "Officer",
          mood: "calm",
          voiceProfile: "guide",
        },
        {
          id: "rasheed",
          name: "Mr. Rasheed",
          role: "Customer",
          mood: "impatient",
          voiceProfile: "customer_elder",
        },
      ],
    },
    warnings: [],
  };

  const sampleJourneyRow = {
    id: journeyId,
    contentId,
    orgId,
    outline: sampleOutline,
  };

  const sampleContentRow = {
    id: contentId,
    orgId,
    title: "Branch Procedures",
    sourceHash: "hash-xyz",
  };

  const sampleChunkRows = [
    {
      id: "chunk-1",
      ordinal: 0,
      anchorKind: "section",
      anchorRef: "sec-1",
      charStart: 0,
      charEnd: 150,
      headingPath: ["Procedures"],
      text: "Every account change starts with identity verification. Ask for the original CNIC. A photocopy is not accepted.",
      tokenCount: 20,
      lang: "en",
      injectionFlag: false,
    },
  ];

  it("extracts facts, keeps verbatim quotes, drops altered quotes, and persists", async () => {
    let selectCallCount = 0;
    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // journeys lookup
              return { limit: () => Promise.resolve([sampleJourneyRow]) };
            }
            if (selectCallCount === 2) {
              // concepts lookup
              return Promise.resolve([{ id: "concept-db-id-1", key: "c_identity" }]);
            }
            if (selectCallCount === 3) {
              // loadContent contents lookup
              return { limit: () => Promise.resolve([sampleContentRow]) };
            }
            // loadContent contentChunks lookup
            return {
              orderBy: () => Promise.resolve(sampleChunkRows),
            };
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const mockLlm: Partial<Llm> = {
      object: vi.fn().mockImplementation((task: string) => {
        if (task === "content.facts_chapter") {
          return Promise.resolve({
            value: {
              facts: [
                {
                  id: "f_verbatim",
                  conceptKey: "c_identity",
                  statement: "Ask for the original CNIC during verification.",
                  anchors: [
                    {
                      chunkId: "chunk-1",
                      quote: "Ask for the original CNIC",
                    },
                  ],
                },
                {
                  id: "f_altered",
                  conceptKey: "c_identity",
                  statement: "A passport is always required.",
                  anchors: [
                    {
                      chunkId: "chunk-1",
                      quote: "A passport is always required in all cases",
                    },
                  ],
                },
              ],
              misconceptions: [
                {
                  id: "m_photo",
                  conceptKey: "c_identity",
                  belief: "Photocopies are fine.",
                  correction: "Photocopies are not accepted.",
                  factIds: ["f_verbatim"],
                },
              ],
              applications: [
                {
                  conceptKey: "c_identity",
                  text: "Customer brings expired CNIC photocopy.",
                },
              ],
              unsupported: [],
            },
          });
        }
        if (task === "grounding.check") {
          return Promise.resolve({
            value: {
              results: [
                {
                  id: "f_verbatim",
                  verdict: "supported",
                  note: null,
                  corrected: null,
                },
              ],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected task: ${task}`));
      }),
    };

    const result = await extractChapterFacts(journeyId, "ch_intro", {
      db: mockDb as Db,
      llm: mockLlm as Llm,
    });

    expect(result.facts.length).toBe(1);
    expect(result.facts[0]?.id).toBe("f_verbatim");
    expect(result.facts[0]?.anchors[0]?.chunkId).toBe("chunk-1");

    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0]?.fact.id).toBe("f_altered");
    expect(result.dropped[0]?.reason).toContain("not found verbatim");

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("throws notFound if journey does not exist", async () => {
    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };

    await expect(
      extractChapterFacts("nonexistent-journey", "ch_intro", { db: mockDb as Db }),
    ).rejects.toThrow("Journey not found");
  });
});
