"use client";

/**
 * Capability detection for the voice pipeline.
 *
 * Office laptops and bank networks break voice in predictable ways: the WebSocket to the STT
 * host is blocked, the microphone is denied by policy, or no Urdu system voice is installed.
 * The session has to keep working in every one of those cases, so this decides what to offer
 * and, just as importantly, what to tell the learner.
 */

export type SpeechInputMode = "soniox" | "browser" | "none";
export type SpeechOutputMode = "server" | "browser" | "captions";

export interface VoiceCapabilities {
  microphone: "granted" | "denied" | "prompt" | "unavailable";
  /** The STT provider needs a WebSocket; corporate proxies often block it. */
  sttSocket: boolean;
  audio: boolean;
  /** A system voice exists for the session language. */
  systemVoice: boolean;
  inputMode: SpeechInputMode;
  outputMode: SpeechOutputMode;
  /** Plain sentence for the learner explaining any downgrade, or null when all is well. */
  notice: string | null;
}

export interface DetectOptions {
  lang?: string;
  /** Host to probe for the STT WebSocket. */
  sttUrl?: string;
  timeoutMs?: number;
  /** Set false when the org has turned speech input off. */
  inputEnabled?: boolean;
  outputEnabled?: boolean;
  /** Allow browser speech recognition as a last resort. It sends audio to the browser vendor. */
  allowBrowserStt?: boolean;
}

const STT_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

export function hasBrowserSpeechRecognition(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * True when the browser has a voice that can read this language. Urdu voices are missing on
 * most Windows laptops, which is the case that matters here.
 */
export function hasSystemVoiceFor(lang: string): boolean {
  if (!hasSpeechSynthesis()) return false;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = window.speechSynthesis.getVoices();
  } catch {
    return false;
  }
  if (voices.length === 0) return false;
  const base = lang.toLowerCase().split("-")[0];
  // Roman Urdu is written in Latin script but spoken as Urdu.
  const target = base === "ur" || lang === "ur-Latn" ? "ur" : base;
  return voices.some((v) => v.lang?.toLowerCase().startsWith(target ?? ""));
}

async function checkMicrophone(): Promise<VoiceCapabilities["microphone"]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unavailable";
  }
  // Query first: it does not prompt, so detection never steals a permission dialog.
  try {
    const status = await navigator.permissions?.query({
      name: "microphone" as PermissionName,
    });
    if (status?.state === "granted") return "granted";
    if (status?.state === "denied") return "denied";
    return "prompt";
  } catch {
    // Firefox and Safari do not support the microphone permission name.
    return "prompt";
  }
}

/** Opens the STT WebSocket briefly to see whether the network allows it at all. */
export function checkSttSocket(url: string = STT_URL, timeoutMs = 2000): Promise<boolean> {
  if (typeof WebSocket === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      try {
        socket.close();
      } catch {
        // already closing
      }
    };
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      done(true);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      done(false);
    };
    socket.onclose = (e) => {
      clearTimeout(timer);
      // A clean close before open still means the network let us reach the host.
      done(e.code === 1000);
    };
  });
}

/**
 * Picks the best input and output modes available, and the sentence explaining any downgrade.
 * Pure given its inputs, so the decision is testable without a browser.
 */
export function chooseModes(input: {
  microphone: VoiceCapabilities["microphone"];
  sttSocket: boolean;
  audio: boolean;
  systemVoice: boolean;
  browserStt: boolean;
  inputEnabled: boolean;
  outputEnabled: boolean;
  allowBrowserStt: boolean;
  lang: string;
}): Pick<VoiceCapabilities, "inputMode" | "outputMode" | "notice"> {
  const notices: string[] = [];

  let inputMode: SpeechInputMode = "soniox";
  if (!input.inputEnabled) {
    inputMode = "none";
  } else if (input.microphone === "denied") {
    inputMode = "none";
    notices.push("Microphone access is blocked, so you can type or tap instead.");
  } else if (input.microphone === "unavailable") {
    inputMode = "none";
    notices.push("This device has no microphone, so you can type or tap instead.");
  } else if (!input.sttSocket) {
    if (input.allowBrowserStt && input.browserStt) {
      inputMode = "browser";
      notices.push(
        "Voice input is blocked on this network, so we are using your browser's own speech recognition. It sends your audio to your browser vendor.",
      );
    } else {
      inputMode = "none";
      notices.push("Voice input is blocked on this network. You can type or tap.");
    }
  }

  let outputMode: SpeechOutputMode = "server";
  if (!input.outputEnabled) {
    outputMode = "captions";
  } else if (!input.audio) {
    outputMode = "captions";
    notices.push("Audio is unavailable on this device, so captions stay on.");
  }

  return {
    inputMode,
    outputMode,
    notice: notices.length > 0 ? notices.join(" ") : null,
  };
}

/**
 * Chosen when the server says it cannot synthesize and the browser must take over. Separate
 * from chooseModes because it only matters once a fallback has actually been signalled.
 */
export function chooseBrowserFallback(lang: string): {
  outputMode: SpeechOutputMode;
  notice: string;
} {
  if (hasSystemVoiceFor(lang)) {
    return {
      outputMode: "browser",
      notice: "Using your device's voice for now. The captions stay on.",
    };
  }
  const label = lang.startsWith("ur") ? "Urdu" : "this language";
  return {
    outputMode: "captions",
    notice: `Your device has no ${label} voice, so keep reading the captions.`,
  };
}

export async function detectVoiceCapabilities(
  opts: DetectOptions = {},
): Promise<VoiceCapabilities> {
  const lang = opts.lang ?? "en";
  const inputEnabled = opts.inputEnabled ?? true;
  const outputEnabled = opts.outputEnabled ?? true;

  const microphone = await checkMicrophone();
  // Do not probe the socket when input is off or the microphone is already refused.
  const sttSocket =
    inputEnabled && microphone !== "denied" && microphone !== "unavailable"
      ? await checkSttSocket(opts.sttUrl, opts.timeoutMs)
      : false;

  const audio = typeof window !== "undefined" && typeof window.Audio !== "undefined";
  const systemVoice = hasSystemVoiceFor(lang);

  const modes = chooseModes({
    microphone,
    sttSocket,
    audio,
    systemVoice,
    browserStt: hasBrowserSpeechRecognition(),
    inputEnabled,
    outputEnabled,
    allowBrowserStt: opts.allowBrowserStt ?? true,
    lang,
  });

  return { microphone, sttSocket, audio, systemVoice, ...modes };
}
