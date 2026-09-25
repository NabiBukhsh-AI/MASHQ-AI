import { describe, it, expect, vi } from "vitest";
import { keywordsOf, rewriteQuery, type GlossaryEntry } from "./rewrite";
import type { Llm } from "../llm/provider";

const glossary: GlossaryEntry[] = [
  { termEn: "CNIC", termUr: "شناختی کارڈ", termRoman: "shanakhti card" },
  { termEn: "savings account", termUr: "بچت اکاؤنٹ", termRoman: "bachat account" },
  { termEn: "complaint", termUr: "شکایت", termRoman: "shikayat" },
];
const ctx = { orgId: "org-1", contentId: "c-1" };

function fakeLlm(
  answer = { englishQuery: "how to verify identity", keywords: ["identity", "verify"] },
) {
  const object = vi.fn(async () => ({ value: answer, usage: {} }));
  return { llm: { object } as unknown as Llm, object };
}

describe("rewriteQuery", () => {
  it("passes English questions through with keywords and no model call", async () => {
    const { llm, object } = fakeLlm();
    const r = await rewriteQuery(
      "What is the minimum balance for a savings account?",
      glossary,
      ctx,
      llm,
    );
    expect(r.source).toBe("passthrough");
    expect(r.keywords).toEqual(
      expect.arrayContaining(["minimum", "balance", "savings", "account"]),
    );
    expect(object).not.toHaveBeenCalled();
  });

  it("maps Urdu terms through the glossary before any model call", async () => {
    const { llm, object } = fakeLlm();
    const r = await rewriteQuery("شناختی کارڈ ختم ہو جائے تو کیا کریں؟", glossary, ctx, llm);
    expect(r.source).toBe("glossary");
    expect(r.keywords).toContain("CNIC");
    expect(object).not.toHaveBeenCalled();
  });

  it("maps Roman Urdu terms and keeps English words from a mixed question", async () => {
    const { llm } = fakeLlm();
    const r = await rewriteQuery("Shikayat register karne ka process kya hai?", glossary, ctx, llm);
    expect(r.source).toBe("glossary");
    expect(r.keywords).toEqual(expect.arrayContaining(["complaint", "register", "process"]));
  });

  it("falls back to the model with the glossary in the pack when nothing matches", async () => {
    const { llm, object } = fakeLlm();
    const r = await rewriteQuery("مسٹر رشید کو پہلے کیا کرنا چاہیے؟", glossary, ctx, llm);
    expect(r.source).toBe("model");
    expect(r.englishQuery).toBe("how to verify identity");
    expect(object).toHaveBeenCalledOnce();
    const [task, , req] = object.mock.calls[0] as unknown as [
      string,
      unknown,
      { packBlocks: string[]; final: string; lang: string },
    ];
    expect(task).toBe("query.rewrite");
    expect(req.packBlocks[0]).toContain("<glossary>");
    expect(req.final).toContain("<learner_input>");
    expect(req.lang).toBe("ur");
  });
});

describe("keywordsOf", () => {
  it("drops stop words and duplicates, caps at six", () => {
    expect(
      keywordsOf("What is the balance and the balance again for account account limit fee card"),
    ).toEqual(["balance", "again", "account", "limit", "fee", "card"]);
  });
});
