import { sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";

/**
 * The content library: every document the organization has added, with the journey built
 * from it and how far that journey is ready to play.
 *
 * This file used to be a mock. listDocuments returned a hardcoded "Sample Document" whatever
 * was asked, and the route called it with orgId "mock-org" rather than the caller's org, so
 * the library could never show what had actually been uploaded. deleteDocument returned true
 * without deleting anything; no route called it, and it is removed rather than left as a trap
 * for the next person who wires up a delete button.
 */
export interface LibraryItem {
  id: string;
  title: string;
  sourceType: string;
  /** Primary language of the material, as detected at ingest or set by the uploader. */
  language: string | null;
  status: string;
  createdAt: string;
  uploadedBy: string | null;
  chars: number | null;
  journey: {
    id: string;
    title: string;
    status: string;
    missions: number;
    readyMissions: number;
  } | null;
  /** The concepts the design stage found, which is what a manager filters by as a topic. */
  topics: string[];
  /** The caller's unfinished session on this journey, so the library can offer "Continue". */
  resumeSessionId: string | null;
}

export async function listLibrary(
  orgId: string,
  opts: {
    db?: Db;
    /** Whose unfinished sessions to look up for "Continue". */
    userId?: string;
    /** Only documents with at least one mission ready to play: what a learner can use. */
    playableOnly?: boolean;
  } = {},
): Promise<LibraryItem[]> {
  const db = opts.db ?? defaultDb;
  const res = await db.execute(sql`
    SELECT
      c.id,
      c.title,
      c.source_type,
      c.lang_primary,
      c.status,
      c.created_at,
      (c.stats ->> 'chars')::int                                   AS chars,
      u.name                                                       AS uploaded_by,
      j.id                                                         AS journey_id,
      j.title                                                      AS journey_title,
      j.status                                                     AS journey_status,
      (SELECT count(*)::int FROM missions m WHERE m.journey_id = j.id)
                                                                   AS missions,
      (SELECT count(*)::int FROM missions m
         WHERE m.journey_id = j.id AND m.pack_status = 'ready')    AS ready_missions,
      ARRAY(
        SELECT k.name FROM concepts k
        WHERE k.content_id = c.id
        ORDER BY k.importance DESC NULLS LAST, k.name
        LIMIT 6
      )                                                            AS topics,
      s.id                                                         AS resume_session_id
    FROM contents c
    LEFT JOIN "user" u ON u.id = c.owner_id
    -- The most recent journey for each document: a re-design writes a new one, and the
    -- library should describe the one learners will actually get.
    LEFT JOIN LATERAL (
      SELECT id, title, status FROM journeys
      WHERE content_id = c.id
      ORDER BY created_at DESC
      LIMIT 1
    ) j ON TRUE
    LEFT JOIN LATERAL (
      SELECT id FROM learning_sessions
      WHERE journey_id = j.id AND org_id = ${orgId} AND user_id = ${opts.userId ?? ""}
        AND status = 'active'
      ORDER BY last_active_at DESC
      LIMIT 1
    ) s ON TRUE
    WHERE c.org_id = ${orgId} AND c.deleted_at IS NULL
    ${
      opts.playableOnly
        ? sql`AND EXISTS (SELECT 1 FROM missions m WHERE m.journey_id = j.id AND m.pack_status = 'ready')`
        : sql``
    }
    ORDER BY c.created_at DESC
    LIMIT 200
  `);

  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    sourceType: String(r.source_type),
    language: (r.lang_primary as string | null) ?? null,
    status: String(r.status),
    createdAt: new Date(String(r.created_at)).toISOString(),
    uploadedBy: (r.uploaded_by as string | null) ?? null,
    chars: r.chars === null || r.chars === undefined ? null : Number(r.chars),
    journey: r.journey_id
      ? {
          id: String(r.journey_id),
          title: String(r.journey_title),
          status: String(r.journey_status),
          missions: Number(r.missions ?? 0),
          readyMissions: Number(r.ready_missions ?? 0),
        }
      : null,
    topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
    resumeSessionId: (r.resume_session_id as string | null) ?? null,
  }));
}
