import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { AppError, errors } from "@/server/http/errors";
import { db } from "@/server/db/client";
import { reportExports } from "@/server/db/schema/ops";
import { log } from "@/server/obs/logger";
import { parseFilters, FilterError } from "@/server/analytics/filters";
import { runWidget, WIDGETS, type WidgetName } from "@/server/analytics/queries";
import { csvFilename, toCsv, type CsvColumn } from "@/server/security/csv";
import { resolveOrgConfig } from "@/server/config/service";

const WidgetParam = z.enum(WIDGETS as [WidgetName, ...WidgetName[]]);

/**
 * CSV export of one widget. Same filters, same data, same authorization as the
 * dashboard, so an export can never show more than the screen it came from.
 */
const COLUMNS: Partial<Record<WidgetName, CsvColumn[]>> = {
  masteryMatrix: [
    { key: "pseudonym", header: "Learner" },
    { key: "concept_key", header: "Concept key" },
    { key: "concept_label", header: "Concept" },
    { key: "band", header: "Band" },
    { key: "p", header: "Estimated mastery" },
    { key: "lower", header: "Estimate lower" },
    { key: "upper", header: "Estimate upper" },
    { key: "n_events", header: "Answers" },
  ],
  missionDropoff: [
    { key: "mission_title", header: "Mission" },
    { key: "ordinal", header: "Order" },
    { key: "abandoned_sessions", header: "Unfinished sessions" },
  ],
  languageVoice: [
    { key: "language", header: "Language" },
    { key: "modality", header: "Modality" },
    { key: "sessions", header: "Sessions" },
    { key: "turns", header: "Turns" },
    { key: "tts_failovers", header: "Speech failovers" },
    { key: "tts_seconds", header: "Speech seconds" },
  ],
  contentHealth: [
    { key: "concept_key", header: "Concept key" },
    { key: "concept_label", header: "Concept" },
    { key: "hint_rate", header: "Hint rate" },
    { key: "first_try_incorrect_rate", header: "Wrong first time" },
    { key: "mean_score", header: "Mean score" },
    { key: "evidence_count", header: "Answers" },
    { key: "top_misconception", header: "Most common misconception" },
  ],
  personas: [
    { key: "persona_id", header: "Persona" },
    { key: "sessions", header: "Sessions" },
    { key: "completion_rate", header: "Completion rate" },
    { key: "mean_turns", header: "Mean turns" },
  ],
  cost: [
    { key: "day", header: "Day" },
    { key: "cost_usd", header: "Cost USD" },
    { key: "input_tokens", header: "Input tokens" },
    { key: "output_tokens", header: "Output tokens" },
    { key: "calls", header: "Calls" },
  ],
  latency: [
    { key: "day", header: "Day" },
    { key: "task", header: "Task" },
    { key: "calls", header: "Calls" },
    { key: "ttft_p50", header: "First token p50 ms" },
    { key: "ttft_p95", header: "First token p95 ms" },
    { key: "latency_p95", header: "Latency p95 ms" },
    { key: "errors", header: "Errors" },
  ],
};

/** Widgets that return one object rather than a list become a single row. */
function toRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  return [];
}

function columnsFor(widget: WidgetName, rows: Array<Record<string, unknown>>): CsvColumn[] {
  const declared = COLUMNS[widget];
  if (declared) return declared;
  // Summary, kpis and funnel are shaped by the query, so take their keys in order.
  const first = rows[0];
  return first ? Object.keys(first).map((k) => ({ key: k, header: k })) : [];
}

export const GET = withHandler(
  { auth: "session", roles: ["ld_manager", "admin"], rateLimit: "exports" },
  async (req, ctx) => {
    const session = ctx.session!;
    const params = await ctx.params;

    const widget = WidgetParam.safeParse(params?.widget);
    if (!widget.success) throw errors.notFound("That export does not exist.");

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

    const data = await runWidget(widget.data, session.orgId, filters);
    const rows = toRows(widget.data === "summary" ? (data as { kpis: unknown }).kpis : data);
    const csv = toCsv(columnsFor(widget.data, rows), rows);

    // Every export is recorded before the file is handed over. If this cannot be written
    // the export does not happen: an untraceable extract of learner mastery data is worse
    // than a failed download.
    try {
      await db.insert(reportExports).values({
        orgId: session.orgId,
        actorId: session.userId,
        reportType: widget.data,
        format: "csv",
        filters: filters as unknown as Record<string, unknown>,
        rowCount: rows.length,
      });
    } catch (err) {
      log.error({ event: "report_export_log_failed", error: String(err) });
      throw new AppError(
        "INTERNAL_ERROR",
        500,
        "The export could not be recorded, so it was not produced. Try again.",
      );
    }

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename(widget.data)}"`,
        // Never let a browser sniff this into something executable.
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
