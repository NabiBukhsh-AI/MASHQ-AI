"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  InspectorEvidence,
  InspectorMastery,
  InspectorRule,
  InspectorSnapshot,
  InspectorTimings,
} from "@/server/engine/inspector";

export type {
  InspectorEvidence,
  InspectorMastery,
  InspectorRule,
  InspectorTimings,
} from "@/server/engine/inspector";

export interface InspectorData {
  events: InspectorEvidence[];
  mastery: InspectorMastery[];
  rules: InspectorRule[];
  timings: InspectorTimings | null;
  configVersion: number | null;
  configHash: string | null;
  configSummary: string | null;
  mode: InspectorSnapshot["mode"] | null;
}

const EMPTY: InspectorData = {
  events: [],
  mastery: [],
  rules: [],
  timings: null,
  configVersion: null,
  configHash: null,
  configSummary: null,
  mode: null,
};

/** 2 s while open, 10 s while closed, nothing while hidden. */
export const POLL_OPEN_MS = 2000;
export const POLL_CLOSED_MS = 10_000;

const KEEP = 50;
const merge = <T extends { id: string }>(fresh: T[], prev: T[]) =>
  [...fresh, ...prev.filter((p) => !fresh.some((f) => f.id === p.id))].slice(0, KEEP);

/**
 * Polls the inspector feed for one session. Returns the merged snapshot and a `configChanged`
 * flag when the session's config version moves under the learner (banner in the panel).
 */
export function useInspector(sessionId: string, open: boolean) {
  const [data, setData] = useState<InspectorData>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [configChanged, setConfigChanged] = useState<number | null>(null);
  const cursor = useRef<string | null>(null);
  const seenVersion = useRef<number | null>(null);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const url = cursor.current
        ? `/api/sessions/${sessionId}/inspector?since=${encodeURIComponent(cursor.current)}`
        : `/api/sessions/${sessionId}/inspector`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`The Inspector could not load (status ${res.status}).`);
      const snap = (await res.json()) as InspectorSnapshot;
      cursor.current = snap.cursor;
      if (seenVersion.current !== null && snap.configVersion !== seenVersion.current) {
        setConfigChanged(snap.configVersion);
      }
      seenVersion.current = snap.configVersion;
      setError(null);
      setData((prev) => ({
        events: merge(snap.events, prev.events),
        rules: merge(snap.rules, prev.rules),
        mastery: snap.mastery,
        timings: snap.timings,
        configVersion: snap.configVersion,
        configHash: snap.configHash,
        configSummary: snap.configSummary,
        mode: snap.mode,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The Inspector could not load.");
    } finally {
      inFlight.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      // A hidden tab polls nothing: Neon scales to zero and this session may sit for hours.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(tick, POLL_CLOSED_MS);
        return;
      }
      void poll();
      timer = setTimeout(tick, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        tick();
      }
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionId, open, poll]);

  const acknowledgeConfigChange = useCallback(() => setConfigChanged(null), []);
  return { data, error, configChanged, acknowledgeConfigChange, refresh: poll };
}
