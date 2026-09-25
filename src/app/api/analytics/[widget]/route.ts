import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { parseFilters, FilterError } from "@/server/analytics/filters";
import { runWidget, WIDGETS, type WidgetName } from "@/server/analytics/queries";
import { resolveOrgConfig } from "@/server/config/service";

const WidgetParam = z.enum(WIDGETS as [WidgetName, ...WidgetName[]]);

/**
 * One widget per request. Managers and admins only: a learner's own numbers come
 * from the progress route, which is scoped to them. The org always comes from the session, so
 * the filters can only narrow what a caller already has access to.
 */
export const GET = withHandler(
  { auth: "session", roles: ["ld_manager", "admin"], rateLimit: "analytics" },
  async (req, ctx) => {
    const session = ctx.session!;
    const params = await ctx.params;

    const widget = WidgetParam.safeParse(params?.widget);
    if (!widget.success) {
      throw errors.notFound("That dashboard widget does not exist.");
    }

    const cfg = await resolveOrgConfig({ orgId: session.orgId });
    let filters;
    try {
      filters = parseFilters(new URL(req.url).searchParams, {
        rangeDays: cfg.config.analytics.defaultRangeDays,
        includeSeeded: cfg.config.analytics.includeSeeded,
      });
    } catch (err) {
      if (err instanceof FilterError) throw errors.badRequest(err.message);
      throw err;
    }

    const started = performance.now();
    const data = await runWidget(widget.data, session.orgId, filters);
    const ms = Math.round(performance.now() - started);

    return NextResponse.json(
      { widget: widget.data, filters, data, includesSeeded: filters.includeSeeded },
      { headers: { "Server-Timing": `widget;dur=${ms}` } },
    );
  },
);
