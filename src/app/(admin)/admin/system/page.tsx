"use client";

import React, { useCallback, useEffect, useState } from "react";
import { SimpleTable } from "@/client/components/dashboard/Widgets";

interface SystemData {
  configVersion: number;
  showModelIdentifiers: boolean;
  usage: { sessions: number; turns: number; ingests: number };
  latency: Array<Record<string, unknown>>;
  cost: Array<Record<string, unknown>>;
  costPerLearnerHour: number | null;
  cacheHitRate: number;
  media: Array<Record<string, unknown>>;
  spend: { today: number; capUsd: number; degradeAtPercent: number };
  breaker: { routes: Array<{ route: string; state: string; failures: number }> };
}

const ms = (v: unknown): string =>
  v === null || v === undefined ? "" : `${Math.round(Number(v))}`;
const usd = (v: unknown): string =>
  v === null || v === undefined ? "" : `$${Number(v).toFixed(4)}`;

/** Admin system view. */
export default function AdminSystemPage(): React.JSX.Element {
  const [data, setData] = useState<SystemData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/system");
      if (!res.ok) throw new Error("The system view could not be loaded.");
      setData((await res.json()) as SystemData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The system view could not be loaded.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  const spendPct = data
    ? Math.round((data.spend.today / Math.max(data.spend.capUsd, 0.01)) * 100)
    : 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8" data-testid="admin-system">
      <h1 className="text-ink text-xl font-bold tracking-tight">System</h1>
      <p className="text-ink/70 mt-1 text-sm">
        Last 14 days. Settings version {data?.configVersion ?? "..."}.
      </p>

      {error && (
        <p role="alert" className="text-kattha mt-4 text-sm">
          {error}
        </p>
      )}

      <dl aria-label="Usage and spend" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Sessions"
          value={String(data?.usage.sessions ?? "...")}
          testId="sys-sessions"
        />
        <Stat label="Turns" value={String(data?.usage.turns ?? "...")} testId="sys-turns" />
        <Stat
          label="Cache hit rate"
          value={data ? `${Math.round(data.cacheHitRate * 100)}%` : "..."}
          testId="sys-cache"
        />
        <Stat
          label="Spend today"
          value={
            data ? `$${data.spend.today.toFixed(2)} of $${data.spend.capUsd.toFixed(2)}` : "..."
          }
          testId="sys-spend"
        />
      </dl>

      {data && spendPct >= data.spend.degradeAtPercent && (
        <p role="alert" data-testid="sys-spend-warning" className="text-kattha mt-3 text-xs">
          Spend is at {spendPct}% of the daily cap. The engine degrades at{" "}
          {data.spend.degradeAtPercent}%.
        </p>
      )}

      <section aria-label="Latency by task" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Latency by task</h2>
        <p className="text-ink/70 mt-1 text-xs">
          {data?.showModelIdentifiers
            ? "Model identifiers are shown because the setting is on."
            : "Tiers are shown rather than model identifiers."}
        </p>
        <div className="mt-3">
          <SimpleTable
            testId="sys-latency-table"
            caption="Calls, first token and total latency percentiles, errors and fallbacks by task"
            columns={[
              { key: "task", label: "Task" },
              { key: "tier", label: "Tier" },
              { key: "calls", label: "Calls" },
              { key: "ttft_p50", label: "First token p50", format: ms },
              { key: "ttft_p95", label: "First token p95", format: ms },
              { key: "latency_p95", label: "Latency p95", format: ms },
              { key: "errors", label: "Errors" },
              { key: "fallbacks", label: "Fallbacks" },
            ]}
            rows={data?.latency ?? []}
          />
        </div>
      </section>

      <section aria-label="Speech providers" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Speech providers</h2>
        <div className="mt-3">
          <SimpleTable
            testId="sys-media-table"
            caption="Speech calls, failovers and seconds by provider"
            columns={[
              { key: "provider", label: "Provider" },
              { key: "calls", label: "Calls" },
              { key: "failovers", label: "Failovers" },
              { key: "seconds", label: "Seconds" },
            ]}
            rows={data?.media ?? []}
          />
        </div>
      </section>

      <section aria-label="Cost" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Cost per day</h2>
        <p className="text-ink/70 mt-1 text-xs" data-testid="sys-cost-per-learner-hour">
          {data?.costPerLearnerHour === null || data?.costPerLearnerHour === undefined
            ? "Cost per learner-hour: not enough finished practice in the last 14 days to say."
            : `Cost per learner-hour: ${usd(data.costPerLearnerHour)}, over the last 14 days.`}
        </p>
        <div className="mt-3">
          <SimpleTable
            testId="sys-cost-table"
            caption="Model spend and call count for each day"
            columns={[
              { key: "day", label: "Day", format: (v) => String(v ?? "").slice(0, 10) },
              { key: "cost_usd", label: "Cost", format: usd },
              { key: "calls", label: "Calls" },
            ]}
            rows={data?.cost ?? []}
          />
        </div>
      </section>

      <section aria-label="Provider health" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Provider health</h2>
        <p className="text-ink/70 mt-1 text-xs" data-testid="sys-breaker">
          {data
            ? data.breaker.routes.length === 0
              ? "Circuit breaker: no provider failures recorded on this instance."
              : data.breaker.routes
                  .map((r) => `${r.route}: ${r.state} (${r.failures} failures)`)
                  .join("; ")
            : "..."}
        </p>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}): React.JSX.Element {
  return (
    <div className="border-mist rounded-lg border bg-white p-3">
      <dt className="text-ink/70 text-xs">{label}</dt>
      <dd data-testid={testId} className="text-ink text-lg font-semibold">
        {value}
      </dd>
    </div>
  );
}
