"use client";

import React, { useState } from "react";
import { QuickStart } from "@/client/components/QuickStart";
import { ContentLibraryTable } from "@/client/components/ContentLibraryTable";
import { useStartPractice } from "@/client/session/useStartPractice";
import {
  JourneyMap,
  type JourneyChapter,
  type JourneyMission,
} from "@/client/components/JourneyMap";
import { IngestTab, type IngestTelemetry } from "@/client/components/Inspector/IngestTab";
import { useLang } from "@/client/i18n/LanguageProvider";
import { BidiText } from "@/client/components/BidiText";

export default function LearnPage(): React.JSX.Element {
  const { lang, t } = useLang();
  const practice = useStartPractice();
  // Bumped when an upload becomes playable, so it appears in the library list below.
  const [refreshKey, setRefreshKey] = useState(0);

  const [journey, setJourney] = useState<{
    title?: string;
    summary?: string;
    chapters: JourneyChapter[];
  }>({
    chapters: [],
  });

  const [telemetry, setTelemetry] = useState<IngestTelemetry>({
    stages: [],
    elapsedMs: 0,
    redactionsCount: 0,
    injectionFlagsCount: 0,
    scannedPageCount: 0,
    warnings: [],
  });

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedMission, setSelectedMission] = useState<JourneyMission | null>(null);

  return (
    <div className="bg-paper text-ink min-h-screen font-sans">
      {/* Top action bar */}
      <header className="border-mist border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <h1 className="text-ink text-xl font-bold tracking-tight">
              <BidiText lang={lang} text={t("learnTitle")} />
            </h1>
            <p className="text-ink/70 text-xs">
              <BidiText lang={lang} text={t("learnSubtitle")} />
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInspectorOpen((prev) => !prev)}
            className="border-mist bg-paper/60 text-ink hover:bg-paper focus:ring-neem inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm focus:ring-2 focus:outline-none"
            data-testid="toggle-inspector-button"
            aria-expanded={inspectorOpen}
          >
            <span className="bg-neem me-1.5 h-2 w-2 shrink-0 rounded-full" />
            <BidiText lang={lang} text={t(inspectorOpen ? "hideInspector" : "engineInspector")} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: QuickStart & Controls */}
          <div className="space-y-6 lg:col-span-7">
            <QuickStart
              onTelemetryUpdate={setTelemetry}
              onJourneyUpdate={setJourney}
              onStartMission={(journeyId, _missionId, options) =>
                void practice.start(journeyId, options)
              }
              onPlayable={() => setRefreshKey((k) => k + 1)}
            />

            {practice.error && (
              <p role="alert" className="text-kattha text-sm" data-testid="start-session-error">
                {practice.error}
              </p>
            )}

            {practice.starting && (
              <div
                className="border-mist text-neem flex items-center justify-center rounded-xl border bg-white p-4 text-sm"
                data-testid="starting-session-indicator"
              >
                <span className="border-neem me-2 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent" />
                <BidiText lang={lang} text={t("preparingSession")} />
              </div>
            )}
          </div>

          {/* Right Column: Live Journey Map & Outline */}
          <div className="space-y-6 lg:col-span-5">
            <JourneyMap
              title={journey.title}
              summary={journey.summary}
              chapters={journey.chapters}
              isLoading={telemetry.elapsedMs > 0 && journey.chapters.length === 0}
              onSelectMission={setSelectedMission}
              selectedMissionKey={selectedMission?.key}
            />
          </div>
        </div>
        <ContentLibraryTable variant="learn" refreshKey={refreshKey} />
      </main>

      {/* Engine Inspector Drawer / Panel */}
      {inspectorOpen && (
        <aside
          className="border-mist fixed right-0 bottom-0 z-40 w-full border-t bg-white shadow-2xl transition-all sm:right-4 sm:bottom-4 sm:w-96 sm:rounded-xl sm:border"
          data-testid="inspector-panel"
          aria-label="Engine Inspector"
        >
          <div className="border-mist bg-paper/50 flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="bg-neem h-2 w-2 shrink-0 rounded-full" />
              <h3 className="text-ink text-xs font-bold tracking-wider uppercase">
                <BidiText lang={lang} text={t("engineInspector")} />
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              className="text-ink/70 hover:bg-mist/40 hover:text-ink focus:ring-neem rounded p-1 focus:ring-1 focus:outline-none"
              aria-label="Close Inspector"
              data-testid="close-inspector-button"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            <IngestTab telemetry={telemetry} />
          </div>
        </aside>
      )}
    </div>
  );
}
