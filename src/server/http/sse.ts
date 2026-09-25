import { log } from "../obs/logger";
import { getRequestId } from "../obs/request-context";

export type SseSend = (data: string, event?: string) => boolean;

export interface SseOptions {
  requestId?: string;
  /** Comment frames keep proxies from closing idle streams. */
  heartbeatMs?: number;
}

const encoder = new TextEncoder();

function frame(data: string, event?: string): Uint8Array {
  const lines = data.split(/\r?\n/).map((l) => `data: ${l}`);
  return encoder.encode(`${event ? `event: ${event}\n` : ""}${lines.join("\n")}\n\n`);
}

/**
 * Server-sent events over a ReadableStream. `run` receives `send` and an
 * AbortSignal that fires when the client disconnects or the request is
 * aborted; long work (model calls) must pass that signal along. `send`
 * returns false once the stream is closed, so late writes are harmless.
 */
export function sseStream(
  req: Request,
  run: (send: SseSend, signal: AbortSignal) => Promise<void>,
  opts: SseOptions = {},
): Response {
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const requestId = opts.requestId ?? getRequestId();
  const abort = new AbortController();
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    abort.abort();
    try {
      controller?.close();
    } catch {
      // already closed by the consumer
    }
  };

  const send: SseSend = (data, event) => {
    if (closed || !controller) return false;
    try {
      controller.enqueue(frame(data, event));
      return true;
    } catch {
      close();
      return false;
    }
  };

  req.signal.addEventListener("abort", close, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          c.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, heartbeatMs);

      void run(send, abort.signal)
        .catch((err: unknown) => {
          if (abort.signal.aborted) return;
          log.error({ event: "sse_run_error", err });
          send(JSON.stringify({ code: "INTERNAL_ERROR", requestId }), "error");
        })
        .finally(close);
    },
    cancel() {
      // Consumer went away (client disconnect on the platform, reader.cancel in tests).
      close();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (requestId) headers["x-request-id"] = requestId;
  return new Response(stream, { headers });
}
