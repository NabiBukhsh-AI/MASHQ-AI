"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LibraryItem } from "@/server/ingest/library";
import { useStartPractice } from "@/client/session/useStartPractice";

/**
 * Everything the organization has uploaded, with the journey built from it and how ready that
 * journey is. Filterable by topic, which is the set of concepts the design stage found. Every
 * playable row can be practised from here, or continued where the viewer left off. Learners get
 * the same table (variant "learn"), limited by the API to what they can play.
 *
 * Sharing with named managers and assigning to learners is agreed as the next step (a grant per
 * document from admin to manager, then an assignment from manager to learner). It is not built
 * yet, and nothing here pretends it is.
 */

const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  ur: "Urdu",
  "ur-Latn": "Roman Urdu",
  mixed: "Mixed",
};

const TYPE_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  txt: "Text",
  md: "Markdown",
  paste: "Pasted",
  url: "Web page",
  image: "Image",
};

function readiness(item: LibraryItem): { label: string; tone: "ready" | "partial" | "pending" } {
  if (!item.journey) return { label: "Not designed yet", tone: "pending" };
  const { readyMissions, missions } = item.journey;
  if (missions > 0 && readyMissions === missions)
    return { label: "All missions ready", tone: "ready" };
  // Missions after the first are built on demand when a learner reaches them, so a journey with
  // one ready pack is playable from the start.
  if (readyMissions > 0)
    return { label: `${readyMissions} of ${missions} missions built`, tone: "partial" };
  return { label: "Journey designing", tone: "pending" };
}

export function ContentLibraryTable({
  refreshKey = 0,
  variant = "manage",
}: {
  refreshKey?: number;
  variant?: "manage" | "learn";
}): React.JSX.Element {
  const practice = useStartPractice();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [query, setQuery] = useState("");

  // State is set in the promise callbacks, and a stale response is dropped: a slow first load
  // must not overwrite the list a later refresh already brought back.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/content/list")
      .then(async (res) => {
        if (!res.ok) throw new Error(`The library could not be loaded (status ${res.status}).`);
        return (await res.json()) as { items: LibraryItem[] };
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "The library could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const allTopics = useMemo(
    () => [...new Set((items ?? []).flatMap((i) => i.topics))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (!topic || i.topics.includes(topic)) &&
        (!q ||
          i.title.toLowerCase().includes(q) ||
          i.topics.some((t) => t.toLowerCase().includes(q))),
    );
  }, [items, topic, query]);

  return (
    <section aria-labelledby="library-heading" className="mt-10" data-testid="content-library">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="library-heading" className="text-ink text-lg font-bold">
            {variant === "learn" ? "Practise from the library" : "All content"}
          </h2>
          <p className="text-ink/70 text-sm">
            {items === null
              ? "Loading the library..."
              : variant === "learn"
                ? `${items.length} journey${items.length === 1 ? "" : "s"} ready to practise. Pick one to start, or continue where you left off.`
                : `${items.length} document${items.length === 1 ? "" : "s"} in this organization.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="text-ink/70 flex flex-col text-xs font-medium">
            Search
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title or topic"
              data-testid="library-search"
              className="border-mist text-ink mt-1 rounded-md border bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-ink/70 flex flex-col text-xs font-medium">
            Topic
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              data-testid="library-topic"
              className="border-mist text-ink mt-1 rounded-md border bg-white px-2 py-1.5 text-sm"
            >
              <option value="">All topics</option>
              {allTopics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {(error || practice.error) && (
        <p role="alert" className="text-kattha mt-4 text-sm" data-testid="library-error">
          {error ?? practice.error}
        </p>
      )}

      {items && shown.length === 0 && !error && (
        <p className="text-ink/70 mt-4 text-sm" data-testid="library-empty">
          {items.length === 0
            ? variant === "learn"
              ? "No journeys are ready to practise yet. Check back once your L&D team adds material."
              : "Nothing has been added yet. Upload a document above to start the library."
            : "No documents match that search."}
        </p>
      )}

      {shown.length > 0 && (
        <div className="border-mist mt-4 overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-left text-sm" data-testid="library-table">
            <caption className="sr-only">
              Uploaded documents with their language, journey and readiness
            </caption>
            <thead className="bg-paper text-ink/70 text-xs uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Document
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Language
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Journey
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Topics
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Added
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  <span className="sr-only">Practise</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const r = readiness(item);
                return (
                  <tr key={item.id} className="border-mist border-t align-top">
                    <td className="px-3 py-2">
                      <div className="text-ink font-medium">{item.title}</div>
                      {item.uploadedBy && (
                        <div className="text-ink/70 text-xs">by {item.uploadedBy}</div>
                      )}
                    </td>
                    <td className="text-ink/80 px-3 py-2">
                      {TYPE_LABEL[item.sourceType] ?? item.sourceType}
                    </td>
                    <td className="text-ink/80 px-3 py-2">
                      {item.language
                        ? (LANGUAGE_LABEL[item.language] ?? item.language)
                        : "Not detected"}
                    </td>
                    <td className="px-3 py-2">
                      {item.journey && <div className="text-ink">{item.journey.title}</div>}
                      <span
                        className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-xs ${
                          r.tone === "ready"
                            ? "border-neem/50 bg-neem/10 text-ink"
                            : r.tone === "partial"
                              ? "border-haldi/60 bg-haldi/10 text-ink"
                              : "border-mist bg-paper text-ink/70"
                        }`}
                      >
                        {r.label}
                      </span>
                    </td>
                    <td className="text-ink/80 px-3 py-2">
                      {item.topics.length > 0 ? (
                        <ul className="flex flex-wrap gap-1">
                          {item.topics.slice(0, 4).map((t) => (
                            <li
                              key={t}
                              className="bg-paper border-mist rounded border px-1.5 py-0.5 text-xs"
                            >
                              {t}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-ink/70 text-xs">None yet</span>
                      )}
                    </td>
                    <td className="text-ink/70 px-3 py-2 text-xs whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <PracticeAction item={item} practice={practice} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Continue an unfinished session, or start a new one on any journey with a mission ready.
 * Missions after the first are built while the learner plays, so one ready mission is enough.
 */
function PracticeAction({
  item,
  practice,
}: {
  item: LibraryItem;
  practice: ReturnType<typeof useStartPractice>;
}): React.JSX.Element {
  const cls =
    "bg-neem hover:bg-neem/90 focus:ring-neem inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";
  if (item.resumeSessionId) {
    return (
      <Link
        href={`/learn/sessions/${item.resumeSessionId}`}
        className={cls}
        data-testid="library-continue"
        aria-label={`Continue practising ${item.title}`}
      >
        Continue
      </Link>
    );
  }
  const journey = item.journey;
  if (!journey || journey.readyMissions === 0) {
    return <span className="text-ink/70 text-xs">Not ready yet</span>;
  }
  return (
    <button
      type="button"
      onClick={() => void practice.start(journey.id)}
      disabled={practice.starting !== null}
      className={cls}
      data-testid="library-practise"
      aria-label={`Practise ${item.title}`}
    >
      {practice.starting === journey.id ? "Opening..." : "Practise"}
    </button>
  );
}
