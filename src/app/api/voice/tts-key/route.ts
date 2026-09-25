import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { getOrgConfig } from "@/server/config/service";
import { db } from "@/server/db/client";
import { mediaUsage } from "@/server/db/schema/ops";
import { log } from "@/server/obs/logger";
import { createSonioxTemporaryKey } from "@/server/voice/soniox";
import { verifySpeech } from "@/server/voice/speech-token";
import { estimateAudioSeconds, getTodaysTtsSeconds } from "@/server/voice/tts-router";

/**
 * The browser synthesizes one signed sentence with this key. Without the signature the route
 * would be an open text-to-speech oracle on the org's Soniox account, outside the 400 character
 * cap, the daily seconds cap and media_usage, all of which the server proxy enforces.
 */
const TtsKeyBodySchema = z.object({
  text: z.string().min(1).max(400),
  lang: z.enum(["en", "ur", "ur-Latn", "mixed"]),
  sig: z.string(),
  exp: z.number().int(),
  turnId: z.string().optional(),
  sessionId: z.guid(),
});

export const POST = withHandler(
  { auth: "session", rateLimit: "voiceKeysPerUserPerMinute", body: TtsKeyBodySchema },
  async (_req, ctx) => {
    const session = ctx.session!;
    const { text, lang, sig, exp, turnId, sessionId } = ctx.body;
    const { config } = await getOrgConfig(session.orgId);

    const valid = verifySpeech({
      text,
      lang,
      turnId,
      sig,
      exp,
      scope: { orgId: session.orgId, userId: session.userId, sessionId },
    });
    if (!valid) {
      throw errors.forbidden("This speech request is not valid any more. Reload the session.");
    }

    if (text.length > config.voice.tts.maxChars) {
      throw errors.badRequest(
        `Speech text is longer than the ${config.voice.tts.maxChars} character limit.`,
      );
    }

    const estimatedSeconds = estimateAudioSeconds(text);
    const usedSeconds = await getTodaysTtsSeconds(session.orgId, db);
    if (usedSeconds + estimatedSeconds > config.voice.tts.dailySecondsCap) {
      return NextResponse.json({
        fallback: "browser",
        reason: "daily_cap_exceeded",
        notice: "Daily voice quota reached. Switching to browser voice.",
      });
    }

    const keyResult = await createSonioxTemporaryKey({
      usageType: "tts_rt",
      expiresInSeconds: config.voice.stt.keyTtlSeconds,
      singleUse: true,
      maxSessionDurationSeconds: config.voice.stt.maxSessionSeconds,
      clientReferenceId: session.userId,
    });

    // Charged at issue time: once the key is out, the server never sees the synthesis.
    try {
      await db.insert(mediaUsage).values({
        orgId: session.orgId,
        sessionId,
        kind: "tts",
        provider: "soniox_browser",
        lang,
        seconds: estimatedSeconds,
        chars: text.length,
      });
    } catch (dbErr) {
      log.warn({ event: "media_usage_insert_error", error: String(dbErr) });
    }

    return NextResponse.json({
      apiKey: keyResult.apiKey,
      expiresAt: keyResult.expiresAt,
      model: config.voice.tts.model,
    });
  },
);
