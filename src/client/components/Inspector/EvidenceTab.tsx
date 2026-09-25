import React from "react";
import type { InspectorEvidence } from "@/client/session/useInspector";

const VERDICT_LABEL: Record<string, string> = {
  correct: "correct",
  partial: "partial",
  incorrect: "incorrect",
  not_an_answer: "not an answer",
};

/** The evidence feed: one row per graded answer, newest first. */
export function EvidenceTab({ rows }: { rows: InspectorEvidence[] }): React.JSX.Element {
  if (!rows.length)
    return (
      <p className="text-ink/70" data-testid="evidence-empty">
        No evidence yet. Answer a question to see it here.
      </p>
    );
  return (
    <table className="w-full" data-testid="evidence-table">
      <caption className="sr-only">Evidence recorded in this session, newest first</caption>
      <thead>
        <tr className="text-ink/70 text-start">
          <th scope="col" className="py-1 text-start font-normal">
            Concept
          </th>
          <th scope="col" className="py-1 text-start font-normal">
            Signal
          </th>
          <th scope="col" className="py-1 text-start font-normal">
            Verdict
          </th>
          <th scope="col" className="py-1 text-end font-normal">
            Estimated
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-mist/60 border-b align-top">
            <th scope="row" className="text-ink py-1 pe-2 text-start font-normal">
              {r.conceptKey}
              {r.misconceptionId ? (
                <span className="text-ink/70 block">misconception {r.misconceptionId}</span>
              ) : null}
            </th>
            <td className="text-ink/70 py-1 pe-2">
              {r.signal}
              {r.hintLevel > 0 ? ` (hint ${r.hintLevel})` : ""}
              {r.selfCorrected ? " (self corrected)" : ""}
            </td>
            <td className="text-ink py-1 pe-2">
              {VERDICT_LABEL[r.verdict] ?? r.verdict}
              <span className="text-ink/70"> {r.score.toFixed(2)}</span>
            </td>
            <td className="text-ink py-1 text-end tabular-nums">
              {r.pBefore.toFixed(2)} to {r.pAfter.toFixed(2)}
              <span className="text-ink/70 block">
                weight {r.weight.toFixed(2)}, {r.source}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
