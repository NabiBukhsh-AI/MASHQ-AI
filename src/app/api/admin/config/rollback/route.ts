import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { rollbackConfig } from "@/server/config/service";

/**
 * Restores an earlier version as a new version, so the history stays append only and the
 * rollback itself is auditable.
 */
export const POST = withHandler(
  {
    auth: "session",
    roles: ["admin"],
    rateLimit: "perIpPerMinute",
    body: z.object({ toVersion: z.number().int().min(1) }),
  },
  async (_req, ctx) => {
    const session = ctx.session!;
    try {
      const result = await rollbackConfig(session.orgId, session.userId, ctx.body.toVersion);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof Error && err.message.includes("does not exist")) {
        throw errors.notFound("That settings version does not exist for this organization.");
      }
      throw err;
    }
  },
);
