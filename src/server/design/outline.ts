import crypto from "node:crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  ConceptOutline,
  ConceptOutlineLoose,
  type ConceptOutline as Outline,
} from "@/lib/schemas/design";
import type { Config } from "../config/schema";
import { db as defaultDb, type Db } from "../db/client";
import { conceptEdges, concepts, journeys, missions } from "../db/schema";
import { llm as defaultLlm, type Llm } from "../llm/provider";
import {
  DESIGN_PROMPT_VERSION,
  OUTLINE_ROLE,
  documentBlock,
  outlineRules,
} from "../llm/prompts/design";
import { log } from "../obs/logger";
import type { DesignContent } from "./context";

export interface OutlineResult {
  journeyId: string;
  outline: Outline;
  warnings: string[];
  conceptIds: Record<string, string>;
  missionIds: { id: string; key: string; ordinal: number; chapterKey: string }[];
  reused: boolean;
}

export type Send = (event: string, data: unknown) => void;

/** sha256 of source hash, the design config subset and the prompt version. */
export function designHash(content: DesignContent, config: Config): string {
  const subset = {
    design: config.content.design,
    mechanics: config.mechanics,
    personas: config.personas.map((p) => p.id),
    prompt: DESIGN_PROMPT_VERSION,
  };
  return crypto
    .createHash("sha256")
    .update(content.sourceHash)
    .update(JSON.stringify(subset))
    .digest("hex");
}

/** Break prerequisite cycles by dropping the edge into the least important concept; returns warnings. */
export function breakCycles(outline: Outline): string[] {
  const warnings: string[] = [];
  const importance = new Map(outline.concepts.map((c) => [c.key, c.importance]));
  const keys = new Set(outline.concepts.map((c) => c.key));
  for (const c of outline.concepts)
    c.prerequisites = c.prerequisites.filter((p) => keys.has(p) && p !== c.key);

  const hasCycle = (): string[] | null => {
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const visit = (k: string): string[] | null => {
      state.set(k, 1);
      stack.push(k);
      for (const p of outline.concepts.find((c) => c.key === k)!.prerequisites) {
        const s = state.get(p) ?? 0;
        if (s === 1) return stack.slice(stack.indexOf(p));
        if (s === 0) {
          const found = visit(p);
          if (found) return found;
        }
      }
      stack.pop();
      state.set(k, 2);
      return null;
    };
    for (const c of outline.concepts)
      if ((state.get(c.key) ?? 0) === 0) {
        const found = visit(c.key);
        if (found) return found;
      }
    return null;
  };

  for (let guard = 0; guard < 50; guard++) {
    const cycle = hasCycle();
    if (!cycle) break;
    // Weakest edge: the one pointing at the least important concept in the cycle.
    let weakest = { from: cycle[0]!, to: cycle[1] ?? cycle[0]!, imp: Infinity };
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i]!;
      const to = cycle[(i + 1) % cycle.length]!;
      const imp = importance.get(to) ?? 0;
      if (imp < weakest.imp) weakest = { from, to, imp };
    }
    const c = outline.concepts.find((x) => x.key === weakest.from)!;
    c.prerequisites = c.prerequisites.filter((p) => p !== weakest.to);
    warnings.push(
      `Prerequisite loop ${cycle.join(" -> ")} broken by dropping ${weakest.from} -> ${weakest.to}.`,
    );
  }
  return warnings;
}

/** Drop chunk ids the model invented; a concept left with none is removed with a warning. */
function checkChunkIds(outline: Outline, content: DesignContent): string[] {
  const warnings: string[] = [];
  const known = new Set(content.quotable.map((c) => c.id));
  const byOrdinal = new Map(content.quotable.map((c) => [String(c.ordinal), c.id]));
  outline.concepts = outline.concepts.filter((c) => {
    const ids = [
      ...new Set(
        c.chunkIds
          .map((id) => (known.has(id) ? id : (byOrdinal.get(id) ?? null)))
          .filter((x): x is string => !!x),
      ),
    ];
    if (ids.length !== c.chunkIds.length)
      warnings.push(
        `Concept ${c.key}: ${c.chunkIds.length - ids.length} unknown chunk reference(s) dropped.`,
      );
    c.chunkIds = ids;
    return ids.length > 0;
  });
  return warnings;
}

/**
 * Outline via the design tier, validated and repaired in code, then
 * persisted as concepts, edges, a journey and pending mission rows. Idempotent
 * per (content, design hash): a matching journey is reused.
 */
export async function generateOutline(
  content: DesignContent,
  config: Config,
  send: Send,
  deps: { db?: Db; llm?: Llm } = {},
): Promise<OutlineResult> {
  const db = deps.db ?? defaultDb;
  const llm = deps.llm ?? defaultLlm;
  const hash = designHash(content, config);

  const [existing] = await db
    .select({ id: journeys.id, outline: journeys.outline, status: journeys.status })
    .from(journeys)
    .where(and(eq(journeys.contentId, content.id), eq(journeys.designHash, hash)))
    .limit(1);
  if (existing && existing.status !== "failed") {
    const outline = ConceptOutline.parse(existing.outline);
    const conceptRows = await db
      .select({ id: concepts.id, key: concepts.key })
      .from(concepts)
      .where(eq(concepts.contentId, content.id));
    const missionRows = await db
      .select({
        id: missions.id,
        chapterKey: missions.chapterKey,
        ordinal: missions.ordinal,
        pack: missions.pack,
      })
      .from(missions)
      .where(eq(missions.journeyId, existing.id));
    send("outline.partial", {
      title: outline.title,
      chapters: outline.chapters.length,
      concepts: outline.concepts.length,
      reused: true,
    });
    return {
      journeyId: existing.id,
      outline,
      warnings: outline.warnings,
      conceptIds: Object.fromEntries(conceptRows.map((r) => [r.key, r.id])),
      // In journey order. The rows came back unordered, and callers take the first as mission 1:
      // a retried upload built mission 2 as its first and left a failed mission 1 behind it.
      missionIds: missionRows
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((m) => ({
          id: m.id,
          key: missionKeyOf(outline, m.chapterKey, m.ordinal),
          ordinal: m.ordinal,
          chapterKey: m.chapterKey,
        })),
      reused: true,
    };
  }

  // Document block: quotable chunks up to the full-context budget (section digests are cut).
  let tokens = 0;
  const chunks = content.quotable.filter(
    (c) => (tokens += c.tokenCount) <= config.content.design.fullDocMaxTokens,
  );
  const warnings: string[] = [];
  if (chunks.length < content.quotable.length) {
    warnings.push(
      `Only the first ${chunks.length} of ${content.quotable.length} passages fit the design budget; later material is not covered yet.`,
    );
  }
  const docTokens = chunks.reduce((n, c) => n + c.tokenCount, 0);
  const maxMissions = missionBudget(docTokens, config.content.design);
  const enabledMechanics = Object.entries(config.mechanics.enabled)
    .filter(([, on]) => on)
    .map(([k]) => k);
  const rules = outlineRules({
    maxConcepts: config.content.design.maxConcepts,
    maxChapters: config.content.design.maxChapters,
    missionsPerChapter: config.content.design.missionsPerChapter,
    enabledMechanics,
    mechanicWeights: config.mechanics.weights,
  });

  send("stage.progress", {
    stage: "outline",
    message: "Reading the document and mapping concepts",
  });
  const { value: raw } = await llm.object(
    "content.outline",
    ConceptOutlineLoose,
    {
      system: `${OUTLINE_ROLE}\n\n${rules}`,
      packBlocks: [documentBlock(chunks)],
      history: [],
      // The budget is per document, so it goes in the final message: the system prompt and
      // document block stay a stable, cacheable prefix.
      final: `Produce the outline now as JSON matching the schema. This document is about ${docTokens} tokens, so the journey has at most ${maxMissions} mission${maxMissions === 1 ? "" : "s"} in total across all chapters. Fewer, fuller missions beat many thin ones.`,
      orgId: content.orgId,
      contentId: content.id,
    },
    { promptVersion: DESIGN_PROMPT_VERSION },
  );

  const parsed = ConceptOutline.safeParse(raw);
  const outline: Outline = parsed.success ? parsed.data : repairOutline(raw, warnings);
  warnings.push(...outline.warnings, ...checkChunkIds(outline, content), ...breakCycles(outline));
  // Missions must reference surviving concepts.
  const keys = new Set(outline.concepts.map((c) => c.key));
  for (const ch of outline.chapters) {
    ch.missions = ch.missions.filter((m) => {
      m.conceptKeys = m.conceptKeys.filter((k) => keys.has(k));
      return m.conceptKeys.length > 0;
    });
    ch.missions = ch.missions.slice(0, config.content.design.missionsPerChapter);
  }
  // Enforce the budget in code too; the model is asked, not trusted. Chapters come in order,
  // so the missions cut are the last ones.
  let budgetLeft = maxMissions;
  for (const ch of outline.chapters) {
    ch.missions = ch.missions.slice(0, Math.max(0, budgetLeft));
    budgetLeft -= ch.missions.length;
  }
  outline.chapters = outline.chapters
    .filter((ch) => ch.missions.length > 0)
    .slice(0, config.content.design.maxChapters);
  outline.warnings = [...new Set(warnings)];
  const final = ConceptOutline.parse(outline);
  send("outline.partial", {
    title: final.title,
    chapters: final.chapters.length,
    concepts: final.concepts.length,
    reused: false,
  });

  // Persist: journey, concepts, edges, missions (pending). Journey first so children can reference it.
  const [journey] = await db
    .insert(journeys)
    .values({
      contentId: content.id,
      orgId: content.orgId,
      designHash: hash,
      title: final.title,
      story: final.story,
      outline: final,
      status: "designing",
      promptVersion: DESIGN_PROMPT_VERSION,
    })
    .returning({ id: journeys.id });

  // Upsert on (contentId, key) rather than delete and recreate. evidence_events and
  // mastery_states reference concept_id with ON DELETE CASCADE, so deleting concepts on a
  // re-run silently destroyed every learner's progress on that content. Concept keys are
  // stable identifiers with a unique index, so a re-design keeps the id where the key
  // survives, and only genuinely removed concepts lose their evidence.
  const conceptRows = await db
    .insert(concepts)
    .values(
      final.concepts.map((c) => ({
        contentId: content.id,
        orgId: content.orgId,
        key: c.key,
        name: c.name,
        nameUr: c.nameUr,
        summary: c.summary,
        difficulty: c.difficulty,
        importance: c.importance,
        chunkIds: c.chunkIds,
      })),
    )
    .onConflictDoUpdate({
      target: [concepts.contentId, concepts.key],
      set: {
        name: sql`excluded.name`,
        nameUr: sql`excluded.name_ur`,
        summary: sql`excluded.summary`,
        difficulty: sql`excluded.difficulty`,
        importance: sql`excluded.importance`,
        chunkIds: sql`excluded.chunk_ids`,
      },
    })
    .returning({ id: concepts.id, key: concepts.key });

  // Concepts the new design dropped. Their evidence goes with them, which is correct:
  // the concept no longer exists to have progress against.
  const keptKeys = final.concepts.map((c) => c.key);
  await db
    .delete(concepts)
    .where(and(eq(concepts.contentId, content.id), notInArray(concepts.key, keptKeys)));
  const conceptIds = Object.fromEntries(conceptRows.map((r) => [r.key, r.id]));
  const edgeRows = final.concepts.flatMap((c) =>
    c.prerequisites.map((p) => ({
      contentId: content.id,
      fromConceptId: conceptIds[p]!,
      toConceptId: conceptIds[c.key]!,
      kind: "prerequisite" as const,
    })),
  );
  if (edgeRows.length) await db.insert(conceptEdges).values(edgeRows).onConflictDoNothing();

  let ordinal = 0;
  const missionValues = final.chapters.flatMap((ch) =>
    ch.missions.map((m) => ({
      journeyId: journey!.id,
      chapterKey: ch.key,
      ordinal: ordinal++,
      title: m.title,
      conceptIds: m.conceptKeys.map((k) => conceptIds[k]!),
      primaryMechanic: m.mechanic,
      alternates: m.alternates,
      packStatus: "pending" as const,
    })),
  );
  const missionRows = await db
    .insert(missions)
    .values(missionValues)
    .returning({ id: missions.id, ordinal: missions.ordinal, chapterKey: missions.chapterKey });

  log.info({
    event: "outline_done",
    contentId: content.id,
    concepts: final.concepts.length,
    missions: missionRows.length,
    warnings: final.warnings.length,
  });
  return {
    journeyId: journey!.id,
    outline: final,
    warnings: final.warnings,
    conceptIds,
    missionIds: missionRows.map((m) => ({
      id: m.id,
      key: missionKeyOf(final, m.chapterKey, m.ordinal),
      ordinal: m.ordinal,
      chapterKey: m.chapterKey,
    })),
    reused: false,
  };
}

/**
 * How many missions a document can carry: about one per tokensPerMission of quotable text,
 * at least 1, at most maxChapters x missionsPerChapter. Each mission needs its own verified
 * facts, and a short text spread over many missions leaves each too little to cite.
 */
export function missionBudget(
  docTokens: number,
  design: { tokensPerMission: number; maxChapters: number; missionsPerChapter: number },
): number {
  const cap = design.maxChapters * design.missionsPerChapter;
  return Math.min(cap, Math.max(1, Math.ceil(docTokens / design.tokensPerMission)));
}

/** The mission key at a journey ordinal, walking chapters in order. */
export function missionKeyOf(outline: Outline, chapterKey: string, ordinal: number): string {
  let i = 0;
  for (const ch of outline.chapters)
    for (const m of ch.missions) {
      if (i === ordinal && ch.key === chapterKey) return m.key;
      i++;
    }
  return `m_${ordinal + 1}`;
}

/** Best-effort repair of an outline that failed strict validation: clamp numbers, slug keys, trim arrays. */
function repairOutline(raw: unknown, warnings: string[]): Outline {
  const o = ConceptOutlineLoose.parse(raw);
  const slug = (k: string) => {
    const s = k
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    return /^c_/.test(s) ? s : `c_${s}`.slice(0, 43);
  };
  const rename = new Map(o.concepts.map((c) => [c.key, slug(c.key)]));
  const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n || 1)));
  o.concepts = o.concepts.slice(0, 30).map((c) => ({
    ...c,
    key: rename.get(c.key)!,
    difficulty: clamp(c.difficulty),
    importance: clamp(c.importance),
    prerequisites: c.prerequisites.map((p) => rename.get(p) ?? p),
  }));
  o.chapters = o.chapters.slice(0, 8).map((ch) => ({
    ...ch,
    missions: ch.missions.slice(0, 4).map((m) => ({
      ...m,
      conceptKeys: m.conceptKeys.map((k) => rename.get(k) ?? k),
      alternates: m.alternates.slice(0, 2),
    })),
  }));
  o.story.characters = o.story.characters.slice(0, 4);
  warnings.push("The outline needed light repair (keys, counts or ranges were adjusted).");
  return ConceptOutline.parse(o);
}
