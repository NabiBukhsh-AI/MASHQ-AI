"use client";

import React from "react";

export interface DashboardFilters {
  days: number;
  departments: string[];
  languages: string[];
  modalities: string[];
  includeSeeded: boolean;
}

export const DEFAULT_FILTERS: DashboardFilters = {
  days: 14,
  departments: [],
  languages: [],
  modalities: [],
  includeSeeded: true,
};

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ur", label: "Urdu" },
  { id: "ur-Latn", label: "Roman Urdu" },
  { id: "mixed", label: "Mixed" },
];

const MODALITIES = [
  { id: "text", label: "Text" },
  { id: "voice", label: "Voice" },
];

/** Reads filters out of the URL, so a dashboard view can be shared or reloaded unchanged. */
export function filtersFromParams(params: URLSearchParams): DashboardFilters {
  const list = (key: string) =>
    (params.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const days = Number(params.get("days"));
  return {
    days: Number.isFinite(days) && days > 0 && days <= 365 ? days : 14,
    departments: list("departments"),
    languages: list("languages"),
    modalities: list("modalities"),
    includeSeeded: params.get("includeSeeded") !== "false",
  };
}

/** The query string the analytics routes expect. */
export function filtersToQuery(f: DashboardFilters): string {
  const p = new URLSearchParams();
  const from = new Date(Date.now() - f.days * 86_400_000).toISOString();
  p.set("from", from);
  p.set("to", new Date().toISOString());
  if (f.departments.length) p.set("departments", f.departments.join(","));
  if (f.languages.length) p.set("languages", f.languages.join(","));
  if (f.modalities.length) p.set("modalities", f.modalities.join(","));
  if (!f.includeSeeded) p.set("includeSeeded", "false");
  return p.toString();
}

/** What goes in the address bar: the human readable shape, not the resolved dates. */
export function filtersToUrl(f: DashboardFilters): string {
  const p = new URLSearchParams();
  if (f.days !== 14) p.set("days", String(f.days));
  if (f.departments.length) p.set("departments", f.departments.join(","));
  if (f.languages.length) p.set("languages", f.languages.join(","));
  if (f.modalities.length) p.set("modalities", f.modalities.join(","));
  if (!f.includeSeeded) p.set("includeSeeded", "false");
  const q = p.toString();
  return q ? `?${q}` : "";
}

export function Filters({
  value,
  departments,
  onChange,
}: {
  value: DashboardFilters;
  departments: string[];
  onChange: (next: DashboardFilters) => void;
}): React.JSX.Element {
  const toggle = (key: "languages" | "modalities" | "departments", id: string) => {
    const current = value[key];
    onChange({
      ...value,
      [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    });
  };

  return (
    <section
      aria-label="Dashboard filters"
      data-testid="dashboard-filters"
      className="border-mist flex flex-wrap items-end gap-4 rounded-lg border bg-white p-3"
    >
      <div>
        <label htmlFor="filter-days" className="text-ink/70 block text-xs">
          Period
        </label>
        <select
          id="filter-days"
          data-testid="filter-days"
          value={value.days}
          onChange={(e) => onChange({ ...value, days: Number(e.target.value) })}
          className="border-mist mt-1 rounded-lg border px-2 py-1 text-xs"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <fieldset className="border-0 p-0">
        <legend className="text-ink/70 text-xs">Language</legend>
        <div className="mt-1 flex gap-1">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={value.languages.includes(l.id)}
              data-testid={`filter-lang-${l.id}`}
              onClick={() => toggle("languages", l.id)}
              className={`rounded-md px-2 py-1 text-xs ${
                value.languages.includes(l.id)
                  ? "bg-neem text-white"
                  : "border-mist text-ink/70 border"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="border-0 p-0">
        <legend className="text-ink/70 text-xs">Modality</legend>
        <div className="mt-1 flex gap-1">
          {MODALITIES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={value.modalities.includes(m.id)}
              data-testid={`filter-modality-${m.id}`}
              onClick={() => toggle("modalities", m.id)}
              className={`rounded-md px-2 py-1 text-xs ${
                value.modalities.includes(m.id)
                  ? "bg-neem text-white"
                  : "border-mist text-ink/70 border"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>

      {departments.length > 0 && (
        <div>
          <label htmlFor="filter-department" className="text-ink/70 block text-xs">
            Department
          </label>
          <select
            id="filter-department"
            data-testid="filter-department"
            value={value.departments[0] ?? ""}
            onChange={(e) =>
              onChange({ ...value, departments: e.target.value ? [e.target.value] : [] })
            }
            className="border-mist mt-1 rounded-lg border px-2 py-1 text-xs"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          id="filter-seeded"
          type="checkbox"
          data-testid="filter-seeded"
          checked={value.includeSeeded}
          onChange={(e) => onChange({ ...value, includeSeeded: e.target.checked })}
        />
        <label htmlFor="filter-seeded" className="text-ink/70 text-xs">
          Include seeded demo data
        </label>
      </div>
    </section>
  );
}
