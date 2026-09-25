import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { getOrgConfig } from "@/server/config/service";
import { loadLearnerProgress } from "@/server/analytics/progress";

/**
 * The caller's own progress. userId and orgId both come from the session, so
 * there is no parameter a learner could change to see somebody else.
 */
export const GET = withHandler(
  { auth: "session", rateLimit: "perIpPerMinute" },
  async (_req, ctx) => {
    const session = ctx.session!;
    const { config } = await getOrgConfig(session.orgId);
    const progress = await loadLearnerProgress(session.userId, session.orgId, config);
    return NextResponse.json(progress);
  },
);
