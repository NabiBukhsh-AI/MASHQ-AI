"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import "@/app/print.css";
import {
  DEFAULT_FILTERS,
  filtersFromParams,
  filtersToQuery,
  type DashboardFilters,
} from "@/client/components/dashboard/Filters";
import { SimpleTable, num2, pct } from "@/client/components/dashboard/Widgets";

interface Kpis {
  activeLearners: number;
  sessions: number;
  turns: number;
  completionRate: number;
  meanMasteryGain: number;
  conceptsPractised: number;
  costUsd: number;
}

interface ReportData {
  summary?: { sentence: string; kpis: Kpis };
  funnel?: {
    started: number;
    firstMissionDone: number;
    halfMissionsDone: number;
    completed: number;
  };
  contentHealth?: Array<Record<string, unknown>>;
  languageVoice?: Array<Record<string, unknown>>;
  personas?: Array<Record<string, unknown>>;
}

const WIDGETS = ["summary", "funnel", "contentHealth", "languageVoice", "personas"] as const;

/**
 * Content Effectiveness and Learner Progress.
 *
 * Printed by the browser, so there is no PDF engine to keep alive. The methodology and data
 * notes are part of the document rather than a footnote: a report that shows estimated mastery
 * without saying how it was estimated invites the reader to treat it as a test score.
 */
export default function ManagerReport(): React.JSX.Element {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<ReportData>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(filtersFromParams(new URLSearchParams(window.location.search)));
      setGeneratedAt(new Date().toISOString().slice(0, 16).replace("T", " "));
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const query = useMemo(() => filtersToQuery(filters), [filters]);

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        WIDGETS.map(async (w) => {
          const res = await fetch(`/api/analytics/${w}?${query}`);
          if (!res.ok) throw new Error("The report could not be built.");
          const body = (await res.json()) as { data: unknown };
          return [w, body.data] as const;
        }),
      );
      setData(Object.fromEntries(results) as ReportData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be built.");
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

  const print = useCallback(() => {
    // Logged as a print export, so the audit shows a report left the building.
    void fetch(`/api/export/summary?${query}`, { method: "GET" }).catch(() => undefined);
    window.print();
  }, [query]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8" data-testid="manager-report">
      <div className="no-print mb-6 flex items-center justify-between">
        <p className="text-ink/70 text-xs">
          Print this page or save it as PDF from the browser print dialog.
        </p>
        <button
          type="button"
          onClick={print}
          data-testid="report-print-btn"
          className="bg-neem rounded-lg px-4 py-2 text-sm font-semibold text-white"
        >
          Print or save as PDF
        </button>
      </div>

      {error && (
        <p role="alert" className="text-kattha text-sm">
          {error}
        </p>
      )}

      <h1 className="text-lg font-bold">Content Effectiveness and Learner Progress</h1>

      <section className="report-section mt-4" data-testid="report-scope">
        <h2 className="text-sm font-semibold">Scope and filters</h2>
        <table>
          <caption className="sr-only">The filters this report was generated under</caption>
          <tbody>
            <tr>
              <th scope="row">Period</th>
              <td>Last {filters.days} days</td>
            </tr>
            <tr>
              <th scope="row">Languages</th>
              <td>{filters.languages.length ? filters.languages.join(", ") : "All"}</td>
            </tr>
            <tr>
              <th scope="row">Modalities</th>
              <td>{filters.modalities.length ? filters.modalities.join(", ") : "All"}</td>
            </tr>
            <tr>
              <th scope="row">Departments</th>
              <td>{filters.departments.length ? filters.departments.join(", ") : "All"}</td>
            </tr>
            <tr>
              <th scope="row">Generated</th>
              <td>{generatedAt}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {data.summary && (
        <section className="report-section" data-testid="report-summary">
          <h2 className="text-sm font-semibold">Summary</h2>
          <p className="text-sm">{data.summary.sentence}</p>
          <table className="mt-2">
            <caption className="sr-only">Key numbers for the period</caption>
            <tbody>
              <tr>
                <th scope="row">Active learners</th>
                <td>{data.summary.kpis.activeLearners}</td>
              </tr>
              <tr>
                <th scope="row">Sessions</th>
                <td>{data.summary.kpis.sessions}</td>
              </tr>
              <tr>
                <th scope="row">Completion rate</th>
                <td>{Math.round(data.summary.kpis.completionRate * 100)}%</td>
              </tr>
              <tr>
                <th scope="row">Mean estimated mastery gain</th>
                <td>{data.summary.kpis.meanMasteryGain.toFixed(2)}</td>
              </tr>
              <tr>
                <th scope="row">Topics practised</th>
                <td>{data.summary.kpis.conceptsPractised}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section className="report-section" data-testid="report-content-health">
        <h2 className="text-sm font-semibold">Topics to review first</h2>
        <SimpleTable
          testId="report-content-health-table"
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
      </section>

      {data.funnel && (
        <section className="report-section" data-testid="report-funnel">
          <h2 className="text-sm font-semibold">Engagement funnel</h2>
          <table>
            <caption className="sr-only">Sessions reaching each stage</caption>
            <tbody>
              <tr>
                <th scope="row">Started</th>
                <td>{data.funnel.started}</td>
              </tr>
              <tr>
                <th scope="row">First mission done</th>
                <td>{data.funnel.firstMissionDone}</td>
              </tr>
              <tr>
                <th scope="row">Half the missions done</th>
                <td>{data.funnel.halfMissionsDone}</td>
              </tr>
              <tr>
                <th scope="row">Completed</th>
                <td>{data.funnel.completed}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section className="report-section" data-testid="report-language">
        <h2 className="text-sm font-semibold">Language and modality mix</h2>
        <SimpleTable
          testId="report-language-table"
          caption="Sessions and turns by language and modality"
          columns={[
            { key: "language", label: "Language" },
            { key: "modality", label: "Modality" },
            { key: "sessions", label: "Sessions" },
            { key: "turns", label: "Turns" },
            { key: "tts_failovers", label: "Speech failovers" },
          ]}
          rows={data.languageVoice ?? []}
        />
      </section>

      <section className="report-section" data-testid="report-personas">
        <h2 className="text-sm font-semibold">Outcomes by persona</h2>
        <SimpleTable
          testId="report-personas-table"
          caption="Sessions and completion rate for each persona"
          columns={[
            { key: "persona_id", label: "Persona" },
            { key: "sessions", label: "Sessions" },
            { key: "completion_rate", label: "Completion", format: pct },
          ]}
          rows={data.personas ?? []}
        />
      </section>

      <section className="report-section" data-testid="report-methodology">
        <h2 className="text-sm font-semibold">Methodology</h2>
        <p className="text-xs">
          Mastery here is an estimate built from interaction evidence, not a test score. Each answer
          updates a probability for the concept it exercises, weighted by the kind of question and
          reduced when a hint was used. Bands are: not yet, developing, proficient and mastered. The
          range shown beside an estimate widens when there is little evidence and narrows as more
          answers arrive, so a single answer never reads as certainty.
        </p>
      </section>

      <section className="report-section" data-testid="report-data-notes">
        <h2 className="text-sm font-semibold">Data notes</h2>
        <p className="text-xs">
          {filters.includeSeeded
            ? "This report includes seeded demonstration data, generated for this build by running the real scoring functions over scripted answers. It is not a record of real staff activity."
            : "This report excludes seeded demonstration data and covers real recorded activity only."}
        </p>
        <p className="mt-1 text-xs">
          Learners appear by pseudonym. The sample training material used in this build was written
          for the demonstration and is not bank policy.
        </p>
      </section>
    </main>
  );
}
