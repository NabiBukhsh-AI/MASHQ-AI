"use client";

import React from "react";
import { BidiText } from "../BidiText";

/**
 * Manager dashboard widgets.
 *
 * Every number here is read only and comes from the analytics routes. The heatmap is a real
 * table rather than a canvas, because a manager on a screen reader has to be able to find the
 * weak concept just as fast as a sighted one.
 */

export interface Kpis {
  activeLearners: number;
  sessions: number;
  turns: number;
  completionRate: number;
  meanMasteryGain: number;
  conceptsPractised: number;
  costUsd: number;
}

export function SummarySentence({
  sentence,
  includesSeeded,
}: {
  sentence: string;
  includesSeeded: boolean;
}): React.JSX.Element {
  return (
    <section
      aria-label="Summary"
      data-testid="summary-sentence"
      className="border-mist rounded-lg border bg-white p-4"
    >
      <p className="text-ink text-sm">{sentence}</p>
      {includesSeeded && (
        // A viewer must never mistake demo rows for real use.
        <p
          data-testid="seeded-badge"
          className="bg-kattha/10 text-kattha mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
        >
          Includes seeded demo data
        </p>
      )}
    </section>
  );
}

export function KpiRow({ kpis }: { kpis: Kpis }): React.JSX.Element {
  const items = [
    { label: "Active learners", value: String(kpis.activeLearners), id: "kpi-learners" },
    { label: "Sessions", value: String(kpis.sessions), id: "kpi-sessions" },
    {
      label: "Completion",
      value: `${Math.round(kpis.completionRate * 100)}%`,
      id: "kpi-completion",
    },
    {
      label: "Estimated mastery gain",
      value: kpis.meanMasteryGain.toFixed(2),
      id: "kpi-gain",
    },
  ];
  return (
    <dl
      aria-label="Key numbers"
      data-testid="kpi-row"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {items.map((i) => (
        <div key={i.id} className="border-mist rounded-lg border bg-white p-3">
          <dt className="text-ink/70 text-xs">{i.label}</dt>
          <dd data-testid={i.id} className="text-ink text-lg font-semibold">
            {i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface MasteryCell {
  pseudonym: string;
  concept_key: string;
  concept_label: string;
  p: number;
  band: string;
  lower: number;
  upper: number;
  n_events: number;
}

const BAND_CLASS: Record<string, string> = {
  not_yet: "bg-kattha/15",
  developing: "bg-amber-100",
  proficient: "bg-neem/20",
  mastered: "bg-neem/40",
};

/**
 * The heatmap, as a table. Each cell states its band in text as well as colour, so it does not
 * rely on colour alone, and the estimate range lives in the cell title.
 */
export function MasteryHeatmap({ cells }: { cells: MasteryCell[] }): React.JSX.Element {
  const learners = Array.from(new Set(cells.map((c) => c.pseudonym))).slice(0, 40);
  const conceptKeys = Array.from(new Set(cells.map((c) => c.concept_key)));
  const labelFor = new Map(cells.map((c) => [c.concept_key, c.concept_label]));
  const byKey = new Map(cells.map((c) => [`${c.pseudonym}|${c.concept_key}`, c]));

  if (cells.length === 0) {
    return (
      <p className="text-ink/70 text-xs" data-testid="heatmap-empty">
        No mastery recorded for these filters yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" data-testid="mastery-heatmap">
        <caption className="sr-only">
          Estimated mastery band for each learner and topic. Learners are shown by pseudonym.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="py-2 pr-3">
              Learner
            </th>
            {conceptKeys.map((k) => (
              <th key={k} scope="col" className="py-2 pr-3">
                <BidiText text={labelFor.get(k) ?? k} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {learners.map((p) => (
            <tr key={p} className="border-mist border-t">
              <th scope="row" className="py-2 pr-3 font-normal">
                {p}
              </th>
              {conceptKeys.map((k) => {
                const cell = byKey.get(`${p}|${k}`);
                return (
                  <td
                    key={k}
                    className={`py-2 pr-3 ${cell ? (BAND_CLASS[cell.band] ?? "") : ""}`}
                    title={
                      cell
                        ? `estimated ${cell.p.toFixed(2)} (${cell.lower.toFixed(2)} to ${cell.upper.toFixed(2)}), ${cell.n_events} answers`
                        : "no evidence"
                    }
                  >
                    {/* Text, not just colour: colour alone fails WCAG 1.4.1. */}
                    {cell ? cell.band.replace("_", " ") : "-"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface FunnelData {
  started: number;
  firstMissionDone: number;
  halfMissionsDone: number;
  completed: number;
}

export function Funnel({ data }: { data: FunnelData }): React.JSX.Element {
  const steps = [
    { label: "Started", value: data.started },
    { label: "First mission done", value: data.firstMissionDone },
    { label: "Half the missions done", value: data.halfMissionsDone },
    { label: "Completed", value: data.completed },
  ];
  const max = Math.max(1, data.started);
  return (
    <table className="w-full text-left text-xs" data-testid="funnel">
      <caption className="sr-only">Sessions reaching each stage of the journey</caption>
      <thead>
        <tr className="text-ink/70">
          <th scope="col" className="py-1">
            Stage
          </th>
          <th scope="col" className="py-1">
            Sessions
          </th>
          <th scope="col" className="py-1">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.label} className="border-mist border-t">
            <th scope="row" className="py-1 font-normal">
              {s.label}
            </th>
            <td className="py-1">{s.value}</td>
            <td className="py-1">{Math.round((s.value / max) * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SimpleTable({
  caption,
  columns,
  rows,
  testId,
}: {
  caption: string;
  columns: Array<{ key: string; label: string; format?: (v: unknown) => string }>;
  rows: Array<Record<string, unknown>>;
  testId: string;
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="text-ink/70 text-xs" data-testid={`${testId}-empty`}>
        Nothing to show for these filters yet.
      </p>
    );
  }
  return (
    <table className="w-full text-left text-xs" data-testid={testId}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-ink/70">
          {columns.map((c) => (
            <th key={c.key} scope="col" className="py-1 pr-3">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-mist border-t">
            {columns.map((c, ci) =>
              ci === 0 ? (
                <th key={c.key} scope="row" className="py-1 pr-3 font-normal">
                  {c.format ? c.format(r[c.key]) : String(r[c.key] ?? "")}
                </th>
              ) : (
                <td key={c.key} className="py-1 pr-3">
                  {c.format ? c.format(r[c.key]) : String(r[c.key] ?? "")}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const pct = (v: unknown): string =>
  v === null || v === undefined ? "" : `${Math.round(Number(v) * 100)}%`;
export const num2 = (v: unknown): string =>
  v === null || v === undefined ? "" : Number(v).toFixed(2);
