import React from "react";
import type { InspectorMastery } from "@/client/session/useInspector";

const BAND_LABEL: Record<string, string> = {
  not_yet: "not yet",
  developing: "developing",
  proficient: "proficient",
  mastered: "mastered",
};

/**
 * Mastery bars with the estimate range. Every number is an estimate and the
 * bar says so; the range is the half width around P, not a confidence interval claim.
 */
export function MasteryTab({ rows }: { rows: InspectorMastery[] }): React.JSX.Element {
  if (!rows.length)
    return (
      <p className="text-ink/70" data-testid="mastery-empty">
        No estimates yet. They appear once a concept has evidence.
      </p>
    );
  return (
    <ul className="flex flex-col gap-3" data-testid="mastery-list">
      {rows.map((m) => {
        const limited = m.band === "proficient" && m.nEvents < 3;
        return (
          <li key={m.conceptKey}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-ink">{m.conceptName}</span>
              <span className="text-ink/70 tabular-nums">{m.p.toFixed(2)} estimated</span>
            </div>
            <div
              role="meter"
              aria-label={`${m.conceptName} estimated mastery`}
              aria-valuenow={Math.round(m.p * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${Math.round(m.p * 100)} percent estimated, range ${Math.round(m.lower * 100)} to ${Math.round(m.upper * 100)}, band ${BAND_LABEL[m.band] ?? m.band}`}
              className="bg-mist relative mt-1 h-2 w-full rounded-full"
            >
              {/* the estimate range, then the point estimate on top */}
              <span
                className="bg-neem/30 absolute inset-y-0 rounded-full"
                style={{
                  left: `${m.lower * 100}%`,
                  width: `${Math.max(1, (m.upper - m.lower) * 100)}%`,
                }}
              />
              <span
                className="bg-neem absolute inset-y-0 w-1 rounded-full"
                style={{ left: `calc(${m.p * 100}% - 2px)` }}
              />
            </div>
            <p className="text-ink/70 mt-1">
              {BAND_LABEL[m.band] ?? m.band}
              {limited ? ", limited evidence" : ""} (range {m.lower.toFixed(2)} to{" "}
              {m.upper.toFixed(2)}, {m.nEvents} event{m.nEvents === 1 ? "" : "s"},{" "}
              {m.signalTypes.length} signal type{m.signalTypes.length === 1 ? "" : "s"})
            </p>
          </li>
        );
      })}
    </ul>
  );
}
