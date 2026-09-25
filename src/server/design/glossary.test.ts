import { describe, it, expect, vi } from "vitest";
import { buildGlossary } from "./glossary";
import type { Db } from "../db/client";
import type { Llm } from "../llm/provider";

describe("glossary service", () => {
  const contentId = "00000000-0000-0000-0000-000000000001";
  const orgId = "00000000-0000-0000-0000-000000000002";

  it("returns existing glossary terms from database without invoking LLM", async () => {
    const existingDbTerms = [
      {
        id: "term-1",
        contentId,
        termEn: "CNIC",
        termUr: "سی این آئی سی",
        termRoman: "CNIC",
        definition: "Computerized National Identity Card issued by NADRA.",
        speechHint: "سی این آئی سی",
        chunkIds: ["chunk-1"],
      },
    ];

    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(existingDbTerms),
        }),
      }),
    };
    const mockLlm: Partial<Llm> = { object: vi.fn() };

    const terms = await buildGlossary(contentId, {
      db: mockDb as Db,
      llm: mockLlm as Llm,
    });

    expect(terms.length).toBe(1);
    expect(terms[0]?.en).toBe("CNIC");
    expect(terms[0]?.ur).toBe("سی این آئی سی");
    expect(mockLlm.object).not.toHaveBeenCalled();
  });

  it("extracts, filters, persists and returns glossary terms when none exist", async () => {
    const mockContentRow = { id: contentId, orgId };
    const mockChunkRows = [
      {
        id: "chunk-1",
        anchorKind: "section",
        anchorRef: "sec-1",
        text: "Every customer must present their original CNIC for verification.",
        injectionFlag: false,
      },
    ];

    const generatedTerms = {
      terms: [
        {
          en: "CNIC",
          ur: "سی این آئی سی",
          roman: "CNIC",
          definition: "Computerized National Identity Card.",
          speechHint: "سی این آئی سی",
          chunkIds: ["chunk-1", "chunk-invalid-hallucinated"],
        },
      ],
    };

    let selectCallCount = 0;
    const mockDb: Partial<Db> = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // First query: existing terms in glossaryTerms table
              return Promise.resolve([]);
            }
            if (selectCallCount === 2) {
              // Second query: content in contents table
              return { limit: () => Promise.resolve([mockContentRow]) };
            }
            // Third query: chunks in contentChunks table
            return Promise.resolve(mockChunkRows);
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      }),
    };

    const mockLlm: Partial<Llm> = {
      object: vi.fn().mockResolvedValue({
        value: generatedTerms,
      }),
    };

    const terms = await buildGlossary(contentId, {
      db: mockDb as Db,
      llm: mockLlm as Llm,
    });

    expect(terms.length).toBe(1);
    expect(terms[0]?.en).toBe("CNIC");
    // Invalid chunk ID should be filtered out
    expect(terms[0]?.chunkIds).toEqual(["chunk-1"]);
    expect(mockLlm.object).toHaveBeenCalledWith(
      "content.glossary",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
