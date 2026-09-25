import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import {
  getOrgConfig,
  listConfigVersions,
  patchOrgConfig,
  updateOrgConfig,
} from "@/server/config/service";
import { ConfigSchema } from "@/server/config/schema";

/**
 * Org configuration. Admin only: a manager can change content, not the settings
 * that govern grounding, spend and voice for the whole org.
 */
export const GET = withHandler(
  { auth: "session", roles: ["admin"], rateLimit: "perIpPerMinute" },
  async (_req, ctx) => {
    const session = ctx.session!;
    const [current, versions] = await Promise.all([
      getOrgConfig(session.orgId),
      listConfigVersions(session.orgId),
    ]);
    return NextResponse.json({
      version: current.version,
      hash: current.hash,
      config: current.config,
      versions,
    });
  },
);

const WriteBody = z.object({
  /** A partial change, merged onto the active version. */
  patch: z.record(z.string(), z.unknown()).optional(),
  /** A complete replacement, validated against the schema before anything is written. */
  config: z.unknown().optional(),
  reason: z.string().min(1).max(300),
});

export const PATCH = withHandler(
  { auth: "session", roles: ["admin"], rateLimit: "perIpPerMinute", body: WriteBody },
  async (_req, ctx) => {
    const session = ctx.session!;
    const { patch, config, reason } = ctx.body;

    if (!patch && config === undefined) {
      throw errors.badRequest("Send either a patch or a complete config.");
    }

    try {
      const result = config
        ? await updateOrgConfig(session.orgId, session.userId, config, reason)
        : await patchOrgConfig(session.orgId, session.userId, patch!, reason);
      return NextResponse.json(result);
    } catch (err) {
      // A schema failure is the admin's input, not a server fault, so name the fields.
      const parsed = ConfigSchema.safeParse(config);
      if (config !== undefined && !parsed.success) {
        throw errors.badRequest(
          "Check these settings.",
          parsed.error.issues.slice(0, 20).map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        );
      }
      throw err;
    }
  },
);
