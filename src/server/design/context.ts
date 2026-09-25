import { and, asc, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { contentChunks, contents } from "../db/schema";
import { errors } from "../http/errors";

export interface DesignChunk {
  id: string;
  ordinal: number;
  anchor: { kind: string; ref: string; start: number; end: number };
  headingPath: string[];
  text: string;
  tokenCount: number;
  lang: string | null;
  injectionFlag: boolean;
}

export interface DesignContent {
  id: string;
  orgId: string;
  title: string;
  sourceHash: string;
  chunks: DesignChunk[];
  /** Chunks the model may quote: flagged ones stay out until classified. */
  quotable: DesignChunk[];
}

export async function loadContent(
  contentId: string,
  orgId: string,
  db: Db = defaultDb,
): Promise<DesignContent> {
  const [row] = await db
    .select({
      id: contents.id,
      orgId: contents.orgId,
      title: contents.title,
      sourceHash: contents.sourceHash,
    })
    .from(contents)
    .where(and(eq(contents.id, contentId), eq(contents.orgId, orgId)))
    .limit(1);
  if (!row) throw errors.notFound("That content does not exist or is not in your organization.");
  const rows = await db
    .select()
    .from(contentChunks)
    .where(eq(contentChunks.contentId, contentId))
    .orderBy(asc(contentChunks.ordinal));
  const chunks: DesignChunk[] = rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    anchor: { kind: r.anchorKind, ref: r.anchorRef, start: r.charStart, end: r.charEnd },
    headingPath: r.headingPath,
    text: r.text,
    tokenCount: r.tokenCount,
    lang: r.lang,
    injectionFlag: r.injectionFlag,
  }));
  return { ...row, chunks, quotable: chunks.filter((c) => !c.injectionFlag) };
}

/** Chunks for a set of concepts, in document order, capped by token budget. */
export function chunksFor(
  content: DesignContent,
  chunkIds: Iterable<string>,
  maxTokens: number,
): DesignChunk[] {
  const wanted = new Set(chunkIds);
  const out: DesignChunk[] = [];
  let tokens = 0;
  for (const c of content.quotable) {
    if (!wanted.has(c.id)) continue;
    if (tokens + c.tokenCount > maxTokens && out.length) break;
    out.push(c);
    tokens += c.tokenCount;
  }
  return out;
}
