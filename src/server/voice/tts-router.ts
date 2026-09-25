import { and, eq, gte, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { mediaUsage } from "../db/schema/ops";
import { getOrgConfig } from "../config/service";
import { errors } from "../http/errors";
import type { Config, Lang } from "../config/schema";
import { log } from "../obs/logger";
import { karachiDay } from "../security/spend";
import { redact } from "../security/redact";
import { verifySpeech } from "./speech-token";
import { synthesizeUplift, type SynthesizeAudioResult } from "./uplift";
import { synthesizeSonioxServer } from "./soniox-tts";

export interface TtsRouterInput {
  text: string;
  lang: "en" | "ur" | "ur-Latn" | "mixed";
  profile?: string;
  sig?: string;
  exp?: number;
  turnId?: string;
  sessionId: string;
  orgId: string;
  userId: string;
}

export type TtsRouterResult =
  | {
      status: "audio";
      audio: Buffer;
      provider: "uplift" | "soniox";
      voice: string;
      contentType: string;
      ttfbMs: number;
      totalMs: number;
      failover: boolean;
      estimatedSeconds: number;
    }
  | {
      status: "fallback";
      fallbackTo: "browser" | "captions_only";
      reason: "daily_cap_exceeded" | "all_providers_failed";
      notice: string;
    };

/**
 * Calculates start of current day in Asia/Karachi (UTC+5).
 */
export function karachiStartOfDay(now: Date = new Date()): Date {
  const dayStr = karachiDay(now);
  return new Date(`${dayStr}T00:00:00+05:00`);
}

/**
 * Estimates spoken duration in seconds from text length (roughly 14 characters per second).
 */
export function estimateAudioSeconds(text: string): number {
  return Math.max(0.5, Number((text.trim().length * 0.07).toFixed(2)));
}

/**
 * Queries total TTS seconds used today for the organization.
 */
export async function getTodaysTtsSeconds(
  orgId: string,
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<number> {
  try {
    const [row] = await db
      .select({ totalSeconds: sql<string>`coalesce(sum(${mediaUsage.seconds}), 0)` })
      .from(mediaUsage)
      .where(
        and(
          eq(mediaUsage.orgId, orgId),
          eq(mediaUsage.kind, "tts"),
          gte(mediaUsage.createdAt, karachiStartOfDay(now)),
        ),
      );
    return Number(row?.totalSeconds ?? 0);
  } catch (err) {
    log.warn({ event: "media_usage_query_error", orgId, error: String(err) });
    // Fail closed: an unreadable usage table must not remove the spend cap.
    return Number.POSITIVE_INFINITY;
  }
}

export interface RouterOptions {
  config?: Config;
  db?: Db;
  synthesizers?: {
    uplift?: (text: string, voiceId: string, options?: unknown) => Promise<SynthesizeAudioResult>;
    soniox?: (text: string, voice: string, options?: unknown) => Promise<SynthesizeAudioResult>;
  };
  now?: Date;
}

/**
 * Routes TTS synthesis request through provider chain with signature verification,
 * daily cap enforcement, TTFB timeout failover, and media usage recording.
 */
export async function routeTts(
  input: TtsRouterInput,
  options: RouterOptions = {},
): Promise<TtsRouterResult> {
  const { text, lang, profile = "guide", sig, exp, turnId, sessionId, orgId, userId } = input;

  // 1. Verify speech signature
  const validSig = verifySpeech({
    text,
    lang,
    turnId,
    sig,
    exp,
    scope: { orgId, userId, sessionId },
  });
  if (!validSig) {
    throw errors.forbidden("This speech request is not valid any more. Reload the session.");
  }

  // Redact after the signature check, so the HMAC still matches, but before any provider sees it.
  const spokenText = redact(text).text;

  // 2. Load organization config
  let config = options.config;
  if (!config) {
    const orgConfig = await getOrgConfig(orgId);
    config = orgConfig.config;
  }

  // 3. Check text length against maxChars
  const maxChars = config.voice.tts.maxChars;
  if (text.length > maxChars) {
    throw errors.badRequest(`Speech text is longer than the ${maxChars} character limit.`);
  }

  const db = options.db ?? defaultDb;
  const now = options.now ?? new Date();

  // 4. Daily seconds cap check
  const dailyCap = config.voice.tts.dailySecondsCap;
  const usedSeconds = await getTodaysTtsSeconds(orgId, db, now);
  if (usedSeconds >= dailyCap) {
    return {
      status: "fallback",
      fallbackTo: "browser",
      reason: "daily_cap_exceeded",
      notice: "Daily voice quota reached. Switching to browser voice.",
    };
  }

  // 5. Determine route chain and voice mapping
  const routeConfig = config.voice.tts.routes[lang as Lang] ?? {
    chain: ["uplift", "soniox", "browser"],
  };
  const chain = routeConfig.chain;
  const ttfbTimeoutMs = config.voice.tts.ttfbTimeoutMs;

  const upliftVoice =
    config.voice.tts.voices.uplift?.[profile] ||
    config.voice.tts.voices.uplift?.guide ||
    "v_meklc281";

  const sonioxVoice =
    config.voice.tts.voices.soniox?.[profile] || config.voice.tts.voices.soniox?.guide || "default";

  const upliftFn = options.synthesizers?.uplift ?? synthesizeUplift;
  const sonioxFn = options.synthesizers?.soniox ?? synthesizeSonioxServer;

  let isFailover = false;

  for (const provider of chain) {
    if (provider === "browser") {
      return {
        status: "fallback",
        fallbackTo: "browser",
        reason: "all_providers_failed",
        notice: "Primary speech provider unavailable. Falling back to browser voice.",
      };
    }

    if (provider === "uplift") {
      try {
        const result = await upliftFn(spokenText, upliftVoice, {
          timeoutMs: ttfbTimeoutMs,
          outputFormat: config.voice.tts.format || "MP3_22050_32",
        });

        const estimatedSeconds = estimateAudioSeconds(spokenText);

        // Record media usage
        try {
          await db.insert(mediaUsage).values({
            orgId,
            sessionId,
            kind: "tts",
            provider: "uplift",
            lang,
            seconds: estimatedSeconds,
            chars: spokenText.length,
            ttfbMs: result.ttfbMs,
            failover: isFailover,
          });
        } catch (dbErr) {
          log.warn({ event: "media_usage_insert_error", error: String(dbErr) });
        }

        return {
          status: "audio",
          audio: result.audio,
          provider: "uplift",
          voice: upliftVoice,
          contentType: result.contentType,
          ttfbMs: result.ttfbMs,
          totalMs: result.totalMs,
          failover: isFailover,
          estimatedSeconds,
        };
      } catch (err) {
        log.warn({
          event: "tts_provider_failover",
          failedProvider: "uplift",
          lang,
          error: err instanceof Error ? err.message : String(err),
        });
        isFailover = true;
      }
    }

    if (provider === "soniox") {
      try {
        const result = await sonioxFn(spokenText, sonioxVoice, {
          timeoutMs: ttfbTimeoutMs,
          language: lang,
          model: config.voice.tts.model,
        });

        const estimatedSeconds = estimateAudioSeconds(spokenText);

        // Record media usage
        try {
          await db.insert(mediaUsage).values({
            orgId,
            sessionId,
            kind: "tts",
            provider: "soniox",
            lang,
            seconds: estimatedSeconds,
            chars: spokenText.length,
            ttfbMs: result.ttfbMs,
            failover: isFailover,
          });
        } catch (dbErr) {
          log.warn({ event: "media_usage_insert_error", error: String(dbErr) });
        }

        return {
          status: "audio",
          audio: result.audio,
          provider: "soniox",
          voice: sonioxVoice,
          contentType: result.contentType,
          ttfbMs: result.ttfbMs,
          totalMs: result.totalMs,
          failover: isFailover,
          estimatedSeconds,
        };
      } catch (err) {
        log.warn({
          event: "tts_provider_failover",
          failedProvider: "soniox",
          lang,
          error: err instanceof Error ? err.message : String(err),
        });
        isFailover = true;
      }
    }
  }

  return {
    status: "fallback",
    fallbackTo: "captions_only",
    reason: "all_providers_failed",
    notice: "Speech synthesis currently unavailable. Displaying captions only.",
  };
}
