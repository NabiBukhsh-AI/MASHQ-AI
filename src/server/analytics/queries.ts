import { sql, type SQL } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { windowOf, type Filters } from "./filters";

/**
 * One typed query per dashboard widget, reading the analytics views in drizzle/views.sql.
 *
 * Every query takes orgId as its own argument, never from the filters, so a caller cannot
 * widen the scope by sending a different org in the query string. The filters only narrow.
 */

export type WidgetName =
  | "summary"
  | "kpis"
  | "masteryMatrix"
  | "funnel"
  | "missionDropoff"
  | "languageVoice"
  | "contentHealth"
  | "personas"
  | "cost"
  | "latency";

export const WIDGETS: WidgetName[] = [
  "summary",
  "kpis",
  "masteryMatrix",
  "funnel",
  "missionDropoff",
  "languageVoice",
  "contentHealth",
  "personas",
  "cost",
  "latency",
];

/**
 * A Postgres array built from bound parameters, one per element.
 *
 * The Neon driver flattens a one element JS array to a scalar, so `= ANY(${["ur"]})` reached
 * Postgres as `= ANY($1)` with $1 a bare string and the query threw. Filtering the dashboard
 * to a single language, cohort, department, persona, modality or content id therefore failed
 * with a 500, on every widget, which the e2e suite never saw because it mocks the API.
 */
function pgArray(values: readonly string[], type: "text" | "uuid" = "text"): SQL {
  const items = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return sql`ARRAY[${items}]::${sql.raw(type)}[]`;
}

/** Builds the shared WHERE fragment. Everything is parameterised, never interpolated. */
function sessionScope(orgId: string, filters: Filters, now = new Date()): SQL {
  const { from, to } = windowOf(filters, now);
  const parts: SQL[] = [
    sql`org_id = ${orgId}`,
    sql`started_at >= ${from.toISOString()}`,
    sql`started_at <= ${to.toISOString()}`,
  ];
  if (!filters.includeSeeded) parts.push(sql`is_seeded = false`);
  if (filters.contentIds?.length) {
    parts.push(sql`content_id = ANY(${pgArray(filters.contentIds, "uuid")})`);
  }
  if (filters.cohorts?.length) parts.push(sql`cohort = ANY(${pgArray(filters.cohorts)})`);
  if (filters.departments?.length)
    parts.push(sql`department = ANY(${pgArray(filters.departments)})`);
  if (filters.personas?.length) parts.push(sql`persona_id = ANY(${pgArray(filters.personas)})`);
  if (filters.languages?.length) parts.push(sql`language = ANY(${pgArray(filters.languages)})`);
  if (filters.modalities?.length) parts.push(sql`modality = ANY(${pgArray(filters.modalities)})`);
  return sql.join(parts, sql` AND `);
}

/**
 * The scope fragment for views keyed on learner rather than session.
 *
 * Mastery is a stored snapshot and cannot be recomputed under a filter, so the session
 * dimensions decide which (learner, concept) pairs are shown: the ones whose evidence came
 * from sessions that match. They are arrays on the view, tested with the && overlap operator.
 * Until this was written, the heatmap and the mastery half of the KPIs ignored the date
 * window, language, modality, persona and content entirely.
 */
function learnerScope(orgId: string, filters: Filters, now = new Date()): SQL {
  const { from, to } = windowOf(filters, now);
  const parts: SQL[] = [
    sql`org_id = ${orgId}`,
    // The pair counts if any of its evidence falls inside the window.
    sql`last_evidence_at >= ${from.toISOString()}`,
    sql`first_evidence_at <= ${to.toISOString()}`,
  ];
  if (!filters.includeSeeded) parts.push(sql`is_seeded = false`);
  if (filters.cohorts?.length) parts.push(sql`cohort = ANY(${pgArray(filters.cohorts)})`);
  if (filters.departments?.length)
    parts.push(sql`department = ANY(${pgArray(filters.departments)})`);
  if (filters.languages?.length) parts.push(sql`languages && ${pgArray(filters.languages)}`);
  if (filters.modalities?.length) parts.push(sql`modalities && ${pgArray(filters.modalities)}`);
  if (filters.personas?.length) parts.push(sql`persona_ids && ${pgArray(filters.personas)}`);
  return sql.join(parts, sql` AND `);
}

/** The same, for v_mastery_gain, which carries content_ids as well. */
function gainScopeOf(orgId: string, filters: Filters, now = new Date()): SQL {
  const parts: SQL[] = [learnerScope(orgId, filters, now)];
  if (filters.contentIds?.length)
    parts.push(sql`content_ids && ${pgArray(filters.contentIds, "uuid")}`);
  return sql.join(parts, sql` AND `);
}

/** Evidence-grain scope for v_content_health, which carries every dimension as a column. */
function evidenceScope(orgId: string, filters: Filters, now = new Date()): SQL {
  const { from, to } = windowOf(filters, now);
  const parts: SQL[] = [
    sql`org_id = ${orgId}`,
    sql`created_at >= ${from.toISOString()}`,
    sql`created_at <= ${to.toISOString()}`,
  ];
  if (!filters.includeSeeded) parts.push(sql`is_seeded = false`);
  if (filters.contentIds?.length)
    parts.push(sql`content_id = ANY(${pgArray(filters.contentIds, "uuid")})`);
  if (filters.cohorts?.length) parts.push(sql`cohort = ANY(${pgArray(filters.cohorts)})`);
  if (filters.departments?.length)
    parts.push(sql`department = ANY(${pgArray(filters.departments)})`);
  if (filters.languages?.length) parts.push(sql`language = ANY(${pgArray(filters.languages)})`);
  if (filters.modalities?.length) parts.push(sql`modality = ANY(${pgArray(filters.modalities)})`);
  if (filters.personas?.length) parts.push(sql`persona_id = ANY(${pgArray(filters.personas)})`);
  return sql.join(parts, sql` AND `);
}

export interface Kpis {
  activeLearners: number;
  sessions: number;
  turns: number;
  completionRate: number;
  meanMasteryGain: number;
  conceptsPractised: number;
  costUsd: number;
}

export async function kpis(
  orgId: string,
  filters: Filters,
  deps: { db?: Db; now?: Date } = {},
): Promise<Kpis> {
  const db = deps.db ?? defaultDb;
  const scope = sessionScope(orgId, filters, deps.now);
  const gainScope = gainScopeOf(orgId, filters, deps.now);

  // Two independent reads: issued together, because Neon HTTP charges a round trip each
  // and sequentially they pushed the summary widget to 395 ms against a 300 ms budget.
  const [sessionRes, gainRes] = await Promise.all([
    db.execute(sql`
      SELECT
        count(DISTINCT user_id)::int                                   AS active_learners,
        count(*)::int                                                  AS sessions,
        COALESCE(sum(turn_count), 0)::int                              AS turns,
        COALESCE(avg(CASE WHEN finished THEN 1.0 ELSE 0.0 END), 0)     AS completion_rate,
        COALESCE(sum(cost_usd::numeric), 0)                            AS cost_usd
      FROM v_session_facts WHERE ${scope}
    `),
    db.execute(sql`
      SELECT
        COALESCE(avg(gain), 0)               AS mean_gain,
        count(DISTINCT concept_id)::int      AS concepts
      FROM v_mastery_gain WHERE ${gainScope}
    `),
  ]);

  const [row] = sessionRes.rows as Array<Record<string, unknown>>;
  const [gain] = gainRes.rows as Array<Record<string, unknown>>;

  return {
    activeLearners: Number(row?.active_learners ?? 0),
    sessions: Number(row?.sessions ?? 0),
    turns: Number(row?.turns ?? 0),
    completionRate: Number(row?.completion_rate ?? 0),
    costUsd: Number(row?.cost_usd ?? 0),
    meanMasteryGain: Number(gain?.mean_gain ?? 0),
    conceptsPractised: Number(gain?.concepts ?? 0),
  };
}

/**
 * The sentence at the top of the manager view. Written by code from the numbers, never by a
 * model, so it can never claim something the data does not support.
 */
export function summarySentence(k: Kpis, days = 14): string {
  if (k.sessions === 0) {
    return `No practice recorded in the last ${days} days for these filters.`;
  }
  const learners = `${k.activeLearners} learner${k.activeLearners === 1 ? "" : "s"}`;
  const topics = `${k.conceptsPractised} topic${k.conceptsPractised === 1 ? "" : "s"}`;
  const gain = k.meanMasteryGain.toFixed(2);
  const completion = Math.round(k.completionRate * 100);
  return (
    `In the last ${days} days, ${learners} practised ${topics}. ` +
    `Estimated mastery rose by ${gain} on average, and ${completion}% of sessions were completed.`
  );
}

export async function masteryMatrix(
  orgId: string,
  filters: Filters,
  deps: { db?: Db; now?: Date } = {},
) {
  const db = deps.db ?? defaultDb;
  const scope = learnerScope(orgId, filters, deps.now);
  const res = await db.execute(sql`
    SELECT pseudonym, concept_key, concept_label, p, band, lower, upper, n_events
    FROM v_mastery_matrix WHERE ${scope}
    ORDER BY pseudonym, concept_key
    LIMIT 2000
  `);
  return res.rows as Array<Record<string, unknown>>;
}

export async function funnel(orgId: string, filters: Filters, deps: { db?: Db; now?: Date } = {}) {
  const db = deps.db ?? defaultDb;
  const scope = sessionScope(orgId, filters, deps.now);
  const [row] = (
    await db.execute(sql`
      SELECT
        count(*)::int                                          AS started,
        count(*) FILTER (WHERE first_mission_done)::int        AS first_mission_done,
        count(*) FILTER (WHERE half_missions_done)::int        AS half_missions_done,
        count(*) FILTER (WHERE completed)::int                 AS completed
      FROM v_funnel WHERE ${scope}
    `)
  ).rows as Array<Record<string, unknown>>;
  return {
    started: Number(row?.started ?? 0),
    firstMissionDone: Number(row?.first_mission_done ?? 0),
    halfMissionsDone: Number(row?.half_missions_done ?? 0),
    completed: Number(row?.completed ?? 0),
  };
}

export async function missionDropoff(
  orgId: string,
  filters: Filters,
  deps: { db?: Db; now?: Date } = {},
) {
  const db = deps.db ?? defaultDb;
  // The view is now one row per mission per filter dimension, so narrow first and sum after.
  const scope = sessionScope(orgId, filters, deps.now);
  const res = await db.execute(sql`
    SELECT mission_title, ordinal, sum(abandoned_sessions)::int AS abandoned_sessions
    FROM v_mission_dropoff WHERE ${scope}
    GROUP BY mission_title, ordinal
    ORDER BY abandoned_sessions DESC
    LIMIT 20
  `);
  return res.rows as Array<Record<string, unknown>>;
}

export async function languageVoice(
  orgId: string,
  filters: Filters,
  deps: { db?: Db; now?: Date } = {},
) {
  const db = deps.db ?? defaultDb;
  const scope = sessionScope(orgId, filters, deps.now);
  const res = await db.execute(sql`
    SELECT language, modality,
           sum(sessions)::int      AS sessions,
           sum(turns)::int         AS turns,
           sum(tts_failovers)::int AS tts_failovers,
           sum(tts_seconds)        AS tts_seconds
    FROM v_language_voice_usage WHERE ${scope}
    GROUP BY language, modality
    ORDER BY sessions DESC
  `);
  return res.rows as Array<Record<string, unknown>>;
}

/** The five concepts worth reviewing first: most hints and most first try failures. */
export async function contentHealth(
  orgId: string,
  filters: Filters,
  deps: { db?: Db; now?: Date } = {},
) {
  const db = deps.db ?? defaultDb;
  const scope = evidenceScope(orgId, filters, deps.now);
  // The view emits sums and counts at evidence grain, so the ratios are computed here, after
  // the filter has narrowed. Averaging the view's averages would have weighted every group
  // equally regardless of how much evidence each one holds.
  const res = await db.execute(sql`
    SELECT concept_key, concept_label,
           sum(evidence_count)::int                                          AS evidence_count,
           sum(hinted_count)::numeric / NULLIF(sum(evidence_count), 0)       AS hint_rate,
           sum(first_try_incorrect_count)::numeric
             / NULLIF(sum(evidence_count), 0)                                AS first_try_incorrect_rate,
           sum(score_sum) / NULLIF(sum(score_count), 0)                      AS mean_score,
           sum(latency_sum_ms) / NULLIF(sum(latency_count), 0)               AS mean_latency_ms,
           sum(misconception_hits)::int                                      AS misconception_hits,
           mode() WITHIN GROUP (ORDER BY top_misconception)                  AS top_misconception
    FROM v_content_health WHERE ${scope}
    GROUP BY concept_key, concept_label
    ORDER BY (
      sum(hinted_count)::numeric / NULLIF(sum(evidence_count), 0)
      + sum(first_try_incorrect_count)::numeric / NULLIF(sum(evidence_count), 0)
    ) DESC NULLS LAST
    LIMIT 5
  `);
  return res.rows as Array<Record<string, unknown>>;
}

export async function personas(
  orgId: string,
  filters: Filters,
  deps: { db?: Db; now?: Date } = {},
) {
  const db = deps.db ?? defaultDb;
  const scope = sessionScope(orgId, filters, deps.now);
  const res = await db.execute(sql`
    SELECT persona_id,
           count(*)::int                                            AS sessions,
           COALESCE(avg(CASE WHEN finished THEN 1.0 ELSE 0.0 END), 0) AS completion_rate,
           COALESCE(avg(turn_count), 0)                             AS mean_turns
    FROM v_session_facts WHERE ${scope}
    GROUP BY persona_id ORDER BY sessions DESC
  `);
  return res.rows as Array<Record<string, unknown>>;
}

export async function cost(orgId: string, filters: Filters, deps: { db?: Db; now?: Date } = {}) {
  const db = deps.db ?? defaultDb;
  const { from, to } = windowOf(filters, deps.now);
  const res = await db.execute(sql`
    SELECT day, cost_usd, input_tokens::int AS input_tokens,
           output_tokens::int AS output_tokens, calls::int AS calls
    FROM v_cost_daily
    WHERE org_id = ${orgId} AND day >= ${from.toISOString()} AND day <= ${to.toISOString()}
    ORDER BY day
  `);
  return res.rows as Array<Record<string, unknown>>;
}

export async function latency(orgId: string, filters: Filters, deps: { db?: Db; now?: Date } = {}) {
  const db = deps.db ?? defaultDb;
  const { from, to } = windowOf(filters, deps.now);
  const res = await db.execute(sql`
    SELECT task, day, calls::int AS calls, ttft_p50, ttft_p95,
           latency_p50, latency_p95, errors::int AS errors
    FROM v_latency
    WHERE org_id = ${orgId} AND day >= ${from.toISOString()} AND day <= ${to.toISOString()}
    ORDER BY day, task
  `);
  return res.rows as Array<Record<string, unknown>>;
}

/** Dispatches one widget by name. Unknown names are rejected by the caller's Zod enum. */
export async function runWidget(
  widget: WidgetName,
  orgId: string,
  filters: Filters,
  deps: { db?: Db; now?: Date } = {},
): Promise<unknown> {
  switch (widget) {
    case "summary": {
      const k = await kpis(orgId, filters, deps);
      // The period has to come from the filters the KPIs were measured over. Defaulting to 14
      // meant selecting "Last 30 days" rendered 30 day numbers under "In the last 14 days".
      const { from, to } = windowOf(filters, deps.now);
      const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
      return { sentence: summarySentence(k, days), kpis: k };
    }
    case "kpis":
      return kpis(orgId, filters, deps);
    case "masteryMatrix":
      return masteryMatrix(orgId, filters, deps);
    case "funnel":
      return funnel(orgId, filters, deps);
    case "missionDropoff":
      return missionDropoff(orgId, filters, deps);
    case "languageVoice":
      return languageVoice(orgId, filters, deps);
    case "contentHealth":
      return contentHealth(orgId, filters, deps);
    case "personas":
      return personas(orgId, filters, deps);
    case "cost":
      return cost(orgId, filters, deps);
    case "latency":
      return latency(orgId, filters, deps);
  }
}
