import { describe, it, expect, vi } from "vitest";
import { sseStream } from "./sse";

const decoder = new TextDecoder();

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value);
  }
}

describe("sseStream", () => {
  it("frames data and named events, then closes when run finishes", async () => {
    const res = sseStream(new Request("http://localhost/x"), async (send) => {
      send(JSON.stringify({ a: 1 }));
      send("line1\nline2", "delta");
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await readAll(res);
    expect(text).toBe('data: {"a":1}\n\nevent: delta\ndata: line1\ndata: line2\n\n');
  });

  it("closes cleanly on client abort and signals run to stop", async () => {
    const ac = new AbortController();
    const req = new Request("http://localhost/x", { signal: ac.signal });
    let sawAbort = false;
    let lateSendResult: boolean | undefined;

    const res = sseStream(req, async (send, signal) => {
      send("first");
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      sawAbort = true;
      lateSendResult = send("too late");
    });

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe("data: first\n\n");

    ac.abort();
    const end = await reader.read();
    expect(end.done).toBe(true);
    await vi.waitFor(() => expect(sawAbort).toBe(true));
    expect(lateSendResult).toBe(false);
  });

  it("closes when the consumer cancels the stream", async () => {
    let signalAborted = false;
    const res = sseStream(new Request("http://localhost/x"), async (send, signal) => {
      send("hello");
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      signalAborted = true;
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(signalAborted).toBe(true));
  });

  it("emits an error event when run throws, without leaking the message", async () => {
    const res = sseStream(
      new Request("http://localhost/x"),
      async () => {
        throw new Error("secret detail");
      },
      { requestId: "req-1" },
    );
    const text = await readAll(res);
    expect(text).toContain("event: error");
    expect(text).toContain('"requestId":"req-1"');
    expect(text).not.toContain("secret detail");
  });

  it("sends heartbeat comments while idle", async () => {
    const res = sseStream(
      new Request("http://localhost/x"),
      async (_send, signal) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        void signal;
      },
      { heartbeatMs: 10 },
    );
    const text = await readAll(res);
    expect(text).toContain(": ping\n\n");
  });
});
