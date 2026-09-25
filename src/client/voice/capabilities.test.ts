import { describe, it, expect, vi, afterEach } from "vitest";
import {
  chooseModes,
  chooseBrowserFallback,
  hasSystemVoiceFor,
  checkSttSocket,
} from "./capabilities";

const base = {
  microphone: "granted" as const,
  sttSocket: true,
  audio: true,
  systemVoice: true,
  browserStt: true,
  inputEnabled: true,
  outputEnabled: true,
  allowBrowserStt: true,
  lang: "en",
};

describe("chooseModes", () => {
  it("uses the provider when everything is available and says nothing", () => {
    const r = chooseModes(base);
    expect(r.inputMode).toBe("soniox");
    expect(r.outputMode).toBe("server");
    expect(r.notice).toBeNull();
  });

  it("falls back to browser recognition when the network blocks the STT socket", () => {
    const r = chooseModes({ ...base, sttSocket: false });
    expect(r.inputMode).toBe("browser");
    // The learner has to be told their audio leaves for a third party.
    expect(r.notice).toContain("browser vendor");
  });

  it("offers typing when the socket is blocked and the browser cannot listen either", () => {
    const r = chooseModes({ ...base, sttSocket: false, browserStt: false });
    expect(r.inputMode).toBe("none");
    expect(r.notice).toContain("type or tap");
  });

  it("does not use browser recognition when it is not allowed", () => {
    const r = chooseModes({ ...base, sttSocket: false, allowBrowserStt: false });
    expect(r.inputMode).toBe("none");
    expect(r.notice).not.toContain("browser vendor");
  });

  it("offers typing when the microphone is denied, without probing further", () => {
    const r = chooseModes({ ...base, microphone: "denied" });
    expect(r.inputMode).toBe("none");
    expect(r.notice).toContain("type or tap");
  });

  it("keeps captions when the org has speech output off", () => {
    const r = chooseModes({ ...base, outputEnabled: false });
    expect(r.outputMode).toBe("captions");
  });

  it("keeps input working when only output is off", () => {
    const r = chooseModes({ ...base, outputEnabled: false });
    expect(r.inputMode).toBe("soniox");
  });
});

describe("chooseBrowserFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubVoices(langs: string[]) {
    vi.stubGlobal("window", {
      speechSynthesis: { getVoices: () => langs.map((lang) => ({ lang })) },
    });
  }

  it("uses the system voice when one exists for the language", () => {
    stubVoices(["en-US", "ur-PK"]);
    const r = chooseBrowserFallback("ur");
    expect(r.outputMode).toBe("browser");
  });

  it("stays on captions and names the language when no voice exists", () => {
    // The common laptop case: English voices only, Urdu session.
    stubVoices(["en-US", "en-GB"]);
    const r = chooseBrowserFallback("ur");
    expect(r.outputMode).toBe("captions");
    expect(r.notice).toContain("Urdu");
  });

  it("treats Roman Urdu as needing an Urdu voice", () => {
    stubVoices(["en-US"]);
    expect(hasSystemVoiceFor("ur-Latn")).toBe(false);
    stubVoices(["ur-PK"]);
    expect(hasSystemVoiceFor("ur-Latn")).toBe(true);
  });

  it("stays on captions when the browser has no speech synthesis at all", () => {
    vi.stubGlobal("window", {});
    expect(chooseBrowserFallback("en").outputMode).toBe("captions");
  });
});

describe("checkSttSocket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports false when the socket errors, as a blocking proxy does", async () => {
    class BlockedSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: { code: number }) => void) | null = null;
      constructor() {
        setTimeout(() => this.onerror?.(), 0);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", BlockedSocket);
    await expect(checkSttSocket("wss://blocked.test", 50)).resolves.toBe(false);
  });

  it("reports true when the socket opens", async () => {
    class OpenSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: { code: number }) => void) | null = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", OpenSocket);
    await expect(checkSttSocket("wss://ok.test", 50)).resolves.toBe(true);
  });

  it("gives up rather than hanging the session when nothing answers", async () => {
    class SilentSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: { code: number }) => void) | null = null;
      close() {}
    }
    vi.stubGlobal("WebSocket", SilentSocket);
    await expect(checkSttSocket("wss://silent.test", 30)).resolves.toBe(false);
  });
});
