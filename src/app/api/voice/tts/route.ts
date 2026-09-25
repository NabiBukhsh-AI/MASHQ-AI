import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { routeTts } from "@/server/voice/tts-router";

const TtsBodySchema = z.object({
  text: z.string().min(1).max(400),
  lang: z.enum(["en", "ur", "ur-Latn", "mixed"]),
  profile: z.string().optional(),
  sig: z.string(),
  exp: z.number().int(),
  turnId: z.string().optional(),
  sessionId: z.guid(),
});

/**
 * Server-proxied speech synthesis. routeTts throws typed AppErrors for a bad
 * signature or oversized text, so withHandler maps them to the standard error envelope.
 */
export const POST = withHandler(
  {
    auth: "session",
    rateLimit: "ttsPerUserPerMinute",
    body: TtsBodySchema,
  },
  async (_req, ctx) => {
    const session = ctx.session!;
    const body = ctx.body;

    const result = await routeTts({
      text: body.text,
      lang: body.lang,
      profile: body.profile,
      sig: body.sig,
      exp: body.exp,
      turnId: body.turnId,
      sessionId: body.sessionId,
      orgId: session.orgId,
      userId: session.userId,
    });

    if (result.status === "audio") {
      return new Response(new Uint8Array(result.audio), {
        status: 200,
        headers: {
          "Content-Type": result.contentType || "audio/mpeg",
          "Content-Length": String(result.audio.length),
          "x-tts-provider": result.provider,
          "x-tts-voice": result.voice,
          "x-tts-failover": String(result.failover),
          "x-tts-ttfb-ms": String(result.ttfbMs),
        },
      });
    }

    // Fallback mode (daily cap reached, or all providers failed)
    return NextResponse.json(
      {
        fallback: result.fallbackTo,
        reason: result.reason,
        notice: result.notice,
      },
      {
        status: 200,
        headers: {
          "x-tts-fallback": result.fallbackTo,
          "x-tts-notice": encodeURIComponent(result.notice),
        },
      },
    );
  },
);
