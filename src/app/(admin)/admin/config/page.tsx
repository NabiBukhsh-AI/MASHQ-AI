"use client";

import React, { useCallback, useEffect, useState } from "react";

interface ConfigResponse {
  version: number;
  hash: string;
  config: Record<string, unknown>;
  versions: Array<{
    version: number;
    note: string | null;
    createdAt: string;
    isActive: boolean;
  }>;
}

interface FieldError {
  path: string;
  message: string;
}

/** The keys an admin actually touches during a demo, as forms rather than raw JSON. */
const COMMON_FIELDS = [
  {
    path: "grounding.strictness",
    label: "Grounding strictness",
    help: "Strict keeps the tutor to the uploaded material. Assisted allows general knowledge, labelled.",
    options: ["strict", "assisted"],
  },
  {
    path: "language.register",
    label: "Default register",
    help: "How the tutor speaks when a learner has not chosen.",
    options: ["colleague", "formal"],
  },
  {
    path: "voice.output.enabled",
    label: "Speech output",
    help: "Turn all tutor audio off across the organization.",
    options: ["true", "false"],
  },
  {
    path: "voice.input.enabled",
    label: "Speech input",
    help: "Turn the talk button off across the organization.",
    options: ["true", "false"],
  },
  {
    path: "gamification.enabled",
    label: "Gamification",
    help: "XP, streaks and badges.",
    options: ["true", "false"],
  },
] as const;

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function patchFor(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  const root: Record<string, unknown> = {};
  let node = root;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) node[key] = value;
    else {
      node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
  });
  return root;
}

/**
 * Admin settings. Admin only, enforced on the server; this page is the
 * convenience, not the control. Every write states a reason, which lands in the audit trail.
 */
export default function AdminConfigPage(): React.JSX.Element {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [json, setJson] = useState("");
  // A reload must not throw away what the admin has typed into the editor.
  const [jsonDirty, setJsonDirty] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/config");
      if (!res.ok) throw new Error("The settings could not be loaded.");
      const body = (await res.json()) as ConfigResponse;
      setData(body);
      setJson((current) => (jsonDirty ? current : JSON.stringify(body.config, null, 2)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The settings could not be loaded.");
    }
  }, [jsonDirty]);

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

  const write = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      setFieldErrors([]);
      try {
        const res = await fetch("/api/admin/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          version?: number;
          summary?: string;
          error?: { message?: string; details?: FieldError[] };
        };
        if (!res.ok) {
          setFieldErrors(payload.error?.details ?? []);
          throw new Error(payload.error?.message ?? "The settings could not be saved.");
        }
        setMessage(`Saved as version ${payload.version}. ${payload.summary ?? ""}`.trim());
        setJsonDirty(false);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The settings could not be saved.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const rollback = useCallback(
    async (toVersion: number) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/config/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toVersion }),
        });
        if (!res.ok) throw new Error("The rollback did not complete.");
        const body = (await res.json()) as { version: number };
        setMessage(`Rolled back to v${toVersion}, saved as version ${body.version}.`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The rollback did not complete.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8" data-testid="admin-config">
      <h1 className="text-ink text-xl font-bold tracking-tight">Settings</h1>
      <p className="text-ink/70 mt-1 text-sm">
        Active version {data?.version ?? "..."}. Every change is saved as a new version and recorded
        in the audit trail.
      </p>

      <section aria-label="Common settings" className="mt-6 flex flex-col gap-4">
        {COMMON_FIELDS.map((f) => {
          const current = readPath(data?.config, f.path);
          const value = typeof current === "boolean" ? String(current) : String(current ?? "");
          return (
            <div key={f.path} className="border-mist rounded-lg border bg-white p-3">
              <label htmlFor={`field-${f.path}`} className="text-ink block text-sm font-semibold">
                {f.label}
              </label>
              <p className="text-ink/70 mt-0.5 text-xs">{f.help}</p>
              <select
                id={`field-${f.path}`}
                data-testid={`field-${f.path}`}
                value={value}
                disabled={busy || !data}
                onChange={(e) => {
                  const raw = e.target.value;
                  const next = raw === "true" ? true : raw === "false" ? false : raw;
                  void write({
                    patch: patchFor(f.path, next),
                    reason: `${f.label} set to ${raw}`,
                  });
                }}
                className="border-mist mt-2 rounded-lg border px-2 py-1 text-xs"
              >
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </section>

      <section aria-label="Advanced settings" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Advanced</h2>
        <p className="text-ink/70 mt-1 text-xs">
          The whole settings document. It is validated against the schema before anything is saved,
          so a mistake here cannot take the organization down.
        </p>
        <label htmlFor="config-json" className="sr-only">
          Settings JSON
        </label>
        <textarea
          id="config-json"
          data-testid="config-json"
          value={json}
          onChange={(e) => {
            setJson(e.target.value);
            setJsonDirty(true);
          }}
          rows={14}
          spellCheck={false}
          className="border-mist mt-2 w-full rounded-lg border p-2 font-mono text-xs"
        />
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="config-reason" className="sr-only">
            Reason for this change
          </label>
          <input
            id="config-reason"
            data-testid="config-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you changing this?"
            className="border-mist flex-1 rounded-lg border px-2 py-1 text-xs"
          />
          <button
            type="button"
            data-testid="config-save"
            disabled={busy || !reason.trim()}
            onClick={() => {
              try {
                void write({ config: JSON.parse(json), reason: reason.trim() });
              } catch {
                setError("That is not valid JSON. Check the brackets and commas.");
              }
            }}
            className="bg-neem rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </section>

      {fieldErrors.length > 0 && (
        <ul role="alert" data-testid="field-errors" className="text-kattha mt-3 text-xs">
          {fieldErrors.map((f) => (
            <li key={f.path}>
              {f.path}: {f.message}
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role="status" data-testid="config-message" className="text-ink mt-3 text-xs">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="config-error" className="text-kattha mt-3 text-xs">
          {error}
        </p>
      )}

      <section aria-label="Version history" className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Version history</h2>
        <table className="mt-3 w-full text-left text-xs" data-testid="version-history">
          <caption className="sr-only">Every saved settings version, newest first</caption>
          <thead>
            <tr className="text-ink/70">
              <th scope="col" className="py-1">
                Version
              </th>
              <th scope="col" className="py-1">
                Reason
              </th>
              <th scope="col" className="py-1">
                Saved
              </th>
              <th scope="col" className="py-1">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {(data?.versions ?? []).map((v) => (
              <tr key={v.version} className="border-mist border-t">
                <th scope="row" className="py-1 font-normal">
                  v{v.version} {v.isActive ? "(active)" : ""}
                </th>
                <td className="py-1">{v.note ?? ""}</td>
                <td className="py-1">{String(v.createdAt).slice(0, 16).replace("T", " ")}</td>
                <td className="py-1">
                  {!v.isActive && (
                    <button
                      type="button"
                      data-testid={`rollback-${v.version}`}
                      disabled={busy}
                      onClick={() => void rollback(v.version)}
                      className="text-neem underline disabled:opacity-50"
                    >
                      Roll back to this
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
