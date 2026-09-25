"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Opens a practice session on a journey and goes to it. One path for every "start" button:
 * the upload screen on /learn and /library, and each row of the library.
 *
 * /library used to render the upload screen without any start handler, so its
 * "Start Mission 1" button did nothing at all, and /learn swallowed a failed start into the
 * console. A failure here is shown to the person who pressed the button.
 */
export function useStartPractice(): {
  start: (journeyId: string, options?: { personaId?: string; language?: string }) => Promise<void>;
  /** The journey being opened, so only its button shows progress. */
  starting: string | null;
  error: string | null;
} {
  const router = useRouter();
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (journeyId: string, options: { personaId?: string; language?: string } = {}) => {
      setStarting(journeyId);
      setError(null);
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journeyId, ...options }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(
            body.error?.message || `The session could not start (status ${res.status}). Try again.`,
          );
        }
        const { sessionId } = (await res.json()) as { sessionId: string };
        // Left set: the button stays busy until the session page replaces this one.
        router.push(`/learn/sessions/${sessionId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The session could not start. Try again.");
        setStarting(null);
      }
    },
    [router],
  );

  return { start, starting, error };
}
