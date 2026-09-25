import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { loadSessionState } from "@/server/engine/session";

export const GET = withHandler({ auth: "session" }, async (_req, ctx) => {
  const params = await ctx.params;
  const sessionId = params?.sessionId;

  if (!sessionId || typeof sessionId !== "string") {
    throw errors.badRequest("Session id is required.");
  }

  const session = ctx.session!;
  const sessionState = await loadSessionState(sessionId, session.userId, session.orgId);

  if (!sessionState) {
    throw errors.notFound("Session not found.");
  }

  return NextResponse.json(sessionState);
});
