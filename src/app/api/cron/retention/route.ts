import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { baseConfig } from "@/server/config/service";
import { purgeExpired, purgePreview } from "@/server/security/retention";

/**
 * Daily retention purge. Hobby runs crons once a day, which
 * is exactly the cadence the retention table asks for.
 *
 * Auth is the "cron" mode, which checks CRON_SECRET; a request without it never reaches here.
 * The windows come from config, so an org can shorten them without a deploy.
 */
export const GET = withHandler({ auth: "cron" }, async (req) => {
  // Code defaults, not an org config: the purge runs across every org, and the windows are a
  // platform promise rather than a per org setting to be relaxed.
  const config = baseConfig();

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if (dryRun) {
    return NextResponse.json({ dryRun: true, wouldDelete: await purgePreview(config) });
  }

  const counts = await purgeExpired(config);
  return NextResponse.json({ deleted: counts, retentionDays: config.privacy.retentionDays });
});
