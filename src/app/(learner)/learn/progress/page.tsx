"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BidiText } from "@/client/components/BidiText";
import { LevelBadge } from "@/client/components/LevelBadge";

interface ProgressData {
  concepts: Array<{
    conceptId: string;
    conceptKey: string;
    conceptLabel: string;
    p: number;
    band: string;
    lower: number;
    upper: number;
    nEvents: number;
  }>;
  evidence: Array<{
    id: string;
    conceptLabel: string;
    verdict: string;
    signal: string;
    hintLevel: number;
    at: string | null;
    why: string;
  }>;
  xp: { total: number; level: number; nextLevelXp: number | null; progress: number };
  streak: { currentDays: number; longestDays: number; freezesLeft: number };
  badges: Array<{ code: string; name: string; description: string }>;
  minutesThisWeek: number;
  nextRecommendation: { kind: string; label: string; reason: string } | null;
}

const BAND_LABEL: Record<string, string> = {
  not_yet: "Not yet",
  developing: "Developing",
  proficient: "Proficient",
  mastered: "Mastered",
};

export default function ProgressPage(): React.JSX.Element {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openConcept, setOpenConcept] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) throw new Error("Your progress could not be loaded. Try again.");
      setData((await res.json()) as ProgressData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your progress could not be loaded.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="text-kattha text-sm">
          {error}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8" data-testid="progress-page">
      <h1 className="text-ink text-xl font-bold tracking-tight">Your progress</h1>

      {data?.nextRecommendation && (
        <section
          aria-label="What to do next"
          data-testid="next-recommendation"
          className="border-neem/30 bg-neem/5 mt-4 rounded-lg border p-4"
        >
          <h2 className="text-ink text-sm font-semibold">Next: {data.nextRecommendation.label}</h2>
          <p className="text-ink/70 mt-1 text-xs">{data.nextRecommendation.reason}</p>
          <Link
            href="/learn"
            className="text-neem mt-2 inline-block text-xs font-semibold underline"
          >
            Go to your journey
          </Link>
        </section>
      )}

      {data && (
        <div className="mt-6">
          <LevelBadge
            level={data.xp.level}
            totalXp={data.xp.total}
            nextLevelXp={data.xp.nextLevelXp}
            progress={data.xp.progress}
          />
        </div>
      )}

      <dl aria-label="Your totals" className="mt-4 grid grid-cols-2 gap-3">
        <Stat
          label="Day streak"
          value={data ? String(data.streak.currentDays) : "..."}
          testId="stat-streak"
        />
        <Stat
          label="Minutes this week"
          value={data ? String(data.minutesThisWeek) : "..."}
          testId="stat-minutes"
        />
      </dl>

      <section aria-label="Estimated mastery by topic" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Estimated mastery by topic</h2>
        <p className="text-ink/70 mt-1 text-xs">
          These are estimates from your answers so far, not test scores. The range shows how sure we
          are.
        </p>

        {/* A table, not a chart: it reads correctly in a screen reader and needs no fallback. */}
        <table className="mt-3 w-full text-left text-xs" data-testid="mastery-table">
          <caption className="sr-only">
            Estimated mastery for each topic, with the estimate range and how many answers it is
            based on
          </caption>
          <thead>
            <tr className="text-ink/70">
              <th scope="col" className="py-2">
                Topic
              </th>
              <th scope="col" className="py-2">
                Band
              </th>
              <th scope="col" className="py-2">
                Estimate
              </th>
              <th scope="col" className="py-2">
                Answers
              </th>
            </tr>
          </thead>
          <tbody>
            {(data?.concepts ?? []).map((c) => (
              <tr key={c.conceptId} className="border-mist border-t">
                <th scope="row" className="py-2 font-normal">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenConcept(openConcept === c.conceptLabel ? null : c.conceptLabel)
                    }
                    aria-expanded={openConcept === c.conceptLabel}
                    className="text-ink underline decoration-dotted"
                  >
                    <BidiText text={c.conceptLabel} />
                  </button>
                </th>
                <td className="py-2">{BAND_LABEL[c.band] ?? c.band}</td>
                <td className="py-2">
                  {/* Always with the word estimated and the range. */}
                  estimated {c.p.toFixed(2)} ({c.lower.toFixed(2)} to {c.upper.toFixed(2)})
                </td>
                <td className="py-2">{c.nEvents}</td>
              </tr>
            ))}
            {data && data.concepts.length === 0 && (
              <tr>
                <td colSpan={4} className="text-ink/70 py-3">
                  Nothing practised yet. Start a mission and this fills in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section aria-label="Why your estimates moved" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Why your estimates moved</h2>
        <ul className="mt-3 flex flex-col gap-2" data-testid="evidence-list">
          {(data?.evidence ?? [])
            .filter((e) => !openConcept || e.conceptLabel === openConcept)
            .slice(0, 20)
            .map((e) => (
              <li key={e.id} className="border-mist rounded-lg border bg-white p-3 text-xs">
                <span className="text-ink font-semibold">
                  <BidiText text={e.conceptLabel} />
                </span>
                <p className="text-ink/70 mt-1">{e.why}</p>
              </li>
            ))}
        </ul>
      </section>

      {data && data.badges.length > 0 && (
        <section aria-label="Your badges" className="mt-8">
          <h2 className="text-ink text-sm font-semibold">Badges</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {data.badges.map((b) => (
              <li
                key={b.code}
                className="border-mist rounded-full border bg-white px-3 py-1 text-xs"
                title={b.description}
              >
                {b.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}): React.JSX.Element {
  return (
    <div className="border-mist rounded-lg border bg-white p-3">
      <dt className="text-ink/70 text-xs">{label}</dt>
      <dd data-testid={testId} className="text-ink text-lg font-semibold">
        {value}
      </dd>
    </div>
  );
}
