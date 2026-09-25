import { useCallback, useState } from "react";

export interface SessionControlsInput {
  persona?: string;
  language?: string;
  register?: "colleague" | "formal";
  modality?: "text" | "voice";
  preset?: string;
}

export interface AppliedSwitch {
  kind: string;
  to: string;
  reason: string;
}

/** POST /api/sessions/[id]/controls: live persona, language, register, modality and preset switches. */
export function useSessionControls(sessionId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (controls: SessionControlsInput): Promise<AppliedSwitch[]> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/controls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(controls),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(body.error?.message ?? "The setting did not save. Try again.");
        }
        const data = (await res.json()) as { applied: AppliedSwitch[] };
        return data.applied;
      } catch (err) {
        setError(err instanceof Error ? err.message : "The setting did not save. Try again.");
        return [];
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  return { apply, busy, error };
}
