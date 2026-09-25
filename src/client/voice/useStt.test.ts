import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStt, mapSttError, defaultGetSttKey, type SttKeyResponse } from "./useStt";

// Mock Soniox client classes
const mockRecording = {
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: vi.fn(function (this: any, event: string, handler: (...args: any[]) => void) {
    this._handlers = this._handlers || {};
    this._handlers[event] = handler;
    return this;
  }),
  _handlers: {} as Record<string, (...args: unknown[]) => void>,
  emit(event: string, ...args: unknown[]) {
    this._handlers[event]?.(...args);
  },
};

const mockRecord = vi.fn((_opts?: unknown) => mockRecording);
const mockMicrophoneSource = vi.fn((_opts?: unknown) => undefined);
const mockSonioxClient = vi.fn((_config?: unknown) => ({
  realtime: {
    record: mockRecord,
  },
}));

vi.mock("@soniox/client", () => ({
  SonioxClient: class {
    constructor(config?: unknown) {
      mockSonioxClient(config);
    }
    realtime = {
      record: (opts?: unknown) => mockSonioxClient().realtime.record(opts),
    };
  },
  MicrophoneSource: class {
    constructor(opts?: unknown) {
      mockMicrophoneSource(opts);
    }
  },
}));

describe("useStt speech-to-text hook & helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecording._handlers = {};
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("mapSttError", () => {
    it("maps permission errors to clear instruction to allow microphone or use text", () => {
      const err = new Error("Permission denied by user");
      err.name = "NotAllowedError";
      const message = mapSttError(err);
      expect(message).toContain("Microphone access was denied");
      expect(message).toContain("text reply box");
    });

    it("maps device not found errors to connect microphone message", () => {
      const err = new Error("Requested device not found");
      err.name = "NotFoundError";
      const message = mapSttError(err);
      expect(message).toContain("No microphone found");
    });

    it("maps unsupported audio to browser capability message", () => {
      const err = new Error("getUserMedia is not supported");
      err.name = "AudioUnavailableError";
      const message = mapSttError(err);
      expect(message).toContain("not supported on this browser");
    });

    it("maps rate limit error to wait message", () => {
      const err = new Error("RATE_LIMITED: 8 requests per minute");
      const message = mapSttError(err);
      expect(message).toContain("Voice key rate limit reached");
    });

    it("maps generic unexpected error to fallback message", () => {
      const message = mapSttError(new Error("socket crash"));
      expect(message).toContain("Voice input is currently unavailable");
    });
  });

  describe("defaultGetSttKey", () => {
    it("fetches key with sessionId and contentId query parameters", async () => {
      let requestedUrl = "";
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        requestedUrl = input.toString();
        return new Response(
          JSON.stringify({
            apiKey: "temp_stt_key_123",
            expiresAt: 123456789,
            config: { model: "stt-rt-v5" },
          }),
          { status: 200 },
        );
      });

      const res = await defaultGetSttKey("sess-1", "cont-1");
      expect(requestedUrl).toContain("/api/voice/stt-key?sessionId=sess-1&contentId=cont-1");
      expect(res.apiKey).toBe("temp_stt_key_123");
      expect(res.config?.model).toBe("stt-rt-v5");
    });

    it("throws clear error on 401 Unauthorized", async () => {
      globalThis.fetch = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
      await expect(defaultGetSttKey()).rejects.toThrow("Sign in to use voice input.");
    });

    it("throws clear error on 429 Rate Limited", async () => {
      globalThis.fetch = vi.fn(async () => new Response("Rate limit", { status: 429 }));
      await expect(defaultGetSttKey()).rejects.toThrow("Voice key limit exceeded");
    });
  });

  describe("useStt Hook Behavior", () => {
    it("configures MicrophoneSource with noise suppression and echo cancellation constraints", async () => {
      const fakeGetKey = vi.fn(async (): Promise<SttKeyResponse> => ({
        apiKey: "test_key",
        config: { model: "stt-rt-v5", language_hints: ["ur", "en"] },
      }));

      // Test component exercising useStt
      let hookReturn: ReturnType<typeof useStt> | null = null;
      function TestComponent() {
        hookReturn = useStt({ getKey: fakeGetKey });
        return React.createElement("div", null, hookReturn.state);
      }

      renderToStaticMarkup(React.createElement(TestComponent));
      expect(hookReturn).not.toBeNull();
      expect(hookReturn!.state).toBe("idle");

      // Execute start
      await hookReturn!.start();

      expect(fakeGetKey).toHaveBeenCalled();
      expect(mockMicrophoneSource).toHaveBeenCalledWith(
        expect.objectContaining({
          constraints: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
      );
      expect(mockRecord).toHaveBeenCalled();
    });

    it("updates partial and final transcripts when receiving token and result events", async () => {
      const onPartial = vi.fn();
      const onFinal = vi.fn();

      let hookReturn: ReturnType<typeof useStt> | null = null;
      function TestComponent() {
        hookReturn = useStt({
          getKey: async () => ({ apiKey: "k1" }),
          onPartial,
          onFinal,
        });
        return React.createElement("div", null, hookReturn.state);
      }

      renderToStaticMarkup(React.createElement(TestComponent));
      await hookReturn!.start();

      // Emit language token
      mockRecording.emit("token", { text: "Salam", language: "ur", is_final: false });

      // Emit partial result
      mockRecording.emit("result", {
        tokens: [
          { text: "Assalam ", is_final: true },
          { text: "o Alaikum", is_final: false },
        ],
      });

      expect(onPartial).toHaveBeenCalledWith("o Alaikum", "ur");
      expect(onFinal).toHaveBeenCalledWith("Assalam ", "ur");

      // Stop recording
      await hookReturn!.stop();
      expect(mockRecording.stop).toHaveBeenCalled();
    });

    it("triggers onEndpoint and stops recording in hands-free mode", async () => {
      const onEndpoint = vi.fn();

      let hookReturn: ReturnType<typeof useStt> | null = null;
      function TestComponent() {
        hookReturn = useStt({
          getKey: async () => ({ apiKey: "k2" }),
          mode: "hands_free",
          onEndpoint,
        });
        return React.createElement("div", null, hookReturn.state);
      }

      renderToStaticMarkup(React.createElement(TestComponent));
      await hookReturn!.start();

      // Emit final result
      mockRecording.emit("result", {
        tokens: [{ text: "Mera CNIC verify karein", is_final: true }],
      });

      // Emit endpoint event
      mockRecording.emit("endpoint");

      expect(onEndpoint).toHaveBeenCalledWith("Mera CNIC verify karein", undefined);
      expect(mockRecording.stop).toHaveBeenCalled();
    });

    it("never opens the microphone when the button is released while the key is fetched", async () => {
      // The release used to find nothing to stop, and the key then arrived and opened a
      // microphone nobody was holding, with no way left to close it.
      let giveKey: (k: SttKeyResponse) => void = () => undefined;
      const slowKey = () => new Promise<SttKeyResponse>((resolve) => (giveKey = resolve));

      let hookReturn: ReturnType<typeof useStt> | null = null;
      function TestComponent() {
        hookReturn = useStt({ getKey: slowKey });
        return React.createElement("div", null, hookReturn.state);
      }

      renderToStaticMarkup(React.createElement(TestComponent));
      const starting = hookReturn!.start();
      await hookReturn!.stop();
      giveKey({ apiKey: "late" });
      await starting;

      expect(mockMicrophoneSource).not.toHaveBeenCalled();
      expect(mockRecord).not.toHaveBeenCalled();
    });

    it("turns on endpoint detection only in hands free", async () => {
      const recordWith = async (mode: "hands_free" | "push_to_talk") => {
        let hookReturn: ReturnType<typeof useStt> | null = null;
        function TestComponent() {
          hookReturn = useStt({ getKey: async () => ({ apiKey: "k" }), mode });
          return React.createElement("div", null, hookReturn.state);
        }
        renderToStaticMarkup(React.createElement(TestComponent));
        await hookReturn!.start();
        return mockRecord.mock.calls.at(-1)?.[0] as { enable_endpoint_detection?: boolean };
      };
      expect((await recordWith("hands_free")).enable_endpoint_detection).toBe(true);
      expect((await recordWith("push_to_talk")).enable_endpoint_detection).toBe(false);
    });

    it("does not submit on an endpoint in push-to-talk, so the turn is not sent twice", async () => {
      const onEndpoint = vi.fn();

      let hookReturn: ReturnType<typeof useStt> | null = null;
      function TestComponent() {
        hookReturn = useStt({
          getKey: async () => ({ apiKey: "k3" }),
          mode: "push_to_talk",
          onEndpoint,
        });
        return React.createElement("div", null, hookReturn.state);
      }

      renderToStaticMarkup(React.createElement(TestComponent));
      await hookReturn!.start();

      // Soniox is not asked for endpoints at all in push-to-talk.
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ enable_endpoint_detection: false }),
      );

      mockRecording.emit("result", {
        tokens: [{ text: "Raast is", is_final: true }],
      });
      mockRecording.emit("endpoint");

      // The button release submits instead; an endpoint must not, or the learner sends
      // a half sentence and then the whole one.
      expect(onEndpoint).not.toHaveBeenCalled();
      expect(mockRecording.stop).not.toHaveBeenCalled();
    });

    it("focuses the text box when the microphone is denied via the SDK error event", async () => {
      // This suite runs without a DOM, so stand in a minimal document for the focus call.
      const focus = vi.fn();
      const getElementById = vi.fn(() => ({ focus }));
      (globalThis as { document?: unknown }).document = { getElementById };

      try {
        let hookReturn: ReturnType<typeof useStt> | null = null;
        function TestComponent() {
          hookReturn = useStt({ getKey: async () => ({ apiKey: "k4" }) });
          return React.createElement("div", null, hookReturn.state);
        }

        renderToStaticMarkup(React.createElement(TestComponent));
        await hookReturn!.start();

        // The SDK swallows the microphone rejection and re-emits it here, so this is the
        // only path a real permission denial ever takes.
        const permError = new Error("Permission denied");
        permError.name = "NotAllowedError";
        mockRecording.emit("error", permError);

        expect(getElementById).toHaveBeenCalledWith("session-composer-input");
        expect(focus).toHaveBeenCalled();
      } finally {
        delete (globalThis as { document?: unknown }).document;
      }
    });
    it("handles permission denial error and maps message", async () => {
      const onError = vi.fn();
      const onStateChange = vi.fn();

      const permError = new Error("Not allowed");
      permError.name = "NotAllowedError";

      let hookReturn: ReturnType<typeof useStt> | null = null;
      function TestComponent() {
        hookReturn = useStt({
          getKey: async () => {
            throw permError;
          },
          onError,
          onStateChange,
        });
        return React.createElement("div", null, hookReturn.state);
      }

      renderToStaticMarkup(React.createElement(TestComponent));
      await hookReturn!.start();

      expect(onStateChange).toHaveBeenCalledWith("listening");
      expect(onStateChange).toHaveBeenCalledWith("error");
      expect(onError).toHaveBeenCalledWith(
        permError,
        expect.stringContaining("Microphone access was denied"),
      );
    });
  });
});
