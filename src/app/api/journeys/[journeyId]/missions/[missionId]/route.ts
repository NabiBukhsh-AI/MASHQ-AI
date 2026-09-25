import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { ensureMission } from "@/server/design/missions";

export const GET = withHandler({ auth: "session" }, async (req, ctx) => {
  const params = await ctx.params;
  const missionId = params?.missionId;

  if (!missionId || typeof missionId !== "string") {
    throw errors.badRequest("Mission id is required.");
  }

  const pack = await ensureMission(missionId);
  return NextResponse.json({ pack });
});
