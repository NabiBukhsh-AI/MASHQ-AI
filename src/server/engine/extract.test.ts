import { describe, expect, it, vi } from "vitest";
import { hasDisagreement, parseExtractedEvidence, runExtractor } from "./extract";
import { concepts } from "../db/schema/journey";
import { evidenceEvents, learningSessions, turns } from "../db/schema/learning";

function createMockDb(data: {
  turn?: unknown;
  session?: unknown;
  provisionalRows?: unknown[];
  tutorTurn?: unknown;
  concepts?: unknown[];
  onUpdate?: (vals: Record<string, unknown>) => void;
  onInsert?: (vals: Record<string, unknown>) => void;
}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const isTurns = table === turns || String(table).includes("turns");
        const isSessions = table === learningSessions || String(table).includes("sessions");
        const isEvidence = table === evidenceEvents || String(table).includes("evidence");
        const isConcepts = table === concepts || String(table).includes("concepts");

        return {
          where: vi.fn(() => {
            return {
              limit: vi.fn(async () => {
                if (isTurns) {
                  return data.turn ? [data.turn] : [];
                }
                if (isSessions) return data.session ? [data.session] : [];
                return [];
              }),
              orderBy: vi.fn(() => ({
                limit: vi.fn(async () => {
                  if (isTurns) return data.tutorTurn ? [data.tutorTurn] : [];
                  return [];
                }),
              })),
              then: (resolve: (val: unknown) => void) => {
                if (isEvidence) {
                  return Promise.resolve(data.provisionalRows ?? []).then(resolve);
                }
                if (isConcepts) {
                  return Promise.resolve(data.concepts ?? []).then(resolve);
                }
                return Promise.resolve([]).then(resolve);
              },
            };
          }),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        data.onUpdate?.(vals);
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (vals: Record<string, unknown>) => {
        data.onInsert?.(vals);
      }),
    })),
  };
}

describe("extract module", () => {
  describe("parseExtractedEvidence", () => {
    it("parses valid @@e lines from raw model text", () => {
      const raw = `
Some introductory text or tags
@@e {"concept":"c_update","signal":"free_text","verdict":"correct","score":1.0,"self_correction":false,"misconception":null,"confidence_cue":"high","lang":"en"}
@@e {"concept":"c_greet","signal":"free_text","verdict":"partial","score":0.6,"self_correction":true,"misconception":"mc_delay","confidence_cue":"none","lang":"ur"}
@@end
`;
      const parsed = parseExtractedEvidence(raw);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.concept).toBe("c_update");
      expect(parsed[0]?.verdict).toBe("correct");
      expect(parsed[0]?.score).toBe(1.0);
      expect(parsed[1]?.concept).toBe("c_greet");
      expect(parsed[1]?.verdict).toBe("partial");
      expect(parsed[1]?.score).toBe(0.6);
      expect(parsed[1]?.self_correction).toBe(true);
      expect(parsed[1]?.misconception).toBe("mc_delay");
    });

    it("ignores malformed JSON and non-evidence lines gracefully", () => {
      const raw = `
@@g {"verdict":"correct"}
@@e {bad json}
@@m mv1
@@e {"concept":"c1","signal":"free_text","verdict":"correct","score":1.0}
@@end
`;
      const parsed = parseExtractedEvidence(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.concept).toBe("c1");
    });
  });

  describe("hasDisagreement", () => {
    const provisionalBase = {
      id: "ev-1",
      orgId: "org-1",
      userId: "u-1",
      sessionId: "s-1",
      turnId: "t-1",
      conceptId: "c-1",
      missionId: "m-1",
      questionId: "q-1",
      signal: "free_text",
      verdict: "partial",
      score: 0.5,
      hintLevel: 0,
      latencyMs: 1000,
      selfCorrected: false,
      confidence: "none",
      lang: "en",
      modality: "text",
      misconceptionId: null,
      weight: 0.7,
      credit: 0.5,
      pBefore: 0.2,
      pAfter: 0.3,
      source: "inline" as const,
      supersededBy: null,
      createdAt: new Date(),
    } as typeof evidenceEvents.$inferSelect;

    it("detects no disagreement when verdict and score match closely", () => {
      expect(
        hasDisagreement(provisionalBase, {
          concept: "c-1",
          signal: "free_text",
          verdict: "partial",
          score: 0.55,
          self_correction: false,
          misconception: null,
        }),
      ).toBe(false);
    });

    it("detects disagreement when verdict changes", () => {
      expect(
        hasDisagreement(provisionalBase, {
          concept: "c-1",
          signal: "free_text",
          verdict: "correct",
          score: 1.0,
          self_correction: false,
          misconception: null,
        }),
      ).toBe(true);
    });

    it("detects disagreement when score differs by more than 0.15", () => {
      expect(
        hasDisagreement(provisionalBase, {
          concept: "c-1",
          signal: "free_text",
          verdict: "partial",
          score: 0.8,
          self_correction: false,
          misconception: null,
        }),
      ).toBe(true);
    });

    it("detects disagreement when misconception changes", () => {
      expect(
        hasDisagreement(provisionalBase, {
          concept: "c-1",
          signal: "free_text",
          verdict: "partial",
          score: 0.5,
          self_correction: false,
          misconception: "mc_identity",
        }),
      ).toBe(true);
    });
  });

  describe("runExtractor flow and failure handling", () => {
    it("handles extractor failure and leaves provisional rows intact", async () => {
      const turnId = "turn-mock-1";

      const mockDb = createMockDb({
        turn: {
          id: turnId,
          sessionId: "sess-1",
          role: "learner",
          text: "The CNIC is required",
          inputMode: "text",
          orgId: "org-1",
          userId: "u-1",
        },
        session: {
          id: "sess-1",
          orgId: "org-1",
          userId: "u-1",
          personaId: "branch_new_joiner",
          language: "en",
          presets: [],
        },
        provisionalRows: [
          {
            id: "ev-prov-1",
            turnId,
            conceptId: "c-1",
            verdict: "partial",
            score: 0.5,
          },
        ],
      });

      // LLM fails
      const mockLlm = {
        stream: vi.fn(async () => {
          throw new Error("Provider connection timeout");
        }),
      };

      const result = await runExtractor(turnId, {
        db: mockDb as never,
        llm: mockLlm as never,
        resolveConfig: vi.fn(async () => ({
          version: 1,
          hash: "h",
          config: {
            personas: [{ id: "branch_new_joiner" }],
            evidence: { weights: { free_text: 0.7 }, guess: { free_text: 0.15 } },
            mastery: { slip: 0.1, transit: 0.08 },
          },
        })) as never,
      });

      expect(result.success).toBe(false);
      expect(result.provisionalKept).toBe(true);
      expect(result.error).toContain("Provider connection timeout");
    });

    it("updates provisional row on extractor disagreement", async () => {
      const turnId = "turn-mock-2";
      const conceptId = "concept-123";

      const provisionalRow = {
        id: "ev-prov-1",
        orgId: "org-1",
        userId: "u-1",
        sessionId: "sess-1",
        turnId,
        conceptId,
        signal: "free_text",
        verdict: "partial",
        score: 0.5,
        hintLevel: 0,
        pBefore: 0.2,
        misconceptionId: null,
      };

      let updatedValues: Record<string, unknown> | null = null;

      const mockDb = createMockDb({
        turn: {
          id: turnId,
          sessionId: "sess-1",
          role: "learner",
          text: "You need the original CNIC",
          inputMode: "text",
          orgId: "org-1",
          userId: "u-1",
        },
        session: {
          id: "sess-1",
          orgId: "org-1",
          userId: "u-1",
          personaId: "branch_new_joiner",
          language: "en",
          presets: [],
        },
        provisionalRows: [provisionalRow],
        concepts: [{ id: conceptId, key: "c_id", name: "Concept" }],
        onUpdate: (vals) => {
          updatedValues = vals;
        },
      });

      const mockLlm = {
        stream: vi.fn(async () => ({
          textStream: (async function* () {
            yield `@@e {"concept":"${conceptId}","signal":"free_text","verdict":"correct","score":1.0,"self_correction":false,"misconception":null}\n@@end`;
          })(),
          usage: Promise.resolve({}),
        })),
      };

      const replay = vi.fn<(key: { userId: string; conceptId: string }) => Promise<never>>(
        async () => ({}) as never,
      );
      const result = await runExtractor(turnId, {
        db: mockDb as never,
        llm: mockLlm as never,
        replay,
        resolveConfig: vi.fn(async () => ({
          version: 1,
          hash: "h",
          config: {
            personas: [{ id: "branch_new_joiner", pInit: 0.2 }],
            evidence: { weights: { free_text: 0.7 }, guess: { free_text: 0.15 } },
            mastery: {
              slip: 0.1,
              transit: 0.08,
              bands: { developing: 0.4, proficient: 0.7, mastered: 0.9 },
              masteredMinEvents: 3,
              masteredMinSignalTypes: 2,
              masteredMinLower: 0.6,
              bandK: 0.5,
              forgetting: { enabled: false, halfLifeDays: 14 },
            },
          },
        })) as never,
      });

      expect(result.success).toBe(true);
      expect(result.disagreements).toBe(1);
      expect(result.replayTriggered).toBe(true);
      // a corrected row recomputes mastery for that learner and concept from the log
      expect(replay).toHaveBeenCalledTimes(1);
      expect(replay.mock.calls[0]?.[0]).toMatchObject({ userId: "u-1", conceptId });
      expect(updatedValues).not.toBeNull();
      expect((updatedValues as Record<string, unknown> | null)?.verdict).toBe("correct");
      expect((updatedValues as Record<string, unknown> | null)?.score).toBe(1.0);
      expect((updatedValues as Record<string, unknown> | null)?.source).toBe("extractor");
    });
  });
});
