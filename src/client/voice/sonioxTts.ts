"use client";

import { SonioxClient } from "@soniox/client";

export interface SonioxBrowserTtsOptions {
  /** The signed sentence, exactly as the engine emitted it. */
  text: string;
  lang: string;
  sig: string;
  exp: number;
  sessionId: string;
  turnId?: string;
  voice?: string;
  language?: string;
}

export interface SonioxBrowserTtsFallback {
  fallback: "browser";
  notice: string;
}

/**
 * Synthesizes one sentence directly from the browser with a temporary Soniox tts_rt key.
 * The key is only issued for a signed speech item, and the server charges the daily seconds
 * cap at issue time, because it never sees the synthesis itself.
 */
export async function synthesizeSonioxBrowser(
  options: SonioxBrowserTtsOptions,
): Promise<Blob | SonioxBrowserTtsFallback> {
  const { text, lang, sig, exp, sessionId, turnId, voice = "default", language } = options;

  const res = await fetch("/api/voice/tts-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang, sig, exp, turnId, sessionId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to obtain temporary Soniox TTS key: ${res.status}`);
  }

  const data = (await res.json()) as {
    apiKey?: string;
    model?: string;
    fallback?: "browser";
    notice?: string;
  };

  if (data.fallback === "browser") {
    return { fallback: "browser", notice: data.notice ?? "Switching to browser voice." };
  }
  if (!data.apiKey) {
    throw new Error("No Soniox API key available for browser TTS.");
  }

  const client = new SonioxClient({
    config: { api_key: data.apiKey },
  });

  const audioBytes = await client.tts.generate({
    text,
    voice,
    model: data.model,
    language: language ?? lang,
    audio_format: "mp3",
  });

  return new Blob([audioBytes as BlobPart], { type: "audio/mpeg" });
}
