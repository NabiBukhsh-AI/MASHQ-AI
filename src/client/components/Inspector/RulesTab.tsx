import React from "react";
import type { InspectorRule } from "@/client/session/useInspector";

const SOURCE_LABEL: Record<string, string> = {
  policy: "engine",
  panel_control: "panel",
  admin_config: "admin",
};

/** Rule firings with their reason sentences, newest first. */
export function RulesTab({ rows }: { rows: InspectorRule[] }): React.JSX.Element {
  if (!rows.length)
    return (
      <p className="text-ink/70" data-testid="rules-empty">
        No decisions yet. The first turn records one.
      </p>
    );
  return (
    <ol className="flex flex-col gap-2" data-testid="rules-list">
      {rows.map((r) => (
        <li key={r.id} className="border-mist/60 border-b pb-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-ink font-semibold">
              {r.ruleId} {r.moveType}
            </span>
            <span className="text-ink/70">{SOURCE_LABEL[r.source] ?? r.source}</span>
          </div>
          <p className="text-ink/70 mt-0.5 leading-5">{r.reason}</p>
          {r.modifiers.length > 0 && (
            <p className="text-ink/70 mt-0.5">modifiers: {r.modifiers.join(", ")}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
