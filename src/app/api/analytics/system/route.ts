import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withHandler } from "@/server/http/handler";
import { db } from "@/server/db/client";
import { getOrgConfig } from "@/server/config/service";
import { breakerSnapshot } from "@/server/llm/breaker";

/**
 * The admin system view.
 *
 * Model identifiers are withheld unless ui.showModelIdentifiers is on: the admin sees tiers,
 * not which vendor is behind them.
 */
export const GET = withHandler(
  { auth: "session", roles: ["admin"], rateLimit: "analytics" },
  async (_req, ctx) => {
    const session = ctx.session!;
    const { config, version } = await getOrgConfig(session.orgId);
    const showModels = config.ui.showModelIdentifiers;
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();

    const [usage, latency, cost, cache, media, spend, perHour] = await Promise.all([
      db.execute(sql`
        SELECT
          (SELECT count(*) FROM learning_sessions WHERE org_id = ${session.orgId}
             AND started_at >= ${since})::int                                   AS sessions,
          (SELECT count(*) FROM turns t JOIN learning_sessions s ON s.id = t.session_id
             WHERE s.org_id = ${session.orgId} AND t.created_at >= ${since})::int AS turns,
          (SELECT count(*) FROM ingest_jobs WHERE org_id = ${session.orgId}
             AND created_at >= ${since})::int                                   AS ingests
      `),
      db.execute(sql`
        SELECT task, tier,
               count(*)::int                                                       AS calls,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft_ms)                AS ttft_p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft_ms)               AS ttft_p95,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)             AS latency_p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)            AS latency_p95,
               count(*) FILTER (WHERE status <> 'ok')::int                         AS errors,
               count(*) FILTER (WHERE fallback IS TRUE)::int                       AS fallbacks
        FROM llm_calls
        WHERE org_id = ${session.orgId} AND created_at >= ${since}
        GROUP BY task, tier ORDER BY calls DESC
      `),
      db.execute(sql`
        SELECT day, cost_usd, calls::int AS calls
        FROM v_cost_daily WHERE org_id = ${session.orgId} AND day >= ${since}
        ORDER BY day
      `),
      db.execute(sql`
        SELECT
          COALESCE(sum(cache_read_tokens), 0)::bigint   AS cache_read,
          COALESCE(sum(cache_write_tokens), 0)::bigint  AS cache_write,
          COALESCE(sum(input_tokens), 0)::bigint        AS input_tokens
        FROM llm_calls WHERE org_id = ${session.orgId} AND created_at >= ${since}
      `),
      db.execute(sql`
        SELECT provider,
               count(*)::int                                  AS calls,
               count(*) FILTER (WHERE failover IS TRUE)::int   AS failovers,
               COALESCE(sum(seconds), 0)                       AS seconds
        FROM media_usage WHERE org_id = ${session.orgId} AND created_at >= ${since}
        GROUP BY provider
      `),
      db.execute(sql`
        SELECT day, spend_usd, tokens_in::bigint AS tokens_in, tokens_out::bigint AS tokens_out
        FROM spend_daily WHERE org_id = ${session.orgId} ORDER BY day DESC LIMIT 14
      `),
      // Cost per learner-hour, the figure that says whether this is affordable per head rather
      // than per day. Learner time is the span of a session, so a session with one
      // turn counts the minute it took, not a whole hour.
      db.execute(sql`
        SELECT
          COALESCE(sum(s.cost_usd::numeric), 0)                                        AS cost_usd,
          COALESCE(sum(EXTRACT(EPOCH FROM (t.last_turn_at - s.started_at))), 0) / 3600 AS learner_hours
        FROM learning_sessions s
        LEFT JOIN (
          SELECT org_id, session_id, max(created_at) AS last_turn_at
          FROM turns GROUP BY org_id, session_id
        ) t ON t.session_id = s.id AND t.org_id = s.org_id
        WHERE s.org_id = ${session.orgId} AND s.started_at >= ${since} AND t.last_turn_at IS NOT NULL
      `),
    ]);

    const c = cache.rows[0] as Record<string, unknown> | undefined;
    const read = Number(c?.cache_read ?? 0);
    const write = Number(c?.cache_write ?? 0);
    const input = Number(c?.input_tokens ?? 0);
    const denom = read + write + input;

    // Latency rows carry the tier, which is the label the UI shows; the model id is dropped
    // here rather than in the client, so it never crosses the wire by default.
    const latencyRows = (latency.rows as Array<Record<string, unknown>>).map((r) =>
      showModels ? r : { ...r, model: undefined },
    );

    const today = (spend.rows[0] as Record<string, unknown> | undefined) ?? {};

    return NextResponse.json({
      configVersion: version,
      showModelIdentifiers: showModels,
      usage: usage.rows[0] ?? { sessions: 0, turns: 0, ingests: 0 },
      latency: latencyRows,
      cost: cost.rows,
      costPerLearnerHour: (() => {
        const r = perHour.rows[0] as Record<string, unknown> | undefined;
        const hours = Number(r?.learner_hours ?? 0);
        return hours > 0 ? Number(r?.cost_usd ?? 0) / hours : null;
      })(),
      cacheHitRate: denom > 0 ? read / denom : 0,
      media: media.rows,
      spend: {
        today: Number(today.spend_usd ?? 0),
        capUsd: config.limits.dailySpendCapUsd,
        degradeAtPercent: config.limits.degradeAtPercent,
      },
      // Per route, so an admin can see which provider is being skipped. An empty
      // list means nothing has failed on this instance yet, not that all is proven
      // well: breaker state is per instance.
      breaker: { routes: breakerSnapshot(config.llm.breaker) },
    });
  },
);
