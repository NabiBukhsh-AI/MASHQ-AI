import { sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import type { Config } from "../config/schema";

// Full-text branch always runs; the semantic branch runs when
// a query embedding is supplied and chunks carry embeddings (embeddings are
// off for now, so today this is keyword retrieval with the RRF
// shape kept so the semantic branch drops in without a caller change).
// Always scoped by content and, through the content row, by org.

export interface RetrievedChunk {
  chunkId: string;
  anchor: { kind: string; ref: string };
  text: string;
  score: number;
  source: "keyword" | "semantic" | "hybrid";
  injectionFlag: boolean;
}

export interface RetrieveArgs {
  orgId: string;
  contentId: string;
  /** English query for the keyword branch (rewriteQuery produces it). */
  query: string;
  k?: number;
  /** Optional 768-dim query embedding for the semantic branch. */
  embedding?: number[];
  retrieval: Config["grounding"]["retrieval"];
}

export async function retrieve(args: RetrieveArgs, db: Db = defaultDb): Promise<RetrievedChunk[]> {
  const k = args.k ?? args.retrieval.topK;
  const rrfK = args.retrieval.rrfK;
  const penalty = args.retrieval.flaggedPenalty;
  const query = args.query.trim();
  if (!query && !args.embedding) return [];

  const semantic = args.embedding
    ? sql`
      sem AS (
        SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> ${`[${args.embedding.join(",")}]`}::halfvec) AS r
        FROM content_chunks c
        JOIN contents ct ON ct.id = c.content_id AND ct.org_id = ${args.orgId} AND ct.deleted_at IS NULL
        WHERE c.content_id = ${args.contentId} AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${`[${args.embedding.join(",")}]`}::halfvec
        LIMIT 20
      ),`
    : sql`sem AS (SELECT NULL::uuid AS id, NULL::bigint AS r WHERE false),`;

  const rows = await db.execute(sql`
    WITH ${semantic}
    kw AS (
      SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, q) DESC) AS r
      FROM content_chunks c
      JOIN contents ct ON ct.id = c.content_id AND ct.org_id = ${args.orgId} AND ct.deleted_at IS NULL,
      websearch_to_tsquery('english', ${query}) q
      WHERE c.content_id = ${args.contentId} AND ${query} <> '' AND c.tsv @@ q
      ORDER BY ts_rank_cd(c.tsv, q) DESC
      LIMIT 20
    )
    SELECT c.id, c.anchor_kind, c.anchor_ref, c.text, c.injection_flag,
           (COALESCE(1.0 / (${rrfK}::int + sem.r), 0) + COALESCE(1.0 / (${rrfK}::int + kw.r), 0))
             * CASE WHEN c.injection_flag THEN ${penalty}::float8 ELSE 1 END AS rrf,
           (sem.id IS NOT NULL) AS in_sem, (kw.id IS NOT NULL) AS in_kw
    FROM content_chunks c
    LEFT JOIN sem ON sem.id = c.id
    LEFT JOIN kw ON kw.id = c.id
    WHERE sem.id IS NOT NULL OR kw.id IS NOT NULL
    ORDER BY rrf DESC
    LIMIT ${k}::int
  `);

  return rows.rows.map((r) => ({
    chunkId: r.id as string,
    anchor: { kind: r.anchor_kind as string, ref: r.anchor_ref as string },
    text: r.text as string,
    score: Number(r.rrf),
    source: r.in_sem && r.in_kw ? "hybrid" : r.in_sem ? "semantic" : "keyword",
    injectionFlag: Boolean(r.injection_flag),
  }));
}

/** In-source decision: any keyword hit, or a semantic score above the floor. */
export function isInSource(
  results: RetrievedChunk[],
  topSemantic: number | null,
  minSemantic: number,
): boolean {
  if (results.some((r) => r.source !== "semantic")) return true;
  return topSemantic !== null && topSemantic >= minSemantic;
}
