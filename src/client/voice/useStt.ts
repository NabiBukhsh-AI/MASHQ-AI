"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { SonioxClient, MicrophoneSource } from "@soniox/client";

export type SttMode = "push_to_talk" | "hands_free";
export type SttState = "idle" | "listening" | "recognizing" | "stopping" | "error";

export interface SttKeyResponse {
  apiKey: string;
  expiresAt?: string | number;
  config?: {
    model?: string;
    language_hints?: string[];
    languageHints?: string[];
    language_hints_strict?: boolean;
    enable_language_identification?: boolean;
    enable_endpoint_detection?: boolean;
    context?: {
      terms?: string[];
    };
  };
}

export interface UseSttOptions {
  getKey?: () => Promise<SttKeyResponse>;
  sessionId?: string;
  contentId?: string;
  hints?: string[];
  context?: { terms?: string[] };
  mode?: SttMode;
  onPartial?: (text: string, lang?: string) => void;
  onFinal?: (text: string, lang?: string) => void;
  onEndpoint?: (text: string, lang?: string) => void;
  onError?: (error: Error, userMessage: string) => void;
  onStateChange?: (state: SttState) => void;
}

export interface UseSttReturn {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  partial: string;
  final: string;
  detectedLang?: string;
  state: SttState;
  error: string | null;
  mode: SttMode;
  clear: () => void;
}

/**
 * Maps audio and capability errors to clear, friendly user messages.
 */
export function mapSttError(err: unknown): string {
  if (!err) return "An unknown speech recognition error occurred.";
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);

  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "AudioPermissionError" ||
    msg.toLowerCase().includes("permission") ||
    msg.toLowerCase().includes("not allowed")
  ) {
    return "Microphone access was denied. Please allow microphone access in your browser or use the text reply box.";
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "AudioDeviceError" ||
    msg.toLowerCase().includes("not found") ||
    msg.toLowerCase().includes("no microphone")
  ) {
    return "No microphone found. Please connect a microphone or use the text reply box.";
  }

  if (
    name === "AudioUnavailableError" ||
    name === "NotSupportedError" ||
    msg.toLowerCase().includes("not supported")
  ) {
    return "Audio recording is not supported on this browser or connection is insecure.";
  }

  if (msg.includes("limit exceeded") || msg.includes("RATE_LIMITED")) {
    return "Voice key rate limit reached. Please wait a moment or type your answer.";
  }

  if (msg.includes("Sign in") || msg.includes("UNAUTHORIZED")) {
    return "Please sign in to use voice features.";
  }

  return "Voice input is currently unavailable. You can type your reply.";
}

/**
 * Default function to fetch a temporary STT API key and config from the server.
 */
export async function defaultGetSttKey(
  sessionId?: string,
  contentId?: string,
): Promise<SttKeyResponse> {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  if (contentId) params.set("contentId", contentId);
  const query = params.toString() ? `?${params.toString()}` : "";

  const res = await fetch(`/api/voice/stt-key${query}`, { method: "POST" });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Sign in to use voice input.");
    }
    if (res.status === 429) {
      throw new Error("Voice key limit exceeded. Please wait a moment.");
    }
    throw new Error("Failed to obtain voice session key.");
  }
  return res.json();
}

/**
 * Speech-to-text hook wrapping Soniox client SDK with push-to-talk,
 * hands-free endpointing, live captions, and error fallback to text input.
 */
/**
 * A denied microphone leaves the learner with no way to answer, so move focus to the
 * text box. The Soniox SDK reports this as an error event, not a rejected promise.
 */
function focusComposerOnDenial(userMsg: string): void {
  if (!userMsg.includes("denied") && !userMsg.includes("allow microphone")) return;
  if (typeof document === "undefined") return;
  document.getElementById("session-composer-input")?.focus();
}

export function useStt(options: UseSttOptions = {}): UseSttReturn {
  const {
    getKey,
    sessionId,
    contentId,
    hints,
    context,
    mode = "push_to_talk",
    onPartial,
    onFinal,
    onEndpoint,
    onError,
    onStateChange,
  } = options;

  // The mode follows the option on every render. It used to be copied into state once, so
  // turning hands free on in the composer never reached the recognizer: endpoint detection
  // stayed off and a pause never sent anything.
  const [state, setState] = useState<SttState>("idle");
  const [partial, setPartial] = useState("");
  const [final, setFinal] = useState("");
  const [detectedLang, setDetectedLang] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  type ActiveRecording = ReturnType<SonioxClient["realtime"]["record"]>;
  const recordingRef = useRef<ActiveRecording | null>(null);
  const accumulatedFinalRef = useRef("");
  const partialRef = useRef("");
  const detectedLangRef = useRef<string | undefined>(undefined);
  // Bumped by every start and stop. A start that finds it changed after fetching its key was
  // cancelled while it waited: releasing the button during that wait used to find nothing to
  // stop, and the microphone then opened with no one holding it and no way to close it.
  const runRef = useRef(0);

  useEffect(() => {
    partialRef.current = partial;
  }, [partial]);

  useEffect(() => {
    detectedLangRef.current = detectedLang;
  }, [detectedLang]);

  const updateState = useCallback(
    (newState: SttState) => {
      setState(newState);
      onStateChange?.(newState);
    },
    [onStateChange],
  );

  const clear = useCallback(() => {
    setPartial("");
    setFinal("");
    accumulatedFinalRef.current = "";
    partialRef.current = "";
    setError(null);
  }, []);

  const stop = useCallback(async () => {
    runRef.current++;
    if (!recordingRef.current) {
      updateState("idle");
      return;
    }
    updateState("stopping");
    try {
      await recordingRef.current.stop();
    } catch {
      // Ignore stop errors if session already terminated
    } finally {
      recordingRef.current = null;
      updateState("idle");
    }
  }, [updateState]);

  const start = useCallback(async () => {
    if (state === "listening" || state === "recognizing") return;
    setError(null);
    clear();
    updateState("listening");
    const run = ++runRef.current;

    try {
      const keyData = await (getKey ? getKey() : defaultGetSttKey(sessionId, contentId));
      if (run !== runRef.current) return;
      const apiKey = keyData.apiKey;
      const serverConfig = keyData.config;

      // Microphone audio capture with constraints: echo cancellation, noise suppression, auto gain
      const source = new MicrophoneSource({
        constraints: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const client = new SonioxClient({
        config: { api_key: apiKey },
      });

      const combinedTerms = [...(serverConfig?.context?.terms || []), ...(context?.terms || [])];

      const recording = client.realtime.record({
        source,
        model: serverConfig?.model || "stt-rt-v5",
        language_hints: hints ||
          serverConfig?.language_hints ||
          serverConfig?.languageHints || ["ur", "en"],
        // The server sets these from the session's practice language: an English session is
        // English only and strict, or accented English came back in Urdu script.
        language_hints_strict: serverConfig?.language_hints_strict ?? false,
        enable_language_identification: serverConfig?.enable_language_identification ?? true,
        enable_endpoint_detection: mode === "hands_free",
        context: combinedTerms.length > 0 ? { terms: combinedTerms } : undefined,
      });

      recordingRef.current = recording;

      recording.on("token", (rawToken: unknown) => {
        const t = rawToken as { language?: string };
        if (t?.language) {
          detectedLangRef.current = t.language;
          setDetectedLang(t.language);
        }
      });

      recording.on("result", (rawRes: unknown) => {
        updateState("recognizing");
        const res = rawRes as {
          tokens?: Array<{ text?: string; is_final?: boolean }>;
        };
        const tokens = res?.tokens || [];
        const currentPartial = tokens
          .filter((t) => !t.is_final)
          .map((t) => t.text || "")
          .join("");

        const currentFinal = tokens
          .filter((t) => t.is_final)
          .map((t) => t.text || "")
          .join("");

        if (currentPartial) {
          partialRef.current = currentPartial;
          setPartial(currentPartial);
          onPartial?.(currentPartial, detectedLangRef.current);
        }
        if (currentFinal) {
          accumulatedFinalRef.current += currentFinal;
          setFinal(accumulatedFinalRef.current);
          onFinal?.(accumulatedFinalRef.current, detectedLangRef.current);
        }
      });

      recording.on("endpoint", () => {
        // Only hands-free submits on an endpoint. In push-to-talk the button release
        // submits, and firing here too would send the turn twice.
        if (mode !== "hands_free") return;
        const full = (accumulatedFinalRef.current + " " + partialRef.current).trim();
        onEndpoint?.(full, detectedLangRef.current);
        stop();
      });

      recording.on("error", (rawErr: unknown) => {
        const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
        const userMsg = mapSttError(err);
        setError(userMsg);
        updateState("error");
        onError?.(err, userMsg);
        focusComposerOnDenial(userMsg);
      });
    } catch (err) {
      const userMsg = mapSttError(err);
      setError(userMsg);
      updateState("error");
      onError?.(err instanceof Error ? err : new Error(String(err)), userMsg);

      focusComposerOnDenial(userMsg);
    }
  }, [
    state,
    clear,
    updateState,
    getKey,
    sessionId,
    contentId,
    hints,
    context,
    onPartial,
    onFinal,
    onEndpoint,
    onError,
    mode,
    stop,
  ]);

  // Cleanup recording when component unmounts
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        try {
          recordingRef.current.stop();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  return {
    start,
    stop,
    partial,
    final,
    detectedLang,
    state,
    error,
    mode,
    clear,
  };
}
