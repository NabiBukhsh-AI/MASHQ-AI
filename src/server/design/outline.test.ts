import { describe, it, expect, vi } from "vitest";
import { designHash, breakCycles, missionKeyOf, generateOutline, missionBudget } from "./outline";
import { DEFAULT_CONFIG } from "../config/defaults";
import type { DesignContent } from "./context";
import type { ConceptOutline } from "@/lib/schemas/design";
import type { Db } from "../db/client";
import type { Llm } from "../llm/provider";

describe("mission budget", () => {
  const design = { tokensPerMission: 500, maxChapters: 4, missionsPerChapter: 2 };
  it("sizes the journey to the document, from 1 mission up to the chapter cap", () => {
    expect(missionBudget(120, design)).toBe(1);
    // The Roman Urdu guide that failed on 21 Sep: about 900 tokens, planned as 8 missions.
    expect(missionBudget(900, design)).toBe(2);
    expect(missionBudget(2600, design)).toBe(6);
    expect(missionBudget(40_000, design)).toBe(8);
  });
});

describe("outline generation", () => {
  const sampleContent: DesignContent = {
    id: "00000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-000000000002",
    title: "Customer Verification Policy",
    sourceHash: "hash-abc-123",
    chunks: [
      {
        id: "chunk-1",
        ordinal: 0,
        anchor: { kind: "section", ref: "sec-1", start: 0, end: 50 },
        headingPath: ["Identity"],
        text: "Every customer must be verified with original CNIC.",
        tokenCount: 15,
        lang: "en",
        injectionFlag: false,
      },
      {
        id: "chunk-2",
        ordinal: 1,
        anchor: { kind: "section", ref: "sec-2", start: 51, end: 120 },
        headingPath: ["Biometric"],
        text: "Perform biometric thumb impression verification through NADRA.",
        tokenCount: 18,
        lang: "en",
        injectionFlag: false,
      },
      {
        id: "chunk-3",
        ordinal: 2,
        anchor: { kind: "section", ref: "sec-3", start: 121, end: 200 },
        headingPath: ["Exceptions"],
        text: "If biometric fails after 3 attempts, escalate to branch manager.",
        tokenCount: 20,
        lang: "en",
        injectionFlag: false,
      },
    ],
    quotable: [],
  };
  sampleContent.quotable = sampleContent.chunks;

  const validOutline: ConceptOutline = {
    title: "Customer Verification",
    summary: "Verification journey for branch officers.",
    concepts: [
      {
        key: "c_identity",
        name: "Identity Verification",
        nameUr: "شناخت کی تصدیق",
        summary: "Verify customer original CNIC.",
        difficulty: 1,
        importance: 5,
        prerequisites: [],
        chunkIds: ["chunk-1"],
      },
      {
        key: "c_biometric",
        name: "Biometric Verification",
        nameUr: "بائیومیٹرک تصدیق",
        summary: "NADRA biometric verification.",
        difficulty: 2,
        importance: 4,
        prerequisites: ["c_identity"],
        chunkIds: ["chunk-2"],
      },
      {
        key: "c_exceptions",
        name: "Exception Handling",
        nameUr: "استثنیٰ کا طریقہ کار",
        summary: "Branch manager escalation.",
        difficulty: 3,
        importance: 3,
        prerequisites: ["c_biometric"],
        chunkIds: ["chunk-3"],
      },
    ],
    chapters: [
      {
        key: "ch_counter",
        title: "Counter Verification",
        arcBeat: "Arrival and check",
        missions: [
          {
            key: "m_check_cnic",
            title: "Check CNIC",
            objective: "Verify customer ID document",
            conceptKeys: ["c_identity"],
            mechanic: "scenario",
            alternates: ["decision"],
          },
          {
            key: "m_run_biometric",
            title: "Run Biometrics",
            objective: "Perform biometric scan",
            conceptKeys: ["c_biometric", "c_exceptions"],
            mechanic: "roleplay",
            alternates: ["puzzle"],
          },
        ],
      },
    ],
    story: {
      setting: "Main Branch Lahore",
      premise: "A busy Monday morning with various customer requests.",
      characters: [
        {
          id: "tariq",
          name: "Tariq",
          role: "Branch Officer",
          mood: "focused",
          voiceProfile: "guide",
        },
        {
          id: "rasheed",
          name: "Mr. Rasheed",
          role: "Senior Customer",
          mood: "impatient",
          voiceProfile: "customer_elder",
        },
      ],
    },
    warnings: [],
  };

  describe("designHash", () => {
    it("is deterministic for identical inputs", () => {
      const h1 = designHash(sampleContent, DEFAULT_CONFIG);
      const h2 = designHash(sampleContent, DEFAULT_CONFIG);
      expect(h1).toBe(h2);
      expect(h1.length).toBe(64);
    });

    it("changes when content hash changes", () => {
      const h1 = designHash(sampleContent, DEFAULT_CONFIG);
      const modifiedContent = { ...sampleContent, sourceHash: "hash-different" };
      const h2 = designHash(modifiedContent, DEFAULT_CONFIG);
      expect(h1).not.toBe(h2);
    });
  });

  describe("breakCycles", () => {
    it("returns no warnings when prerequisites form a valid DAG", () => {
      const outline = structuredClone(validOutline);
      const warnings = breakCycles(outline);
      expect(warnings).toEqual([]);
    });

    it("detects and breaks circular prerequisite dependencies", () => {
      const outline = structuredClone(validOutline);
      // Create a cycle: c_identity -> c_biometric -> c_exceptions -> c_identity
      outline.concepts.find((c) => c.key === "c_identity")!.prerequisites = ["c_exceptions"];

      const warnings = breakCycles(outline);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("Prerequisite loop");

      // Verify cycle is broken
      const postWarnings = breakCycles(outline);
      expect(postWarnings).toEqual([]);
    });

    it("filters out self-prerequisites and unknown keys", () => {
      const outline = structuredClone(validOutline);
      const concept = outline.concepts.find((c) => c.key === "c_identity")!;
      concept.prerequisites = ["c_identity", "c_unknown_concept"];

      breakCycles(outline);
      expect(concept.prerequisites).toEqual([]);
    });
  });

  describe("missionKeyOf", () => {
    it("retrieves the mission key by ordinal and chapter", () => {
      expect(missionKeyOf(validOutline, "ch_counter", 0)).toBe("m_check_cnic");
      expect(missionKeyOf(validOutline, "ch_counter", 1)).toBe("m_run_biometric");
    });

    it("falls back to default key for out-of-range ordinal", () => {
      expect(missionKeyOf(validOutline, "ch_counter", 99)).toBe("m_100");
    });
  });

  describe("generateOutline", () => {
    it("generates outline, validates schema and persists records to db", async () => {
      const send = vi.fn();

      const mockLlm: Partial<Llm> = {
        object: vi.fn().mockResolvedValue({
          value: validOutline,
          usage: {
            tier: "design",
            provider: "anthropic",
            model: "claude-3-7-sonnet",
            inputTokens: 200,
            outputTokens: 400,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.005,
            ttftMs: 300,
            latencyMs: 1200,
            fallback: false,
          },
        }),
      };

      const mockJourney = { id: "journey-123" };
      const mockConcepts = [
        { id: "c-id-1", key: "c_identity" },
        { id: "c-id-2", key: "c_biometric" },
        { id: "c-id-3", key: "c_exceptions" },
      ];
      const mockMissions = [
        { id: "m-id-1", ordinal: 0, chapterKey: "ch_counter" },
        { id: "m-id-2", ordinal: 1, chapterKey: "ch_counter" },
      ];

      const mockDb: Partial<Db> = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]), // No existing journey
            }),
          }),
        }),
        insert: vi.fn().mockImplementation((_table: unknown) => ({
          values: vi
            .fn()
            .mockImplementation((vals: Record<string, unknown> | Record<string, unknown>[]) => {
              const returning = vi.fn().mockImplementation(() => {
                const first = Array.isArray(vals) ? vals[0] : vals;
                if (first && "designHash" in first) return Promise.resolve([mockJourney]);
                if (first && "key" in first) return Promise.resolve(mockConcepts);
                return Promise.resolve(mockMissions);
              });
              return {
                returning,
                // Concepts upsert on (contentId, key) rather than delete and recreate.
                onConflictDoUpdate: vi.fn().mockReturnValue({ returning }),
                onConflictDoNothing: vi.fn().mockResolvedValue([]),
              };
            }),
        })),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      };

      const result = await generateOutline(sampleContent, DEFAULT_CONFIG, send, {
        db: mockDb as Db,
        llm: mockLlm as Llm,
      });

      expect(result.journeyId).toBe("journey-123");
      expect(result.reused).toBe(false);
      expect(result.outline.title).toBe("Customer Verification");
      expect(send).toHaveBeenCalledWith(
        "stage.progress",
        expect.objectContaining({ stage: "outline" }),
      );
      expect(send).toHaveBeenCalledWith(
        "outline.partial",
        expect.objectContaining({ reused: false }),
      );
      expect(result.conceptIds["c_identity"]).toBe("c-id-1");
      expect(result.missionIds.length).toBe(2);
    });

    it("reuses existing journey when matching hash is found", async () => {
      const send = vi.fn();
      const existingJourney = {
        id: "journey-existing-999",
        outline: validOutline,
        status: "designing",
      };

      // Queries without limit, in the order generateOutline runs them: concepts, then missions.
      const unlimited = [
        [{ id: "c-id-1", key: "c_identity" }],
        // Out of order, as Postgres may return them without ORDER BY.
        [
          { id: "m-id-2", chapterKey: "ch_counter", ordinal: 1, pack: null },
          { id: "m-id-1", chapterKey: "ch_counter", ordinal: 0, pack: null },
        ],
      ];
      let unlimitedCall = 0;
      const mockDb: Partial<Db> = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([existingJourney]),
              then: (fn: (arg: unknown) => unknown) => fn(unlimited[unlimitedCall++] ?? []),
            })),
          })),
        }),
      };

      const mockLlm: Partial<Llm> = {
        object: vi.fn(),
      };

      const result = await generateOutline(sampleContent, DEFAULT_CONFIG, send, {
        db: mockDb as Db,
        llm: mockLlm as Llm,
      });

      expect(result.reused).toBe(true);
      expect(result.journeyId).toBe("journey-existing-999");
      // Mission 1 is the first: the pipeline builds missionIds[0] as the playable mission.
      expect(result.missionIds.map((m) => m.ordinal)).toEqual([0, 1]);
      expect(mockLlm.object).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith(
        "outline.partial",
        expect.objectContaining({ reused: true }),
      );
    });
  });
});
