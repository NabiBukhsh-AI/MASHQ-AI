"use client";

import React, { useCallback, useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  actorId: string | null;
  entity: string;
  action: string;
  fromVersion: number | null;
  toVersion: number | null;
  diff: unknown;
  reason: string | null;
  createdAt: string;
}

/** Summarises a JSON Patch into something readable without expanding it. */
function summarise(diff: unknown): string {
  if (!Array.isArray(diff) || diff.length === 0) return "no changes";
  const paths = diff
    .map((op) => (op as { path?: string }).path ?? "")
    .filter(Boolean)
    .map((p) => p.replace(/^\//, "").replace(/\//g, "."));
  const head = paths.slice(0, 3).join(", ");
  return paths.length > 3 ? `${head} and ${paths.length - 3} more` : head;
}

/** The settings audit trail: who changed what, when, and the diff. */
export default function AdminAuditPage(): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/audit");
      if (!res.ok) throw new Error("The audit trail could not be loaded.");
      const body = (await res.json()) as { entries: AuditEntry[] };
      setEntries(body.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The audit trail could not be loaded.");
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

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="admin-audit">
      <h1 className="text-ink text-xl font-bold tracking-tight">Settings audit</h1>
      <p className="text-ink/70 mt-1 text-sm">
        Every settings change, newest first, with who made it and what it changed.
      </p>

      {error && (
        <p role="alert" className="text-kattha mt-4 text-sm">
          {error}
        </p>
      )}

      <table className="mt-6 w-full text-left text-xs" data-testid="audit-table">
        <caption className="sr-only">Settings changes with actor, time and diff</caption>
        <thead>
          <tr className="text-ink/70">
            <th scope="col" className="py-1">
              When
            </th>
            <th scope="col" className="py-1">
              Action
            </th>
            <th scope="col" className="py-1">
              Versions
            </th>
            <th scope="col" className="py-1">
              Changed
            </th>
            <th scope="col" className="py-1">
              Reason
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <React.Fragment key={e.id}>
              <tr className="border-mist border-t">
                <th scope="row" className="py-1 font-normal">
                  {String(e.createdAt).slice(0, 16).replace("T", " ")}
                </th>
                <td className="py-1">{e.action}</td>
                <td className="py-1">
                  {e.fromVersion ?? "-"} to {e.toVersion ?? "-"}
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    aria-expanded={open === e.id}
                    data-testid={`audit-diff-${e.id}`}
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                    className="text-neem underline decoration-dotted"
                  >
                    {summarise(e.diff)}
                  </button>
                </td>
                <td className="py-1">{e.reason ?? ""}</td>
              </tr>
              {open === e.id && (
                <tr>
                  <td colSpan={5} className="py-2">
                    <pre className="bg-paper overflow-x-auto rounded-lg p-2 font-mono text-[10px]">
                      {JSON.stringify(e.diff, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
          {entries.length === 0 && !error && (
            <tr>
              <td colSpan={5} className="text-ink/70 py-3">
                No settings changes recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
