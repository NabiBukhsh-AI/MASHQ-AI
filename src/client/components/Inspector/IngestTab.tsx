"use client";

import React from "react";

export interface PipelineStageInfo {
  stage: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
  message?: string;
}

export interface IngestTelemetry {
  stages: PipelineStageInfo[];
  elapsedMs: number;
  redactionsCount: number;
  injectionFlagsCount: number;
  scannedPageCount: number;
  warnings: string[];
  groundingSummary?: {
    supported: number;
    total: number;
  };
  reused?: boolean;
}

export interface IngestTabProps {
  telemetry: IngestTelemetry;
}

export function IngestTab({ telemetry }: IngestTabProps): React.JSX.Element {
  const {
    stages,
    elapsedMs,
    redactionsCount,
    injectionFlagsCount,
    scannedPageCount,
    warnings,
    groundingSummary,
    reused,
  } = telemetry;

  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <div className="space-y-4 p-4 font-sans text-sm" data-testid="ingest-tab">
      {/* Header Metrics */}
      <div className="border-mist flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <span className="text-ink/70 text-xs tracking-wider uppercase">
            Pipeline Elapsed Time
          </span>
          <p className="text-ink text-xl font-bold" data-testid="elapsed-time">
            {seconds}s
          </p>
        </div>
        {reused && (
          <span
            className="bg-neem/10 text-neem inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            data-testid="reused-badge"
          >
            Reused from cache (instant)
          </span>
        )}
      </div>

      {/* Safety & Ingestion Metrics Card */}
      <div className="border-mist bg-paper/60 rounded-lg border p-3">
        <h4 className="text-ink/70 mb-2 text-xs font-semibold tracking-wider uppercase">
          Intake & Safety Scan
        </h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="border-mist/50 min-w-0 rounded border bg-white/80 p-2 text-center">
            <span className="text-ink/70 text-xs break-words">Redactions</span>
            <p
              className="text-ink text-base font-semibold break-words"
              data-testid="metric-redactions"
            >
              {redactionsCount}
            </p>
          </div>
          <div className="border-mist/50 min-w-0 rounded border bg-white/80 p-2 text-center">
            <span className="text-ink/70 text-xs break-words">Prompt Injections</span>
            <p
              className={`text-base font-semibold break-words ${
                injectionFlagsCount > 0 ? "text-kattha" : "text-ink"
              }`}
              data-testid="metric-injections"
            >
              {injectionFlagsCount}
            </p>
          </div>
          <div className="border-mist/50 min-w-0 rounded border bg-white/80 p-2 text-center">
            <span className="text-ink/70 text-xs break-words">Scanned Pages</span>
            <p
              className="text-ink text-base font-semibold break-words"
              data-testid="metric-scanned"
            >
              {scannedPageCount}
            </p>
          </div>
          <div className="border-mist/50 min-w-0 rounded border bg-white/80 p-2 text-center">
            <span className="text-ink/70 text-xs break-words">Grounding Entailment</span>
            {/* The placeholder is a word, not a short number, and at text-base it was wider
                than the column. It gets the smaller size; the counts keep the larger one. */}
            <p
              className={`text-neem font-semibold break-words ${
                groundingSummary ? "text-base" : "text-sm"
              }`}
              data-testid="metric-grounding"
            >
              {groundingSummary
                ? `${groundingSummary.supported}/${groundingSummary.total}`
                : "Checking"}
            </p>
          </div>
        </div>
      </div>

      {/* Pipeline Stage Timeline */}
      <div className="border-mist bg-paper/60 rounded-lg border p-3">
        <h4 className="text-ink/70 mb-2 text-xs font-semibold tracking-wider uppercase">
          Pipeline Stages
        </h4>
        <div className="space-y-2">
          {stages.map((stage) => {
            let statusBadge = <span className="text-ink/40 text-xs">Waiting</span>;
            if (stage.status === "running") {
              statusBadge = (
                <span className="text-haldi inline-flex items-center text-xs font-medium">
                  <span className="bg-haldi me-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full" />
                  Running
                </span>
              );
            } else if (stage.status === "done") {
              statusBadge = (
                <span className="text-neem inline-flex items-center text-xs font-medium">
                  <svg
                    className="me-1 h-3.5 w-3.5 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Done {stage.durationMs ? `(${stage.durationMs}ms)` : ""}
                </span>
              );
            } else if (stage.status === "error") {
              statusBadge = <span className="text-kattha text-xs font-medium">Error</span>;
            }

            return (
              <div
                key={stage.stage}
                className="border-mist/40 flex items-center justify-between rounded border bg-white/70 px-3 py-2 text-xs"
                data-testid={`stage-row-${stage.stage}`}
              >
                <div className="min-w-0 pr-2">
                  <p className="text-ink font-medium">{stage.name}</p>
                  {stage.message && <p className="text-ink/70 truncate">{stage.message}</p>}
                </div>
                <div className="shrink-0">{statusBadge}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Warnings List */}
      {warnings.length > 0 && (
        <div
          className="border-haldi/40 bg-haldi/10 rounded-lg border p-3"
          data-testid="warnings-box"
        >
          <h4 className="text-haldi mb-1 text-xs font-semibold tracking-wider uppercase">
            Pipeline Warnings ({warnings.length})
          </h4>
          <ul className="text-ink/80 list-inside list-disc space-y-1 text-xs">
            {warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
