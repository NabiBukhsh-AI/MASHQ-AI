"use client";

import React from "react";
import { BidiText } from "./BidiText";

export interface JourneyMission {
  id?: string;
  key: string;
  ordinal: number;
  title: string;
  objective?: string;
  mechanic?: string;
  status: "pending" | "ready";
}

export interface JourneyChapter {
  key: string;
  title: string;
  arcBeat?: string;
  missions: JourneyMission[];
}

export interface JourneyMapProps {
  title?: string;
  summary?: string;
  chapters: JourneyChapter[];
  isLoading?: boolean;
  onSelectMission?: (mission: JourneyMission) => void;
  selectedMissionKey?: string;
}

export function JourneyMap({
  title,
  summary,
  chapters,
  isLoading = false,
  onSelectMission,
  selectedMissionKey,
}: JourneyMapProps): React.JSX.Element {
  return (
    <div
      className="border-mist bg-paper/90 rounded-xl border p-5 font-sans shadow-sm"
      data-testid="journey-map"
    >
      <div className="border-mist mb-4 border-b pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-ink text-lg font-bold" data-testid="journey-title">
            <BidiText text={title || (isLoading ? "Discovering Journey..." : "Journey Outline")} />
          </h2>
          {isLoading && (
            <span
              className="bg-haldi/10 text-haldi inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              data-testid="journey-loading-badge"
            >
              <span className="bg-haldi me-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full" />
              Mapping concepts live
            </span>
          )}
        </div>
        {summary && (
          <p className="text-ink/75 mt-1 text-sm" data-testid="journey-summary">
            <BidiText text={summary} />
          </p>
        )}
      </div>

      {chapters.length === 0 ? (
        <div
          className="border-mist text-ink/70 flex h-36 items-center justify-center rounded-lg border border-dashed text-sm"
          data-testid="journey-empty"
        >
          {isLoading
            ? "Reading source document and organizing chapters..."
            : "No journey chapters available yet."}
        </div>
      ) : (
        <div className="space-y-6" role="list" aria-label="Journey Chapters">
          {chapters.map((chapter, chapIdx) => (
            <div
              key={chapter.key || chapIdx}
              className="border-mist/70 rounded-lg border bg-white/70 p-4 transition-all"
              role="listitem"
              data-testid={`chapter-${chapter.key}`}
            >
              <div className="mb-3">
                <span className="text-neem text-xs font-semibold tracking-wider uppercase">
                  Chapter {chapIdx + 1}
                </span>
                <h3 className="text-ink text-base font-bold">
                  <BidiText text={chapter.title} />
                </h3>
                {chapter.arcBeat && (
                  <p className="text-ink/70 text-xs italic">Arc: {chapter.arcBeat}</p>
                )}
              </div>

              <div
                className="grid gap-2.5 sm:grid-cols-2"
                role="list"
                aria-label={`Missions in ${chapter.title}`}
              >
                {chapter.missions.map((mission) => {
                  const isSelected = selectedMissionKey === mission.key;
                  const isReady = mission.status === "ready";

                  return (
                    <button
                      key={mission.key}
                      type="button"
                      onClick={() => onSelectMission?.(mission)}
                      disabled={!isReady && !onSelectMission}
                      className={`focus:ring-neem flex flex-col items-start rounded-lg border p-3 text-left transition-colors focus:ring-2 focus:outline-none ${
                        isSelected
                          ? "border-neem bg-neem/5 ring-neem ring-1"
                          : isReady
                            ? "border-mist hover:border-neem/60 hover:bg-paper/40 bg-white"
                            : "border-mist/50 bg-paper/30 opacity-75"
                      }`}
                      data-testid={`mission-card-${mission.key}`}
                    >
                      <div className="flex w-full items-center justify-between gap-1.5">
                        <span className="text-ink/70 text-xs font-medium">
                          Mission {mission.ordinal + 1}
                        </span>
                        {isReady ? (
                          <span className="bg-neem/10 text-neem inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium">
                            Playable
                          </span>
                        ) : (
                          <span className="text-haldi inline-flex items-center text-[10px] font-medium">
                            <span className="bg-haldi me-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" />
                            Pending
                          </span>
                        )}
                      </div>

                      <h4 className="text-ink mt-1 text-sm font-semibold">
                        <BidiText text={mission.title} />
                      </h4>

                      {mission.objective && (
                        <p className="text-ink/70 mt-0.5 line-clamp-2 text-xs">
                          {mission.objective}
                        </p>
                      )}

                      {mission.mechanic && (
                        <div className="mt-2">
                          <span className="border-mist/80 bg-paper/80 text-ink/70 rounded border px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                            {mission.mechanic}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
