import { describe, it, expect, vi } from "vitest";
import { ensureMission, prefetchNext } from "./missions";
import type { Db } from "../db/client";
import type { Llm } from "../llm/provider";
import type { MissionPack } from "@/lib/schemas/design";

describe("mission pack service", () => {
  const missionId = "00000000-0000-0000-0000-000000000001";
  const journeyId = "00000000-0000-0000-0000-000000000002";
  const contentId = "00000000-0000-0000-0000-000000000003";
  const orgId = "00000000-0000-0000-0000-000000000004";

  const samplePack: MissionPack = {
    missionKey: "m_1",
    title: {
      en: "Identity Verification",
      ur: "شناخت کی تصدیق",
      urLatn: "Shanakht ki tasdeeq",
    },
    objective: "Verify original CNIC before any account change.",
    mechanic: "scenario",
    alternates: ["decision"],
    beats: [
      {
        id: "b1",
        kind: "intro",
        speaker: "Tariq",
        text: "A customer arrives at the counter.",
        questionId: null,
        next: { correct: "b2", partial: "b2", incorrect: "b2" },
      },
      {
        id: "b2",
        kind: "question",
        speaker: "Tariq",
        text: "What document do you ask for first?",
        questionId: "q1",
        next: { correct: "b3", partial: "b3", incorrect: "b3" },
      },
      {
        id: "b3",
        kind: "wrap",
        speaker: "Tariq",
        text: "Verification completed successfully.",
        questionId: null,
        next: { correct: null, partial: null, incorrect: null },
      },
    ],
    questions: [
      {
        id: "q1",
        conceptKey: "c_identity",
        kind: "choice",
        prompt: "Which document is required for verification?",
        variants: {
          foundation: "What document is needed?",
          standard: "Which document is required for verification?",
          advanced: "Under branch policy, which identity document must be verified?",
        },
        options: [
          {
            id: "opt1",
            label: { en: "Original CNIC", ur: "اصل سی این آئی سی", urLatn: "Asal CNIC" },
            correct: true,
            consequence: "Identity confirmed correctly.",
            factIds: ["f_original_cnic"],
            misconceptionId: null,
          },
          {
            id: "opt2",
            label: { en: "Photocopy of CNIC", ur: "فوٹو کاپی", urLatn: "Photocopy" },
            correct: false,
            consequence: "Photocopies are not accepted for account changes.",
            factIds: ["f_original_cnic"],
            misconceptionId: "m_photo",
          },
        ],
        sequence: null,
        pairs: null,
        passage: null,
        answerKey: null,
        hints: [
          "Ask for a national document.",
          "It must be the original, not a copy.",
          "Request the original CNIC card.",
        ],
        workedExample: "When Mr. Rasheed requested a change, Tariq asked for his original CNIC.",
        factIds: ["f_original_cnic"],
      },
      {
        id: "q2",
        conceptKey: "c_identity",
        kind: "choice",
        prompt: "Can an expired CNIC be accepted?",
        variants: {
          foundation: "Is expired CNIC allowed?",
          standard: "Can an expired CNIC be accepted?",
          advanced: "If the customer presents an expired CNIC, what is the required action?",
        },
        options: [
          {
            id: "opt2_1",
            label: { en: "No, renew at NADRA", ur: "نہیں", urLatn: "Nahi" },
            correct: true,
            consequence: "Expired cards cannot be accepted.",
            factIds: ["f_original_cnic"],
            misconceptionId: null,
          },
          {
            id: "opt2_2",
            label: { en: "Yes, accept it", ur: "ہاں", urLatn: "Haan" },
            correct: false,
            consequence: "Expired documents violate regulatory rules.",
            factIds: ["f_original_cnic"],
            misconceptionId: null,
          },
        ],
        sequence: null,
        pairs: null,
        passage: null,
        answerKey: null,
        hints: [
          "Check the expiration date.",
          "Cards must be currently valid.",
          "Direct expired cardholders to NADRA.",
        ],
        workedExample: "Tariq checked the expiry date and noted the card was valid.",
        factIds: ["f_original_cnic"],
      },
    ],
    roleplay: null,
    teachBack: null,
    callbacks: [
      {
        id: "cb1",
        conceptKey: "c_identity",
        prompt: "What is the primary document required for identity check?",
        keyPoints: ["Original CNIC"],
      },
      {
        id: "cb2",
        conceptKey: "c_identity",
        prompt: "Are photocopies accepted for account changes?",
        keyPoints: ["No, only originals"],
      },
    ],
    glossaryHints: [{ term: "CNIC", speechUr: "سی این آئی سی" }],
  };

  it("returns cached mission pack if already ready", async () => {
    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: missionId,
                packStatus: "ready",
                pack: samplePack,
              },
            ]),
          }),
        }),
      }),
    };
    const mockLlm: Partial<Llm> = { object: vi.fn() };

    const pack = await ensureMission(missionId, {
      db: mockDb as Db,
      llm: mockLlm as Llm,
    });

    expect(pack.missionKey).toBe("m_1");
    expect(pack.questions.length).toBe(2);
    expect(mockLlm.object).not.toHaveBeenCalled();
  });

  /** Runs a pending mission through generation with the model returning `modelPack`. */
  async function generateWith(modelPack: unknown) {
    const pendingMission = {
      id: missionId,
      journeyId,
      chapterKey: "ch_intro",
      ordinal: 0,
      title: "Identity Verification",
      conceptIds: ["concept-db-id-1"],
      primaryMechanic: "scenario",
      alternates: ["decision"],
      packStatus: "pending",
      pack: null,
    };

    const journeyRow = {
      id: journeyId,
      contentId,
      orgId,
      outline: {
        title: "Branch Journey",
        summary: "Summary",
        chapters: [
          {
            key: "ch_intro",
            title: "Intro",
            missions: [
              {
                key: "m_1",
                title: "Identity Verification",
                objective: "Verify CNIC",
                conceptKeys: ["c_identity"],
                mechanic: "scenario",
                alternates: ["decision"],
              },
            ],
          },
        ],
        concepts: [
          {
            key: "c_identity",
            name: "Identity",
            nameUr: "شناخت",
            summary: "Identity summary",
            difficulty: 1,
            importance: 5,
            prerequisites: [],
            chunkIds: ["chunk-1"],
          },
        ],
      },
    };

    const conceptRows = [
      {
        id: "concept-db-id-1",
        key: "c_identity",
        chunkIds: ["chunk-1"],
      },
    ];

    const existingFacts = [
      {
        id: "f_original_cnic",
        conceptId: "concept-db-id-1",
        statement: "Ask for the original CNIC.",
        quoteVerified: true,
      },
    ];

    const contentRow = {
      id: contentId,
      orgId,
      title: "Policy",
      sourceHash: "hash-123",
    };

    const chunkRows = [
      {
        id: "chunk-1",
        ordinal: 0,
        anchorKind: "section",
        anchorRef: "sec-1",
        charStart: 0,
        charEnd: 100,
        headingPath: ["Identity"],
        text: "Every account change starts with identity verification. Ask for the original CNIC.",
        tokenCount: 15,
        lang: "en",
        injectionFlag: false,
      },
    ];

    let selectCount = 0;
    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCount++;
            if (selectCount === 1) {
              // missions initial query
              return { limit: () => Promise.resolve([pendingMission]) };
            }
            if (selectCount === 2) {
              // journeys query
              return { limit: () => Promise.resolve([journeyRow]) };
            }
            if (selectCount === 3) {
              // concepts query
              return Promise.resolve(conceptRows);
            }
            if (selectCount === 4) {
              // existing facts query
              return Promise.resolve(existingFacts);
            }
            if (selectCount === 5) {
              // loadContent contents query
              return { limit: () => Promise.resolve([contentRow]) };
            }
            // loadContent contentChunks query
            return {
              orderBy: () => Promise.resolve(chunkRows),
            };
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      }),
    };

    const mockLlm: Partial<Llm> = {
      object: vi.fn().mockResolvedValue({
        value: {
          newFacts: [],
          pack: structuredClone(modelPack),
        },
      }),
    };

    const pack = await ensureMission(missionId, {
      db: mockDb as Db,
      llm: mockLlm as Llm,
    });
    return { pack, mockDb, mockLlm };
  }

  it("keeps the mission and drops a teach-back left with one verified key point", async () => {
    // The production failure of 21 Sep: the grounding check rejected a fact, the teach-back
    // kept one key point, the schema wants two, and the whole journey failed on a ZodError.
    const { pack } = await generateWith({
      ...samplePack,
      teachBack: {
        ask: "Explain identity checks in your own words.",
        keyPoints: [
          { text: "Original CNIC only", factIds: ["f_original_cnic"] },
          { text: "Something unverified", factIds: ["f_not_in_source"] },
        ],
        followUp: "Why not a photocopy?",
      },
    });
    expect(pack.teachBack).toBeNull();
    expect(pack.questions.length).toBe(2);
  });

  it("drops a question that breaks a shape rule and keeps the mission", async () => {
    // The production failure of 22 Sep: a matching question with 3 pairs (4 to 6 required).
    const matching = {
      ...samplePack.questions[0]!,
      id: "q3",
      kind: "match",
      options: null,
      pairs: [
        { left: { en: "a", ur: "a", urLatn: "a" }, right: { en: "b", ur: "b", urLatn: "b" } },
        { left: { en: "c", ur: "c", urLatn: "c" }, right: { en: "d", ur: "d", urLatn: "d" } },
        { left: { en: "e", ur: "e", urLatn: "e" }, right: { en: "f", ur: "f", urLatn: "f" } },
      ],
    };
    const { pack } = await generateWith({
      ...samplePack,
      questions: [...samplePack.questions, matching],
    });
    expect(pack.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  it("generates, verifies, grounds, and stores new mission pack when pending", async () => {
    const { pack, mockDb, mockLlm } = await generateWith(samplePack);

    expect(pack.missionKey).toBe("m_1");
    expect(pack.questions.length).toBe(2);
    expect(mockLlm.object).toHaveBeenCalledWith(
      "mission.generate",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("prefetches next mission in the journey", async () => {
    let selectCount = 0;
    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCount++;
            if (selectCount === 1) {
              // learningSessions lookup
              return {
                limit: () =>
                  Promise.resolve([
                    {
                      id: "session-1",
                      journeyId,
                      currentMissionId: missionId,
                    },
                  ]),
              };
            }
            if (selectCount === 2) {
              // current mission ordinal lookup
              return {
                limit: () => Promise.resolve([{ ordinal: 0 }]),
              };
            }
            // next mission lookup
            return {
              limit: () =>
                Promise.resolve([
                  {
                    id: "mission-next-id",
                    packStatus: "ready", // ready, so it won't re-trigger ensureMission
                  },
                ]),
            };
          }),
        }),
      }),
    };

    await prefetchNext("session-1", { db: mockDb as Db });
    expect(selectCount).toBe(3);
  });
});
