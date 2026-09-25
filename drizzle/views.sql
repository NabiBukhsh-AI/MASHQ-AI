-- Analytics views, read by the manager dashboard widgets.
-- Plain views, not materialized: promote one only if its p95 exceeds 300 ms on the seeded
-- dataset. Every view carries org_id and is_seeded so the query layer can scope by org and
-- let the caller include or exclude demo rows.

DROP VIEW IF EXISTS v_cache_efficiency CASCADE;
DROP VIEW IF EXISTS v_cost_daily CASCADE;
DROP VIEW IF EXISTS v_latency CASCADE;
DROP VIEW IF EXISTS v_language_voice_usage CASCADE;
DROP VIEW IF EXISTS v_content_health CASCADE;
DROP VIEW IF EXISTS v_mission_dropoff CASCADE;
DROP VIEW IF EXISTS v_funnel CASCADE;
DROP VIEW IF EXISTS v_mastery_gain CASCADE;
DROP VIEW IF EXISTS v_mastery_matrix CASCADE;
DROP VIEW IF EXISTS v_evidence_dims CASCADE;
DROP VIEW IF EXISTS v_session_facts CASCADE;

-- One row per session: the grain every session level widget filters on.
CREATE VIEW v_session_facts AS
SELECT
  s.id            AS session_id,
  s.org_id,
  s.user_id,
  u.department,
  u.cohort,
  u.pseudonym,
  s.journey_id,
  j.content_id,
  s.persona_id,
  s.language,
  s.modality,
  s.status,
  s.started_at,
  s.is_seeded,
  s.cost_usd,
  s.tokens_used,
  (s.state ->> 'finished')::boolean                       AS finished,
  COALESCE(jsonb_array_length(s.state -> 'completed'), 0) AS missions_completed,
  COALESCE(t.turn_count, 0)                               AS turn_count,
  COALESCE(e.evidence_count, 0)                           AS evidence_count,
  t.last_turn_at
FROM learning_sessions s
JOIN "user" u ON u.id = s.user_id
LEFT JOIN journeys j ON j.id = s.journey_id
-- Grouped once rather than a correlated subquery per row: at 311 sessions the correlated
-- form measured 341 ms, over the 300 ms budget.
-- org_id is in the grouping key and the join so that a caller's WHERE org_id = $1 reaches
-- inside the aggregate. Without it every org's turns are counted before one org is selected,
-- which costs nothing at one tenant and everything at a hundred.
LEFT JOIN (
  SELECT org_id, session_id, count(*) AS turn_count, max(created_at) AS last_turn_at
  FROM turns GROUP BY org_id, session_id
) t ON t.session_id = s.id AND t.org_id = s.org_id
LEFT JOIN (
  SELECT org_id, session_id, count(*) AS evidence_count
  FROM evidence_events GROUP BY org_id, session_id
) e ON e.session_id = s.id AND e.org_id = s.org_id;

-- The dimensions a manager filters on live on the session, not on the mastery row. Mastery is
-- a stored snapshot that cannot be recomputed under a filter, so the filter decides which
-- (learner, concept) pairs are shown: the ones whose evidence came from sessions that match.
-- Aggregated to arrays so one row per pair survives, and tested with the && overlap operator.
CREATE VIEW v_evidence_dims AS
SELECT
  e.org_id,
  e.user_id,
  e.concept_id,
  array_agg(DISTINCT s.language)   FILTER (WHERE s.language IS NOT NULL)   AS languages,
  array_agg(DISTINCT s.modality)   FILTER (WHERE s.modality IS NOT NULL)   AS modalities,
  array_agg(DISTINCT s.persona_id) FILTER (WHERE s.persona_id IS NOT NULL) AS persona_ids,
  min(e.created_at) AS first_evidence_at,
  max(e.created_at) AS last_evidence_at
FROM evidence_events e
LEFT JOIN learning_sessions s ON s.id = e.session_id AND s.org_id = e.org_id
GROUP BY e.org_id, e.user_id, e.concept_id;

-- Learner by concept, the heatmap grain. Pseudonym only: a manager never needs the name.
CREATE VIEW v_mastery_matrix AS
SELECT
  m.org_id,
  m.user_id,
  u.pseudonym,
  u.department,
  u.cohort,
  m.concept_id,
  c.key          AS concept_key,
  c.name         AS concept_label,
  c.content_id,
  m.p,
  m.band,
  m.lower,
  m.upper,
  m.n_events,
  m.last_evidence_at,
  d.languages,
  d.modalities,
  d.persona_ids,
  d.first_evidence_at,
  u.is_seeded
FROM mastery_states m
JOIN "user" u ON u.id = m.user_id
JOIN concepts c ON c.id = m.concept_id
LEFT JOIN v_evidence_dims d
  ON d.org_id = m.org_id AND d.user_id = m.user_id AND d.concept_id = m.concept_id;

-- Mastery gain per learner and concept: last p minus first p, from the evidence log itself,
-- so the number is reproducible rather than a stored guess.
CREATE VIEW v_mastery_gain AS
SELECT
  e.org_id,
  e.user_id,
  e.concept_id,
  u.department,
  u.cohort,
  count(*)                                                       AS event_count,
  -- Named to match v_mastery_matrix, so one learnerScope fragment fits both views.
  min(e.created_at)                                              AS first_evidence_at,
  max(e.created_at)                                              AS last_evidence_at,
  (array_agg(e.p_before ORDER BY e.created_at ASC))[1]           AS p_first,
  (array_agg(e.p_after ORDER BY e.created_at DESC))[1]           AS p_last,
  (array_agg(e.p_after ORDER BY e.created_at DESC))[1]
    - (array_agg(e.p_before ORDER BY e.created_at ASC))[1]       AS gain,
  -- Same dimensions as the matrix, for the same reason: gain is first-to-last over the whole
  -- log, so a filter selects which pairs are counted rather than recomputing the arithmetic.
  array_agg(DISTINCT s.language)   FILTER (WHERE s.language IS NOT NULL)   AS languages,
  array_agg(DISTINCT s.modality)   FILTER (WHERE s.modality IS NOT NULL)   AS modalities,
  array_agg(DISTINCT s.persona_id) FILTER (WHERE s.persona_id IS NOT NULL) AS persona_ids,
  array_agg(DISTINCT c.content_id)                                         AS content_ids,
  u.is_seeded
FROM evidence_events e
JOIN "user" u ON u.id = e.user_id
JOIN concepts c ON c.id = e.concept_id
LEFT JOIN learning_sessions s ON s.id = e.session_id AND s.org_id = e.org_id
GROUP BY e.org_id, e.user_id, e.concept_id, u.department, u.cohort, u.is_seeded;

-- Engagement funnel, one row per session with the stage it reached.
CREATE VIEW v_funnel AS
SELECT
  f.org_id,
  f.session_id,
  f.user_id,
  f.department,
  f.cohort,
  f.language,
  f.modality,
  f.started_at,
  f.is_seeded,
  TRUE                                              AS started,
  (f.missions_completed >= 1)                       AS first_mission_done,
  (f.missions_completed >= 2)                       AS half_missions_done,
  (f.finished IS TRUE)                              AS completed
FROM v_session_facts f;

-- Where abandoned journeys stopped: the last mission an unfinished session was on.
-- Every dimension a manager can filter on is in the grouping key, so the caller narrows first
-- and sums after. Grouping only by mission meant "filter to Urdu" left this widget showing
-- every language, with nothing on screen saying so.
CREATE VIEW v_mission_dropoff AS
SELECT
  s.org_id,
  s.current_mission_id                AS mission_id,
  mi.title                            AS mission_title,
  mi.ordinal,
  s.language,
  s.modality,
  s.persona_id,
  j.content_id,
  s.started_at,
  count(*)                            AS abandoned_sessions,
  s.is_seeded
FROM learning_sessions s
LEFT JOIN missions mi ON mi.id = s.current_mission_id
LEFT JOIN journeys j ON j.id = s.journey_id
WHERE COALESCE((s.state ->> 'finished')::boolean, FALSE) = FALSE
GROUP BY s.org_id, s.current_mission_id, mi.title, mi.ordinal, s.language, s.modality,
         s.persona_id, j.content_id, s.started_at, s.is_seeded;

-- Per concept teaching quality: hint rate, first try failure, attempts, misconceptions.
-- Sums and counts rather than averages, at a grain that carries every filter dimension. An
-- average of averages is not an average, so the ratios are computed by the caller after it has
-- narrowed and re-summed. Grouping only by concept left this widget ignoring most filters.
CREATE VIEW v_content_health AS
SELECT
  e.org_id,
  e.concept_id,
  c.key              AS concept_key,
  c.name             AS concept_label,
  c.content_id,
  s.language,
  s.modality,
  s.persona_id,
  u.department,
  u.cohort,
  e.created_at,
  count(*)                                                                AS evidence_count,
  count(*) FILTER (WHERE e.hint_level > 0)                                AS hinted_count,
  count(*) FILTER (WHERE e.verdict = 'incorrect' AND e.hint_level = 0)    AS first_try_incorrect_count,
  sum(e.score)                                                            AS score_sum,
  count(e.score)                                                          AS score_count,
  sum(e.latency_ms)                                                       AS latency_sum_ms,
  count(e.latency_ms)                                                     AS latency_count,
  count(*) FILTER (WHERE e.misconception_id IS NOT NULL)                  AS misconception_hits,
  mode() WITHIN GROUP (ORDER BY e.misconception_id)                       AS top_misconception,
  u.is_seeded
FROM evidence_events e
JOIN concepts c ON c.id = e.concept_id
JOIN "user" u ON u.id = e.user_id
LEFT JOIN learning_sessions s ON s.id = e.session_id AND s.org_id = e.org_id
GROUP BY e.org_id, e.concept_id, c.key, c.name, c.content_id, s.language, s.modality,
         s.persona_id, u.department, u.cohort, e.created_at, u.is_seeded;

-- Share of turns by language and modality, plus TTS failovers from media_usage.
CREATE VIEW v_language_voice_usage AS
SELECT
  s.org_id,
  s.language,
  s.modality,
  s.persona_id,
  j.content_id,
  s.started_at,
  s.is_seeded,
  count(*)                          AS sessions,
  COALESCE(sum(t.turn_count), 0)    AS turns,
  COALESCE(sum(m.failovers), 0)     AS tts_failovers,
  COALESCE(sum(m.seconds), 0)       AS tts_seconds
FROM learning_sessions s
-- org_id in the grouping key and the join, for the same reason as v_session_facts.
LEFT JOIN (
  SELECT org_id, session_id, count(*) AS turn_count FROM turns GROUP BY org_id, session_id
) t ON t.session_id = s.id AND t.org_id = s.org_id
LEFT JOIN (
  SELECT org_id, session_id,
         count(*) FILTER (WHERE failover IS TRUE) AS failovers,
         COALESCE(sum(seconds) FILTER (WHERE kind = 'tts'), 0) AS seconds
  FROM media_usage GROUP BY org_id, session_id
) m ON m.session_id = s.id AND m.org_id = s.org_id
LEFT JOIN journeys j ON j.id = s.journey_id
GROUP BY s.org_id, s.language, s.modality, s.persona_id, j.content_id, s.started_at,
         s.is_seeded;

-- Latency by task, for the admin system view.
CREATE VIEW v_latency AS
SELECT
  l.org_id,
  l.task,
  date_trunc('day', l.created_at)                                          AS day,
  count(*)                                                                 AS calls,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY l.ttft_ms)                   AS ttft_p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY l.ttft_ms)                  AS ttft_p95,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY l.latency_ms)                AS latency_p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY l.latency_ms)               AS latency_p95,
  count(*) FILTER (WHERE l.status <> 'ok')                                 AS errors
FROM llm_calls l
GROUP BY l.org_id, l.task, date_trunc('day', l.created_at);

CREATE VIEW v_cost_daily AS
SELECT
  l.org_id,
  date_trunc('day', l.created_at)          AS day,
  sum(l.cost_usd)                          AS cost_usd,
  sum(l.input_tokens)                      AS input_tokens,
  sum(l.output_tokens)                     AS output_tokens,
  count(*)                                 AS calls
FROM llm_calls l
GROUP BY l.org_id, date_trunc('day', l.created_at);

-- cache_read / (input + cache_read + cache_write), the number the admin system view shows.
CREATE VIEW v_cache_efficiency AS
SELECT
  l.org_id,
  l.task,
  date_trunc('day', l.created_at)                    AS day,
  sum(l.cache_read_tokens)                           AS cache_read,
  sum(l.cache_write_tokens)                          AS cache_write,
  sum(l.input_tokens)                                AS input_tokens,
  CASE
    WHEN sum(l.input_tokens + l.cache_read_tokens + l.cache_write_tokens) > 0
    THEN sum(l.cache_read_tokens)::float
       / sum(l.input_tokens + l.cache_read_tokens + l.cache_write_tokens)
    ELSE 0
  END                                                AS cache_hit_rate
FROM llm_calls l
GROUP BY l.org_id, l.task, date_trunc('day', l.created_at);
