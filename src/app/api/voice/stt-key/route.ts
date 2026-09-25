import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { getOrgConfig } from "@/server/config/service";
import { createSonioxTemporaryKey, getSttSessionConfig } from "@/server/voice/soniox";

const SttKeyQuery = z.object({
  /** Either identifies the content whose glossary seeds the recogniser context terms. */
  sessionId: z.guid().optional(),
  contentId: z.guid().optional(),
});

/**
 * Short-lived Soniox transcription key plus the recogniser session config.
 * The glossary terms are scoped to the caller's own org and session inside getSttSessionConfig.
 */
export const POST = withHandler(
  { auth: "session", rateLimit: "voiceKeysPerUserPerMinute", query: SttKeyQuery },
  async (_req, ctx) => {
    const session = ctx.session!;
    const { config } = await getOrgConfig(session.orgId);

    const keyResult = await createSonioxTemporaryKey({
      usageType: "transcribe_websocket",
      expiresInSeconds: config.voice.stt.keyTtlSeconds,
      singleUse: true,
      maxSessionDurationSeconds: config.voice.stt.maxSessionSeconds,
      clientReferenceId: session.userId,
    });

    const sttConfig = await getSttSessionConfig({
      orgId: session.orgId,
      userId: session.userId,
      sessionId: ctx.query.sessionId,
      contentId: ctx.query.contentId,
    });

    return NextResponse.json({
      apiKey: keyResult.apiKey,
      expiresAt: keyResult.expiresAt,
      config: sttConfig,
    });
  },
);
