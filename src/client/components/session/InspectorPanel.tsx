import React from "react";

/** The `inspector` event delta the turn engine emits after each turn (server/engine/turn.ts). */
export interface InspectorDelta {
  turnId: string;
  verdict: {
    verdict: string;
    score: number;
    misconception: string | null;
    helpRequest: boolean;
  } | null;
  move: { id: string; type: string; ruleId: string; reason: string; params?: unknown };
  question: string;
  attempts: number;
  hintLevel: number;
  completed: number;
  total: number;
  configVersion: number;
  configHash: string;
  tier: string;
  protocolOk: boolean;
  switches?: { kind: string; to: string; reason: string }[];
  engagement?: {
    frustration: number;
    fatigue: number;
    pace: string;
    frustrated: boolean;
    fatigued: boolean;
  } | null;
  mastery?: {
    conceptId: string;
    conceptKey: string;
    before: number;
    after: number;
    band: string;
    limitedEvidence: boolean;
    lower: number;
    upper: number;
    nEvents: number;
  } | null;
}

const BAND_LABEL: Record<string, string> = {
  not_yet: "not yet",
  developing: "developing",
  proficient: "proficient",
  mastered: "mastered",
};

export interface TurnTabProps {
  delta: InspectorDelta | null;
  timings: Record<string, number> | null;
  persona: string;
  language: string;
  station: string;
}

const TIER_LABEL: Record<string, string> = {
  fast: "Fast tier",
  design: "Design tier",
  fallback: "Fallback tier",
};

/** Plain tables, no charts: what the engine decided and why. */
/** The "Turn" section of the Inspector: what the engine decided on the last turn and why. */
export function TurnTab({
  delta,
  timings,
  persona,
  language,
  station,
}: TurnTabProps): React.JSX.Element {
  const rows: [string, string][] = delta
    ? [
        ["Question", delta.question],
        ["Verdict", delta.verdict ? `${delta.verdict.verdict} (${delta.verdict.score})` : "none"],
        ["Misconception", delta.verdict?.misconception ?? "none"],
        ["Move", delta.move.type],
        ["Rule", delta.move.ruleId],
        ["Attempts", String(delta.attempts)],
        ["Hint level", String(delta.hintLevel)],
        ["Progress", `${delta.completed} of ${delta.total} questions`],
        ["Config", `v${delta.configVersion} (${delta.configHash.slice(0, 8)})`],
        ["Model", TIER_LABEL[delta.tier] ?? delta.tier],
        ["Protocol", delta.protocolOk ? "clean" : "repaired"],
        ...(delta.switches ?? []).map((sw) => [`Switched ${sw.kind}`, sw.to] as [string, string]),
        ...(delta.engagement
          ? ([
              [
                "Frustration",
                `${delta.engagement.frustration.toFixed(2)}${delta.engagement.frustrated ? " (above threshold)" : ""}`,
              ],
              [
                "Fatigue",
                `${delta.engagement.fatigue.toFixed(2)}${delta.engagement.fatigued ? " (above threshold)" : ""}`,
              ],
              ["Pace", delta.engagement.pace],
            ] as [string, string][])
          : []),
        ...(delta.mastery
          ? ([
              [
                "Mastery (estimated)",
                `${delta.mastery.conceptKey} ${delta.mastery.before.toFixed(2)} -> ${delta.mastery.after.toFixed(2)}`,
              ],
              [
                "Band",
                `${BAND_LABEL[delta.mastery.band] ?? delta.mastery.band}${delta.mastery.limitedEvidence ? ", limited evidence" : ""} [${delta.mastery.lower.toFixed(2)}, ${delta.mastery.upper.toFixed(2)}]`,
              ],
            ] as [string, string][])
          : []),
      ]
    : [];
  return (
    <>
      <section className="mt-4">
        <h3 className="text-ink font-semibold">Session</h3>
        <table className="mt-1 w-full">
          <tbody>
            <Row k="Persona" v={persona} />
            <Row k="Language" v={language} />
            <Row k="Station" v={station} />
          </tbody>
        </table>
      </section>

      <section className="mt-4">
        <h3 className="text-ink font-semibold">Last turn</h3>
        {delta ? (
          <>
            <table className="mt-1 w-full" data-testid="inspector-turn">
              <tbody>
                {rows.map(([k, v]) => (
                  <Row key={k} k={k} v={v} />
                ))}
              </tbody>
            </table>
            <p className="text-ink/70 mt-2 leading-5">
              <span className="text-ink font-semibold">Why: </span>
              {delta.move.reason}
            </p>
            {(delta.switches ?? []).map((sw) => (
              <p
                key={`${sw.kind}-${sw.to}`}
                className="text-ink/70 mt-1 leading-5"
                data-testid="inspector-switch"
              >
                <span className="text-ink font-semibold">Panel: </span>
                {sw.reason}
              </p>
            ))}
          </>
        ) : (
          <p className="text-ink/70 mt-1">No turn yet.</p>
        )}
      </section>

      {timings && (
        <section className="mt-4">
          <h3 className="text-ink font-semibold">Timings</h3>
          <table className="mt-1 w-full">
            <tbody>
              {Object.entries(timings).map(([k, v]) => (
                <Row key={k} k={k} v={`${Math.round(v)} ms`} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <tr className="border-mist/60 border-b">
      <th scope="row" className="text-ink/70 py-1 pe-2 text-start font-normal">
        {k}
      </th>
      <td className="text-ink py-1 text-end tabular-nums">{v}</td>
    </tr>
  );
}
