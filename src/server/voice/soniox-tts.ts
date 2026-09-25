import { env } from "@/env";
import { log } from "../obs/logger";
import type { SynthesizeAudioResult } from "./uplift";

export interface SonioxTtsOptions {
  model?: string;
  language?: string;
  audioFormat?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Synthesizes speech using the Soniox REST TTS endpoint.
 * Host and path match the vendored SDK (TtsRestClient posts to `/tts`).
 */
export async function synthesizeSonioxServer(
  text: string,
  voice: string,
  options: SonioxTtsOptions = {},
): Promise<SynthesizeAudioResult> {
  const apiKey = env.SONIOX_API_KEY;
  if (!apiKey) {
    throw new Error("SONIOX_API_KEY is not configured.");
  }

  const endpoint = "https://tts-rt.soniox.com/tts";
  const model = options.model;
  const audioFormat = options.audioFormat || "mp3";
  const timeoutMs = options.timeoutMs ?? 1500;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Soniox TTS timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      controller.abort(options.signal?.reason);
    });
  }

  const startTime = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice,
        model,
        language: options.language,
        audio_format: audioFormat,
      }),
      signal: controller.signal,
    });

    const ttfb = performance.now();
    const ttfbMs = Math.round(ttfb - startTime);
    // The budget is time to FIRST BYTE. Headers are here, so stop the
    // clock: a slow body transfer must not look like a dead provider and trigger a
    // failover that pays a second provider for the same sentence.
    clearTimeout(timeoutId);

    if (!res.ok) {
      let errText = "";
      try {
        errText = await res.text();
      } catch {
        // Ignore failure to read error body
      }
      throw new Error(`Soniox TTS error: HTTP ${res.status} ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const totalMs = Math.round(performance.now() - startTime);

    return {
      audio: Buffer.from(arrayBuffer),
      ttfbMs,
      totalMs,
      contentType: res.headers.get("content-type") || "audio/mpeg",
    };
  } catch (err: unknown) {
    log.warn({
      event: "soniox_tts_error",
      voice,
      textLength: text.length,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
