import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { inspectorSnapshot } from "@/server/engine/inspector";

const InspectorQuery = z.object({
  /** Cursor from the previous snapshot; echoed back when nothing newer exists. */
  since: z.iso.datetime().optional(),
});

/**
 * Engine Inspector feed. `since` is the cursor from the previous snapshot, so an
 * open panel polls cheaply. Scoped to the caller's own session; model ids are withheld unless
 * ui.showModelIdentifiers is on.
 */
export const GET = withHandler(
  { auth: "session", rateLimit: "inspector", query: InspectorQuery },
  async (_req, ctx) => {
    const params = await ctx.params;
    const sessionId = params?.sessionId;
    if (!sessionId || typeof sessionId !== "string") {
      throw errors.badRequest("Session id is required.");
    }
    const session = ctx.session!;
    const snapshot = await inspectorSnapshot({
      sessionId,
      userId: session.userId,
      orgId: session.orgId,
      since: ctx.query.since,
    });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  },
);
