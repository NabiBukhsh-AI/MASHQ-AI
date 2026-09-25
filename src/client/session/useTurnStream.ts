import { useCallback, useEffect, useRef, useState } from "react";
import { TurnEventSchema, type TurnEvent } from "@/lib/schemas/turn-events";

export interface TurnInputBody {
  mode: "text" | "tap" | "drag" | "start" | "voice";
  text?: string;
  answer?: unknown;
  clientTimings?: Record<string, number>;
  interrupted?: boolean;
  heardUntilSentence?: number;
}

export interface SendTurnOptions {
  idempotencyKey?: string;
  onEvent: (event: TurnEvent) => void;
}

/**
 * Streams one turn from POST /api/sessions/[id]/turns and hands each parsed
 * TurnEvent to the caller as it arrives. One turn in flight at a time; abort
 * cancels the request (the server retracts the partial turn).
 */
export function useTurnStream(sessionId: string) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsStreaming(false);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const sendTurn = useCallback(
    async (input: TurnInputBody, { idempotencyKey, onEvent }: SendTurnOptions) => {
      if (controllerRef.current) return { aborted: false, sent: false };
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsStreaming(true);
      setError(null);
      const key = idempotencyKey ?? crypto.randomUUID();
      try {
        const res = await fetch(`/api/sessions/${sessionId}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ input, idempotencyKey: key }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string | { message?: string };
          };
          const msg =
            typeof body.error === "string" ? body.error : (body.error?.message ?? undefined);
          throw new Error(
            msg ??
              (res.status === 409
                ? "The tutor is still answering. Wait a moment, then try again."
                : `The turn failed (status ${res.status}). Try again.`),
          );
        }
        if (!res.body) throw new Error("No response stream. Try again.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let ended = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = TurnEventSchema.safeParse(JSON.parse(line.slice(6)));
              if (!parsed.success) continue;
              onEvent(parsed.data);
              // The server persists after `end`; the UI is free as soon as the turn is complete.
              if (parsed.data.type === "end") {
                ended = true;
                if (controllerRef.current === controller) controllerRef.current = null;
                setIsStreaming(false);
              }
            } catch {
              // a malformed frame is dropped; the server-side protocol guard already flagged it
            }
          }
        }
        // The server retracts a turn that did not reach `end` (network drop, function timeout):
        // the page must not keep a partial reply either.
        if (!ended) return { aborted: true, sent: true };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return { aborted: true, sent: true };
        setError(err instanceof Error ? err.message : "The turn failed. Try again.");
        return { aborted: true, sent: true };
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        setIsStreaming(false);
      }
      return { aborted: false, sent: true };
    },
    [sessionId],
  );

  return { isStreaming, error, sendTurn, abort, clearError: () => setError(null) };
}
