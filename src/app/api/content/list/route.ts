import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { listLibrary } from "@/server/ingest/library";

/**
 * The content library for the caller's organization.
 *
 * This used to call a mock with orgId "mock-org", so it ignored the session entirely and could
 * only ever return a hardcoded sample. It is scoped to the caller's org now.
 *
 * Learners see it too, limited to documents with a mission ready to play: anything in the
 * library is theirs to practise, and a document still being designed is nothing they can use.
 */
export const GET = withHandler(
  { auth: "session", roles: ["learner", "ld_manager", "admin"], rateLimit: "analytics" },
  async (_req, ctx) => {
    const session = ctx.session!;
    return NextResponse.json({
      items: await listLibrary(session.orgId, {
        userId: session.userId,
        playableOnly: session.role === "learner",
      }),
    });
  },
);
