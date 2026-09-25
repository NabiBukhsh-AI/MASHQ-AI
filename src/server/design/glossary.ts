import { eq } from "drizzle-orm";
import { GlossaryResult, type GlossaryResult as GlossaryOutput } from "@/lib/schemas/design";
import { db as defaultDb, type Db } from "../db/client";
import { contentChunks, contents, glossaryTerms } from "../db/schema";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import { DESIGN_PROMPT_VERSION, GLOSSARY_TASK, documentBlock } from "../llm/prompts/design";
import { errors } from "../http/errors";

export type GlossaryTerm = GlossaryOutput["terms"][number];

/**
 * Build or retrieve glossary terms for a content item.
 * Terms include English, Urdu script, Roman Urdu, definitions, and speech hints.
 */
export async function buildGlossary(
  contentId: string,
  deps: { db?: Db; llm?: Llm } = {},
): Promise<GlossaryTerm[]> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? defaultLlm;

  // 1. Check for existing terms in database
  const existing = await db
    .select()
    .from(glossaryTerms)
    .where(eq(glossaryTerms.contentId, contentId));

  if (existing.length > 0) {
    return existing.map((r) => ({
      en: r.termEn,
      ur: r.termUr ?? "",
      roman: r.termRoman ?? "",
      definition: r.definition,
      speechHint: r.speechHint ?? "",
      chunkIds: r.chunkIds ?? [],
    }));
  }

  // 2. Load content and chunks
  const [contentRow] = await db
    .select({ id: contents.id, orgId: contents.orgId })
    .from(contents)
    .where(eq(contents.id, contentId))
    .limit(1);

  if (!contentRow) {
    throw errors.notFound("Content item not found.");
  }

  const chunkRows = await db
    .select({
      id: contentChunks.id,
      anchorKind: contentChunks.anchorKind,
      anchorRef: contentChunks.anchorRef,
      text: contentChunks.text,
      injectionFlag: contentChunks.injectionFlag,
    })
    .from(contentChunks)
    .where(eq(contentChunks.contentId, contentId));

  const quotable = chunkRows
    .filter((c) => !c.injectionFlag)
    .map((c) => ({
      id: c.id,
      anchor: { kind: c.anchorKind, ref: c.anchorRef },
      text: c.text,
    }));

  if (quotable.length === 0) {
    return [];
  }

  const validChunkIds = new Set(quotable.map((c) => c.id));

  // 3. Extract glossary terms via fast tier LLM
  const { value } = await llm.object(
    "content.glossary",
    GlossaryResult,
    {
      system: GLOSSARY_TASK,
      packBlocks: [documentBlock(quotable)],
      history: [],
      final:
        "Extract up to 30 domain glossary terms from the document as JSON matching the schema.",
      orgId: contentRow.orgId,
      contentId,
    },
    { promptVersion: DESIGN_PROMPT_VERSION },
  );

  const validated = GlossaryResult.parse(value);
  const cleanedTerms: GlossaryTerm[] = validated.terms.map((t) => ({
    ...t,
    chunkIds: t.chunkIds.filter((id) => validChunkIds.has(id)),
  }));

  if (cleanedTerms.length === 0) {
    return [];
  }

  // 4. Persist glossary terms to database
  await db.insert(glossaryTerms).values(
    cleanedTerms.map((t) => ({
      contentId,
      termEn: t.en,
      termUr: t.ur,
      termRoman: t.roman,
      definition: t.definition,
      speechHint: t.speechHint,
      chunkIds: t.chunkIds,
    })),
  );

  return cleanedTerms;
}
