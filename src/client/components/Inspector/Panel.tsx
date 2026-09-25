"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { useInspector } from "@/client/session/useInspector";
import { EvidenceTab } from "./EvidenceTab";
import { MasteryTab } from "./MasteryTab";
import { RulesTab } from "./RulesTab";
import { TimingsTab } from "./TimingsTab";
import { TurnTab, type InspectorDelta } from "../session/InspectorPanel";

export type { InspectorDelta } from "../session/InspectorPanel";

const TABS = ["turn", "evidence", "mastery", "rules", "timings"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  turn: "Turn",
  evidence: "Evidence",
  mastery: "Mastery",
  rules: "Rules",
  timings: "Timings",
};

export interface InspectorProps {
  sessionId: string;
  /** The id of the toolbar toggle, so focus can return to it when the panel closes. */
  toggleId?: string;
  open: boolean;
  onClose: () => void;
  /** The last turn's delta from the stream (shown on the Turn tab without waiting for a poll). */
  delta: InspectorDelta | null;
  turnTimings: Record<string, number> | null;
  persona: string;
  language: string;
  station: string;
}

/**
 * Engine Inspector: a side panel on desktop, a bottom sheet on mobile. It polls
 * the inspector feed while open (2 s), slows to 10 s when closed and stops when the tab is hidden.
 */
export function Inspector({
  sessionId,
  toggleId,
  open,
  onClose,
  delta,
  turnTimings,
  persona,
  language,
  station,
}: InspectorProps): React.JSX.Element | null {
  const [tab, setTab] = useState<Tab>("turn");
  const panelId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const { data, error, configChanged, acknowledgeConfigChange } = useInspector(sessionId, open);

  // Opening moves focus into the panel; closing returns it to the toolbar toggle, so a keyboard
  // learner is never left on an element that has gone (WCAG 2.2 3.2.3 and 2.4.3).
  // Only on a real open to closed transition: on mount the panel is already closed, and
  // focusing the toggle there would take focus off the conversation on every page load.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) panelRef.current?.focus();
    else if (wasOpen.current && toggleId) document.getElementById(toggleId)?.focus();
    wasOpen.current = open;
  }, [open, toggleId]);

  // The settings banner belongs to the session, not to the Inspector. It used to render only
  // inside the panel, which is closed by default, so a learner who never opened the Inspector
  // was never told their session had changed under them. The hook already polls while closed.
  if (!open) {
    if (configChanged === null) return null;
    return (
      <div
        role="status"
        data-testid="inspector-config-banner"
        className="border-haldi/60 bg-haldi/10 text-ink mx-4 mb-2 flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
      >
        <span>
          Settings updated to v{configChanged}
          {data.configSummary ? `: ${data.configSummary}` : ""}. The next turn uses them.
        </span>
        <button
          type="button"
          onClick={acknowledgeConfigChange}
          className="text-ink/70 hover:text-ink focus-visible:ring-neem rounded px-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <aside
      ref={panelRef}
      id="engine-inspector"
      tabIndex={-1}
      aria-label="Engine Inspector"
      data-testid="inspector-panel"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      // In flow on every size: above the composer on mobile, a side column on desktop. Nothing
      // is overlaid, so the reply box and the talk button stay reachable.
      className="border-mist max-h-[50vh] shrink-0 overflow-y-auto border-t bg-white p-4 text-xs focus-visible:outline-none lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
    >
      <div className="border-mist flex items-center justify-between border-b pb-3">
        <h2 className="text-ink text-xs font-bold">Engine Inspector</h2>
        <button
          type="button"
          onClick={onClose}
          data-testid="inspector-close"
          className="text-ink/70 hover:text-ink focus-visible:ring-neem rounded px-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          Close
        </button>
      </div>

      {configChanged !== null && (
        <div
          role="status"
          data-testid="inspector-config-banner"
          className="border-haldi/60 bg-haldi/10 text-ink mt-3 flex items-start justify-between gap-2 rounded-lg border px-3 py-2"
        >
          <span>
            Settings updated to v{configChanged}
            {data.configSummary ? `: ${data.configSummary}` : ""}. The next turn uses them.
          </span>
          <button
            type="button"
            onClick={acknowledgeConfigChange}
            className="text-ink/70 hover:text-ink focus-visible:ring-neem rounded px-1 focus-visible:ring-2 focus-visible:outline-none"
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-kattha mt-3">
          {error}
        </p>
      )}

      <div role="tablist" aria-label="Inspector sections" className="mt-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${panelId}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${panelId}-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            data-testid={`inspector-tab-${t}`}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.indexOf(tab);
              const next =
                TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
              setTab(next);
              document.getElementById(`${panelId}-tab-${next}`)?.focus();
            }}
            className={`focus-visible:ring-neem min-h-8 rounded-lg px-2.5 py-1 focus-visible:ring-2 focus-visible:outline-none ${
              tab === t ? "bg-neem text-white" : "border-mist text-ink border bg-white"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${panelId}-panel-${tab}`}
        aria-labelledby={`${panelId}-tab-${tab}`}
        tabIndex={0}
        className="focus-visible:ring-neem mt-3 focus-visible:ring-2 focus-visible:outline-none"
      >
        {tab === "turn" && (
          <TurnTab
            delta={delta}
            timings={turnTimings}
            persona={persona}
            language={language}
            station={station}
          />
        )}
        {tab === "evidence" && <EvidenceTab rows={data.events} />}
        {tab === "mastery" && <MasteryTab rows={data.mastery} />}
        {tab === "rules" && <RulesTab rows={data.rules} />}
        {tab === "timings" && <TimingsTab timings={data.timings} />}
      </div>

      {data.mode && (
        <p className="border-mist text-ink/70 mt-3 border-t pt-2" data-testid="inspector-mode">
          Config v{data.configVersion} ({data.configHash?.slice(0, 8)}), grounding{" "}
          {data.mode.grounding}, {data.mode.assessment} assessment
          {data.mode.rulesOnly ? ", rules-only mode" : ""}.
        </p>
      )}
    </aside>
  );
}
