import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { getOrgConfig, rollbackConfig } from "@/server/config/service";
import { clearDemoData, demoDataSummary, seedDemoData } from "@/server/db/demo-seed";
import { log } from "@/server/obs/logger";
import { db } from "@/server/db/client";
import { configAudit } from "@/server/db/schema";

const ResetBody = z.object({
  /** Uploaded journeys and their content are left alone unless this is false. */
  keepUploadedContent: z.boolean().default(true),
  /** Regenerate the demo dataset after clearing, so the dashboards are never left empty. */
  reseed: z.boolean().default(true),
  /**
   * Put settings back to version 1 as a new version, so a demo that changed a threshold
   * does not leak into the next run. It is a new version, never an edit of history, so the
   * audit trail still shows what was changed and when it was put back.
   */
  restoreConfig: z.boolean().default(true),
});

/**
 * Resets the demo. Admin only. It removes only the rows the demo seed
 * created, identified by the generated learner ids, so nothing a real learner did is touched.
 */
export const POST = withHandler(
  { auth: "session", roles: ["admin"], rateLimit: "perIpPerMinute", body: ResetBody },
  async (_req, ctx) => {
    const session = ctx.session!;
    const before = await demoDataSummary(session.orgId);

    const removed = await clearDemoData(session.orgId);

    // Settings first, so a reseed runs against the settings the demo is meant to show.
    let configVersion: number | null = null;
    if (ctx.body.restoreConfig) {
      const current = await getOrgConfig(session.orgId);
      if (current.version > 1) {
        // rollbackConfig writes a new version and its own config_audit row, so the reset shows
        // up on the admin audit page rather than only in a log line nobody reads.
        configVersion = (await rollbackConfig(session.orgId, session.userId, 1)).version;
      } else {
        configVersion = current.version;
      }
    }

    let reseeded = null;
    if (ctx.body.reseed) {
      const { config } = await getOrgConfig(session.orgId);
      reseeded = await seedDemoData(session.orgId, config);
    }

    // The demo reset itself is audited too, not just the settings restore it triggered. The
    // log line alone never reached the admin audit page, which reads config_audit.
    await db.insert(configAudit).values({
      orgId: session.orgId,
      actorId: session.userId,
      entity: "demo",
      action: "reset",
      toVersion: configVersion,
      reason: `Demo reset: ${removed} session(s) removed, ${reseeded?.sessions ?? 0} reseeded`,
      requestId: ctx.requestId ?? null,
    });

    log.info({
      event: "demo_reset",
      orgId: session.orgId,
      actorId: session.userId,
      sessionsRemoved: removed,
      keepUploadedContent: ctx.body.keepUploadedContent,
      reseeded: reseeded?.sessions ?? 0,
      configVersion,
    });

    return NextResponse.json({
      removed: { sessions: removed, learners: before.learners },
      reseeded,
      configVersion,
    });
  },
);

/** What a reset would remove, so the admin screen can confirm before doing it. */
export const GET = withHandler(
  { auth: "session", roles: ["admin"], rateLimit: "perIpPerMinute" },
  async (_req, ctx) => {
    const session = ctx.session!;
    return NextResponse.json(await demoDataSummary(session.orgId));
  },
);
