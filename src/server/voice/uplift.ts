import { env } from "@/env";
import { log } from "../obs/logger";

export interface UpliftSynthesizeOptions {
  outputFormat?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SynthesizeAudioResult {
  audio: Buffer;
  ttfbMs: number;
  totalMs: number;
  contentType: string;
}

/**
 * Synthesizes speech using Uplift AI REST endpoint.
 * URL: POST https://api.upliftai.org/v1/synthesis/text-to-speech
 */
export async function synthesizeUplift(
  text: string,
  voiceId: string,
  options: UpliftSynthesizeOptions = {},
): Promise<SynthesizeAudioResult> {
  const apiKey = env.UPLIFT_API_KEY;
  if (!apiKey) {
    throw new Error("UPLIFT_API_KEY is not configured.");
  }

  // Not an env override: an undeclared one would send the provider key to any host and
  // env validation would never flag it.
  const endpoint = "https://api.upliftai.org/v1/synthesis/text-to-speech";
  const outputFormat = options.outputFormat || "MP3_22050_32";
  const timeoutMs = options.timeoutMs ?? 1500;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Uplift TTS timed out after ${timeoutMs}ms`));
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
        voiceId,
        outputFormat,
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
      throw new Error(`Uplift TTS error: HTTP ${res.status} ${errText}`);
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
      event: "uplift_tts_error",
      voiceId,
      textLength: text.length,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
