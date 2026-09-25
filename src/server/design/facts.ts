import { eq } from "drizzle-orm";
import { ConceptOutline, FactsResult, FactsResultLoose, type Fact } from "@/lib/schemas/design";
import { db as defaultDb, type Db } from "../db/client";
import { concepts, facts as factsTable, journeys, GROUNDING_STATUSES } from "../db/schema";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { DESIGN_PROMPT_VERSION, FACTS_TASK, documentBlock } from "../llm/prompts/design";
import { chunksFor, loadContent } from "./context";
import { verifyQuotes, type VerifiedFact } from "./quote-verify";
import { checkGrounding } from "./grounding";
import { errors } from "../http/errors";

export interface ExtractFactsResult {
  facts: VerifiedFact[];
  dropped: { fact: Fact; reason: string }[];
  unsupported: string[];
}

/**
 * Extract chapter facts, verify quotes deterministically,
 * check grounding entailment, update concept misconceptions, and persist facts.
 */
export async function extractChapterFacts(
  journeyId: string,
  chapterKey: string,
  deps: { db?: Db; llm?: Llm } = {},
): Promise<ExtractFactsResult> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? defaultLlm;

  // 1. Load journey and outline
  const [journey] = await db
    .select({
      id: journeys.id,
      contentId: journeys.contentId,
      orgId: journeys.orgId,
      outline: journeys.outline,
    })
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!journey) {
    throw errors.notFound("Journey not found.");
  }

  const outline = ConceptOutline.parse(journey.outline);
  const chapter = outline.chapters.find((c) => c.key === chapterKey);
  if (!chapter) {
    throw errors.notFound(`Chapter ${chapterKey} not found in journey.`);
  }

  const conceptKeys = [...new Set(chapter.missions.flatMap((m) => m.conceptKeys))];
  const chapterConcepts = outline.concepts.filter((c) => conceptKeys.includes(c.key));

  const conceptRows = await db
    .select({ id: concepts.id, key: concepts.key })
    .from(concepts)
    .where(eq(concepts.contentId, journey.contentId));
  const conceptKeyToId = new Map(conceptRows.map((r) => [r.key, r.id]));

  // 2. Load content and chunks
  const content = await loadContent(journey.contentId, journey.orgId, db);
  const neededChunkIds = chapterConcepts.flatMap((c) => c.chunkIds);
  let relevantChunks = chunksFor(content, neededChunkIds, 24_000);
  if (relevantChunks.length === 0) {
    relevantChunks = content.quotable.slice(0, 30);
  }

  // 3. Extract facts via design tier LLM
  const conceptsBlock = `<concepts>\n${chapterConcepts
    .map((c) => `<concept key="${c.key}" name="${c.name}">${c.summary}</concept>`)
    .join("\n")}\n</concepts>`;

  const { value: raw } = await llm.object(
    "content.facts_chapter",
    FactsResultLoose,
    {
      system: FACTS_TASK,
      packBlocks: [documentBlock(relevantChunks)],
      history: [],
      final: `${conceptsBlock}\nExtract facts, misconceptions, and workplace applications for these concepts.`,
      orgId: journey.orgId,
      contentId: journey.contentId,
    },
    { promptVersion: DESIGN_PROMPT_VERSION },
  );

  const parsed = FactsResult.safeParse(raw);
  const factsList: Fact[] = parsed.success ? parsed.data.facts : (raw.facts as Fact[]);
  const unsupported = parsed.success ? parsed.data.unsupported : [];

  // 4. Deterministic quote verification
  const { kept, dropped } = verifyQuotes(factsList, content.quotable);

  // 5. Entailment / grounding check on kept facts
  const claims = kept.map((f) => ({ id: f.id, claim: f.statement }));
  const excerpts = relevantChunks.map((c) => ({ id: c.id, text: c.text }));
  const grounding = await checkGrounding(claims, excerpts, {
    llm,
    orgId: journey.orgId,
    contentId: journey.contentId,
  });
  const groundingMap = new Map(grounding.results.map((r) => [r.id, r]));

  // 6. Persist verified facts to database
  if (kept.length > 0) {
    const factValues = kept
      .map((f) => {
        const conceptId = conceptKeyToId.get(f.conceptKey);
        if (!conceptId) return null;
        const g = groundingMap.get(f.id);
        return {
          contentId: journey.contentId,
          conceptId,
          key: f.id,
          statement: f.statement,
          anchors: f.anchors,
          quoteVerified: true,
          groundingStatus: (g?.verdict as (typeof GROUNDING_STATUSES)[number]) ?? "pending",
          groundingNote: g?.note ?? null,
          checkedAt: new Date(),
          promptVersion: DESIGN_PROMPT_VERSION,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (factValues.length > 0) {
      await db.insert(factsTable).values(factValues);
    }
  }

  // 7. Update concept misconceptions and applications if available
  if (parsed.success) {
    for (const c of chapterConcepts) {
      const cId = conceptKeyToId.get(c.key);
      if (!cId) continue;
      const m = parsed.data.misconceptions.filter((x) => x.conceptKey === c.key);
      const a = parsed.data.applications.filter((x) => x.conceptKey === c.key).map((x) => x.text);
      if (m.length > 0 || a.length > 0) {
        await db
          .update(concepts)
          .set({
            ...(m.length > 0 ? { misconceptions: m } : {}),
            ...(a.length > 0 ? { applications: a } : {}),
          })
          .where(eq(concepts.id, cId));
      }
    }
  }

  return {
    facts: kept,
    dropped,
    unsupported,
  };
}
