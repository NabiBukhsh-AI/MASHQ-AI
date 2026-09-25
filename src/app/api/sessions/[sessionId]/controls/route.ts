import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { applySessionControls, SessionControlsSchema } from "@/server/engine/controls";

/**
 * Live session controls: persona, language, register, modality, preset.
 * Applied to the session now, audited, logged as a panel_control adaptation event; the next
 * turn acknowledges the switch (R03) and renders with the new settings.
 */
export const POST = withHandler(
  { auth: "session", rateLimit: "chat", body: SessionControlsSchema },
  async (_req, ctx) => {
    const params = await ctx.params;
    const sessionId = params?.sessionId;
    if (!sessionId || typeof sessionId !== "string") {
      throw errors.badRequest("Session id is required.");
    }
    const session = ctx.session!;
    const result = await applySessionControls({
      sessionId,
      userId: session.userId,
      orgId: session.orgId,
      controls: ctx.body,
      actorId: session.userId,
    });
    return NextResponse.json(result);
  },
);
