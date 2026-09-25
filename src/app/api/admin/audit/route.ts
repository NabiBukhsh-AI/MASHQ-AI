import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { withHandler } from "@/server/http/handler";
import { db } from "@/server/db/client";
import { configAudit } from "@/server/db/schema";

/** The settings audit trail: who changed what, when, and the diff. */
export const GET = withHandler(
  { auth: "session", roles: ["admin"], rateLimit: "perIpPerMinute" },
  async (_req, ctx) => {
    const session = ctx.session!;
    const rows = await db
      .select({
        id: configAudit.id,
        actorId: configAudit.actorId,
        entity: configAudit.entity,
        action: configAudit.action,
        fromVersion: configAudit.fromVersion,
        toVersion: configAudit.toVersion,
        diff: configAudit.diff,
        reason: configAudit.reason,
        createdAt: configAudit.createdAt,
      })
      .from(configAudit)
      .where(eq(configAudit.orgId, session.orgId))
      .orderBy(desc(configAudit.createdAt))
      .limit(100);
    return NextResponse.json({ entries: rows });
  },
);
