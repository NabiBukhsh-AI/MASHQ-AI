"use client";

import { hasSystemVoiceFor } from "./capabilities";

/**
 * Browser speech as the last resort for both directions.
 *
 * Input uses webkitSpeechRecognition, which sends audio to the browser vendor rather than to
 * our providers. Callers must say so in the UI before starting it.
 * Output uses speechSynthesis, which needs a system voice for the language. Urdu voices are
 * missing on most laptops, so the caller falls back to captions when this refuses.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

export interface BrowserSttHandle {
  stop: () => void;
}

export interface BrowserSttOptions {
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
}

/** The sentence the UI must show before browser recognition starts. */
export const BROWSER_STT_DISCLOSURE =
  "Your browser's own speech recognition is being used, which sends your audio to your browser vendor rather than to this app.";

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return (ctor as (new () => SpeechRecognitionLike) | undefined) ?? null;
}

export function startBrowserStt(options: BrowserSttOptions = {}): BrowserSttHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  // Roman Urdu is spoken Urdu, so the recogniser wants the Urdu locale either way.
  recognition.lang = options.lang?.startsWith("ur") ? "ur-PK" : (options.lang ?? "en-US");
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event: unknown) => {
    const e = event as {
      results?: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }>;
    };
    const results = e.results;
    if (!results) return;
    let partial = "";
    let final = "";
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const text = result?.[0]?.transcript ?? "";
      if (result?.isFinal) final += text;
      else partial += text;
    }
    if (partial) options.onPartial?.(partial);
    if (final) options.onFinal?.(final);
  };

  recognition.onerror = (event: unknown) => {
    const code = (event as { error?: string }).error ?? "unknown";
    options.onError?.(
      code === "not-allowed"
        ? "Microphone access was denied. You can type your reply instead."
        : "Your browser could not recognise that. You can type your reply instead.",
    );
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
    },
  };
}

export interface BrowserTtsHandle {
  cancel: () => void;
}

/**
 * Speaks one sentence with a system voice. Returns null when no voice exists for the
 * language, which is the signal to stay on captions rather than play nothing.
 */
export function speakWithBrowser(
  text: string,
  lang: string,
  onEnd?: () => void,
): BrowserTtsHandle | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (!text.trim()) return null;
  if (!hasSystemVoiceFor(lang)) return null;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang.startsWith("ur") ? "ur-PK" : lang;
  const base = lang.toLowerCase().split("-")[0];
  const target = base === "ur" || lang === "ur-Latn" ? "ur" : base;
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang?.toLowerCase().startsWith(target ?? ""));
  if (voice) utterance.voice = voice;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    return null;
  }

  return {
    cancel: () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // nothing queued
      }
    },
  };
}
