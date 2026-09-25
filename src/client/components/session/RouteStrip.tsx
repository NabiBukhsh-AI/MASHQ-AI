import React from "react";
import { BidiText } from "../BidiText";

export interface RouteStation {
  id: string;
  ordinal: number;
  title: string;
  isCurrent?: boolean;
  isCompleted?: boolean;
}

export interface RouteStripProps {
  currentStation: number;
  totalStations: number;
  missionTitle?: string;
  journeyTitle?: string;
  stations?: RouteStation[];
}

export function RouteStrip({
  currentStation = 1,
  totalStations = 1,
  missionTitle = "Mission 1",
  journeyTitle,
  stations = [],
}: RouteStripProps): React.JSX.Element {
  const safeTotal = Math.max(1, totalStations);
  const safeCurrent = Math.min(Math.max(1, currentStation), safeTotal);
  const progressPercent = Math.round((safeCurrent / safeTotal) * 100);

  // Generate fallback station array if none provided
  const stationItems: RouteStation[] =
    stations.length > 0
      ? stations
      : Array.from({ length: safeTotal }, (_, i) => {
          const ordinal = i + 1;
          return {
            id: `station-${ordinal}`,
            ordinal,
            title: ordinal === safeCurrent ? missionTitle : `Station ${ordinal}`,
            isCurrent: ordinal === safeCurrent,
            isCompleted: ordinal < safeCurrent,
          };
        });

  return (
    <nav
      aria-label="Mission progress"
      data-testid="route-strip"
      className="border-mist bg-paper/80 border-b px-4 py-2.5 backdrop-blur-sm"
    >
      {/* Mobile collapsed view */}
      <div className="flex flex-col gap-1.5 md:hidden">
        <div className="text-ink/80 flex items-center justify-between text-xs">
          <span className="text-neem font-semibold">
            Station {safeCurrent} of {safeTotal}
          </span>
          {missionTitle && (
            <BidiText
              text={missionTitle}
              as="span"
              className="text-ink/70 max-w-[200px] truncate text-xs"
            />
          )}
        </div>
        {/* Thin Haldi progress line */}
        <div
          role="progressbar"
          aria-valuenow={safeCurrent}
          aria-valuemin={1}
          aria-valuemax={safeTotal}
          aria-label={`Station ${safeCurrent} of ${safeTotal}`}
          className="bg-mist/60 h-1 w-full overflow-hidden rounded-full"
        >
          <div
            className="bg-haldi h-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Desktop expanded route track */}
      <div className="hidden items-center justify-between gap-6 md:flex">
        {/* Left: Station summary text */}
        <div className="flex items-center gap-2" data-testid="route-desktop-summary">
          {journeyTitle && (
            <span className="text-ink/70 text-xs font-medium">
              <BidiText text={journeyTitle} as="span" />:
            </span>
          )}
          <span className="text-ink text-xs font-semibold">
            Station {safeCurrent} of {safeTotal}:
          </span>
          <BidiText text={missionTitle} as="span" className="text-neem text-xs font-medium" />
        </div>

        {/* Center / Right: Visual journey line with stations */}
        <ol className="flex items-center gap-2" role="list" aria-label="Stations list">
          {stationItems.map((station, idx) => {
            const isCompleted = station.isCompleted ?? station.ordinal < safeCurrent;
            const isCurrent = station.isCurrent ?? station.ordinal === safeCurrent;
            const isLast = idx === stationItems.length - 1;

            return (
              <li key={station.id} className="flex items-center">
                {/* Station node button / circle */}
                <div
                  className="flex items-center gap-1.5"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span
                    title={station.title}
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                      isCurrent
                        ? "border-haldi bg-paper text-ink ring-haldi/30 border-2 ring-2"
                        : isCompleted
                          ? "bg-haldi text-paper"
                          : "border-mist bg-paper text-ink/40 border"
                    }`}
                  >
                    {isCompleted ? "✓" : station.ordinal}
                  </span>
                  <span
                    className={`hidden text-xs lg:inline ${
                      isCurrent ? "text-ink font-semibold" : "text-ink/70"
                    }`}
                  >
                    <BidiText text={station.title} as="span" className="max-w-[140px] truncate" />
                  </span>
                </div>

                {/* Connecting track line */}
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={`mx-2 h-0.5 w-6 rounded-full transition-colors ${
                      isCompleted ? "bg-haldi" : "bg-mist"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
