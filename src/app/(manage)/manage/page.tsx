"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_FILTERS,
  Filters,
  filtersFromParams,
  filtersToQuery,
  filtersToUrl,
  type DashboardFilters,
} from "@/client/components/dashboard/Filters";
import {
  Funnel,
  KpiRow,
  MasteryHeatmap,
  SimpleTable,
  SummarySentence,
  num2,
  pct,
  type FunnelData,
  type Kpis,
  type MasteryCell,
} from "@/client/components/dashboard/Widgets";

interface WidgetState {
  summary?: { sentence: string; kpis: Kpis };
  masteryMatrix?: MasteryCell[];
  funnel?: FunnelData;
  missionDropoff?: Array<Record<string, unknown>>;
  languageVoice?: Array<Record<string, unknown>>;
  contentHealth?: Array<Record<string, unknown>>;
  personas?: Array<Record<string, unknown>>;
}

const WIDGETS = [
  "summary",
  "masteryMatrix",
  "funnel",
  "missionDropoff",
  "languageVoice",
  "contentHealth",
  "personas",
] as const;

/**
 * The L&D manager dashboard.
 *
 * Every widget reads the same filters, and the filters live in the URL, so a view can be
 * shared or reloaded and shows the same thing. Nothing here is written by a model: the summary
 * sentence is assembled by the server from the same numbers the KPI row shows.
 */
export default function ManageDashboard(): React.JSX.Element {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<WidgetState>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Filters come from the URL on first paint, so a shared link opens the same view.
  // Deferred a tick so no state is set synchronously during the effect.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(filtersFromParams(new URLSearchParams(window.location.search)));
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const query = useMemo(() => filtersToQuery(filters), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        WIDGETS.map(async (w) => {
          const res = await fetch(`/api/analytics/${w}?${query}`);
          if (!res.ok) throw new Error(`The ${w} panel could not be loaded.`);
          const body = (await res.json()) as { data: unknown };
          return [w, body.data] as const;
        }),
      );
      setData(Object.fromEntries(results) as WidgetState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, load]);

  const onFilterChange = useCallback((next: DashboardFilters) => {
    setFilters(next);
    // Keep the address bar in step, so refresh and share both work.
    window.history.replaceState(null, "", `${window.location.pathname}${filtersToUrl(next)}`);
  }, []);

  const departments = useMemo(
    () => ["Branch Operations", "Customer Care", "Compliance", "Digital"],
    [],
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8" data-testid="manager-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-ink text-xl font-bold tracking-tight">Team progress</h1>
        <Link href="/manage/report" className="text-neem text-xs font-semibold underline">
          Printable report
        </Link>
      </div>

      <div className="mt-4">
        <Filters value={filters} departments={departments} onChange={onFilterChange} />
      </div>

      {error && (
        <p role="alert" className="text-kattha mt-4 text-sm">
          {error}
        </p>
      )}

      <div aria-live="polite" className="sr-only" data-testid="dashboard-status">
        {loading ? "Loading dashboard" : "Dashboard updated"}
      </div>

      {data.summary && (
        <div className="mt-4">
          <SummarySentence
            sentence={data.summary.sentence}
            includesSeeded={filters.includeSeeded}
          />
        </div>
      )}

      {data.summary && (
        <div className="mt-4">
          <KpiRow kpis={data.summary.kpis} />
        </div>
      )}

      <section aria-label="Estimated mastery by learner and topic" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Estimated mastery</h2>
        <p className="text-ink/70 mt-1 text-xs">
          Bands are estimates from the answers learners gave, shown by pseudonym. Hover a cell for
          the range and how many answers it is based on.
        </p>
        <div className="mt-3">
          <MasteryHeatmap cells={data.masteryMatrix ?? []} />
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-label="Journey funnel">
          <h2 className="text-ink text-sm font-semibold">Journey funnel</h2>
          <div className="mt-3">{data.funnel && <Funnel data={data.funnel} />}</div>
        </section>

        <section aria-label="Where journeys stop">
          <h2 className="text-ink text-sm font-semibold">Where journeys stop</h2>
          <div className="mt-3">
            <SimpleTable
              testId="dropoff-table"
              caption="Missions where unfinished sessions were last active"
              columns={[
                { key: "mission_title", label: "Mission" },
                { key: "abandoned_sessions", label: "Unfinished sessions" },
              ]}
              rows={data.missionDropoff ?? []}
            />
          </div>
        </section>

        <section aria-label="Language and voice">
          <h2 className="text-ink text-sm font-semibold">Language and voice</h2>
          <div className="mt-3">
            <SimpleTable
              testId="language-table"
              caption="Sessions and turns by language and modality, with speech failovers"
              columns={[
                { key: "language", label: "Language" },
                { key: "modality", label: "Modality" },
                { key: "sessions", label: "Sessions" },
                { key: "turns", label: "Turns" },
                { key: "tts_failovers", label: "Speech failovers" },
              ]}
              rows={data.languageVoice ?? []}
            />
          </div>
        </section>

        <section aria-label="Outcomes by persona">
          <h2 className="text-ink text-sm font-semibold">Outcomes by persona</h2>
          <div className="mt-3">
            <SimpleTable
              testId="personas-table"
              caption="Sessions and completion rate for each persona"
              columns={[
                { key: "persona_id", label: "Persona" },
                { key: "sessions", label: "Sessions" },
                { key: "completion_rate", label: "Completion", format: pct },
                { key: "mean_turns", label: "Mean turns", format: num2 },
              ]}
              rows={data.personas ?? []}
            />
          </div>
        </section>
      </div>

      <section aria-label="Content health" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Review these topics first</h2>
        <p className="text-ink/70 mt-1 text-xs">
          Ranked by how often learners needed a hint or got it wrong first time.
        </p>
        <div className="mt-3">
          <SimpleTable
            testId="content-health-table"
            caption="Concepts ranked by hint rate and first try failures"
            columns={[
              { key: "concept_label", label: "Topic" },
              { key: "hint_rate", label: "Needed a hint", format: pct },
              { key: "first_try_incorrect_rate", label: "Wrong first time", format: pct },
              { key: "mean_score", label: "Mean score", format: num2 },
              { key: "evidence_count", label: "Answers" },
            ]}
            rows={data.contentHealth ?? []}
          />
        </div>
      </section>
    </main>
  );
}
