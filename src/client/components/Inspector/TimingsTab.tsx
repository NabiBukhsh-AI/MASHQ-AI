import React from "react";
import type { InspectorTimings } from "@/client/session/useInspector";

const TIER_LABEL: Record<string, string> = {
  fast: "Fast tier",
  design: "Design tier",
  fallback: "Fallback tier",
  embed: "Embedding tier",
};

const ms = (n: number | null) => (n === null ? "n/a" : `${Math.round(n)} ms`);

/** Timings, cache share and cost. Tier labels only, unless ui.showModelIdentifiers is on. */
export function TimingsTab({ timings }: { timings: InspectorTimings | null }): React.JSX.Element {
  if (!timings || (!timings.turns.length && !timings.calls.length))
    return (
      <p className="text-ink/70" data-testid="timings-empty">
        No timings yet.
      </p>
    );
  const last = timings.turns[0];
  return (
    <div className="flex flex-col gap-3" data-testid="timings">
      <table className="w-full">
        <caption className="sr-only">Latest turn timings and session totals</caption>
        <tbody>
          <tr className="border-mist/60 border-b">
            <th scope="row" className="text-ink/70 py-1 pe-2 text-start font-normal">
              First token (last turn)
            </th>
            <td className="text-ink py-1 text-end tabular-nums">{ms(last?.ttftMs ?? null)}</td>
          </tr>
          <tr className="border-mist/60 border-b">
            <th scope="row" className="text-ink/70 py-1 pe-2 text-start font-normal">
              Turn total (last turn)
            </th>
            <td className="text-ink py-1 text-end tabular-nums">{ms(last?.latencyMs ?? null)}</td>
          </tr>
          <tr className="border-mist/60 border-b">
            <th scope="row" className="text-ink/70 py-1 pe-2 text-start font-normal">
              Cached input share
            </th>
            <td className="text-ink py-1 text-end tabular-nums">
              {Math.round(timings.totals.cacheShare * 100)}%
            </td>
          </tr>
          <tr className="border-mist/60 border-b">
            <th scope="row" className="text-ink/70 py-1 pe-2 text-start font-normal">
              Session cost (estimated)
            </th>
            <td className="text-ink py-1 text-end tabular-nums">
              ${timings.totals.costUsd.toFixed(4)}
            </td>
          </tr>
        </tbody>
      </table>

      <div>
        <h4 className="text-ink font-semibold">Model calls</h4>
        <table className="mt-1 w-full" data-testid="timings-calls">
          <caption className="sr-only">Model calls in this session, newest first</caption>
          <thead>
            <tr className="text-ink/70">
              <th scope="col" className="py-1 text-start font-normal">
                Task
              </th>
              <th scope="col" className="py-1 text-start font-normal">
                Tier
              </th>
              <th scope="col" className="py-1 text-end font-normal">
                First token
              </th>
              <th scope="col" className="py-1 text-end font-normal">
                Cached
              </th>
            </tr>
          </thead>
          <tbody>
            {timings.calls.slice(0, 12).map((c, i) => (
              <tr key={`${c.at}-${i}`} className="border-mist/60 border-b">
                <th scope="row" className="text-ink py-1 pe-2 text-start font-normal">
                  {c.task}
                </th>
                <td className="text-ink/70 py-1 pe-2">
                  {TIER_LABEL[c.tier] ?? c.tier}
                  {c.model ? ` (${c.model})` : ""}
                </td>
                <td className="text-ink py-1 text-end tabular-nums">{ms(c.ttftMs)}</td>
                <td className="text-ink py-1 text-end tabular-nums">
                  {c.cacheReadTokens.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
