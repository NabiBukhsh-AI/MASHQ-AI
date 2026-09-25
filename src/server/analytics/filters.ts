import { z } from "zod";

/**
 * Dashboard filters. Parsed from search params, so everything arrives as a
 * string and comma separated lists have to be split before validation.
 */
const MAX_WINDOW_DAYS = 180;

export const FiltersSchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  contentIds: z.array(z.guid()).max(50).optional(),
  cohorts: z.array(z.string().max(100)).max(50).optional(),
  departments: z.array(z.string().max(100)).max(50).optional(),
  personas: z.array(z.string().max(100)).max(20).optional(),
  languages: z
    .array(z.enum(["en", "ur", "ur-Latn", "mixed"]))
    .max(4)
    .optional(),
  modalities: z
    .array(z.enum(["text", "voice"]))
    .max(2)
    .optional(),
  /**
   * Demo rows are included by default, because the dashboards on a fresh install would otherwise be empty.
   * The UI shows a "seeded demo data" badge whenever this is true.
   */
  includeSeeded: z.boolean().default(true),
});

export type Filters = z.infer<typeof FiltersSchema>;

/**
 * The window has to be bounded. Without this an authenticated manager can ask for
 * 1970 to 2999 and make every widget scan the whole history, repeatedly, which is a cheap way
 * to exhaust the Neon compute budget for everybody.
 */
function assertWindow(from?: string, to?: string): void {
  if (!from && !to) return;
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to) : new Date();
  if (start.getTime() > end.getTime()) {
    throw new FilterError("from must be before to");
  }
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days > MAX_WINDOW_DAYS) {
    throw new FilterError(`from and to (at most ${MAX_WINDOW_DAYS} days)`);
  }
}

const csv = (value: string | null): string[] | undefined => {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
};

/** Turns a URL query string into validated filters. Unknown parameters are ignored. */
/**
 * The admin-settable defaults behind the filters. They come from config, never from a literal
 * here: analytics.defaultRangeDays and analytics.includeSeeded are real keys an admin can set,
 * and until these were threaded through they were settable and had no effect.
 */
export interface FilterDefaults {
  rangeDays?: number;
  includeSeeded?: boolean;
}

export function parseFilters(params: URLSearchParams, defaults: FilterDefaults = {}): Filters {
  const rangeDays = defaults.rangeDays ?? 14;
  const explicitSeeded = params.get("includeSeeded");
  const now = new Date();
  const parsed = FiltersSchema.safeParse({
    // Resolve the window here rather than leaving it undefined, so every widget measures the
    // same period and the summary sentence can state the period it actually measured.
    from: params.get("from") ?? new Date(now.getTime() - rangeDays * 86_400_000).toISOString(),
    to: params.get("to") ?? now.toISOString(),
    contentIds: csv(params.get("contentIds")),
    cohorts: csv(params.get("cohorts")),
    departments: csv(params.get("departments")),
    personas: csv(params.get("personas")),
    languages: csv(params.get("languages")),
    modalities: csv(params.get("modalities")),
    includeSeeded:
      explicitSeeded === "false"
        ? false
        : explicitSeeded === "true"
          ? true
          : defaults.includeSeeded,
  });
  if (!parsed.success) {
    throw new FilterError(parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  }
  assertWindow(parsed.data.from, parsed.data.to);
  return parsed.data;
}

export class FilterError extends Error {
  constructor(fields: string) {
    super(`Check these filters: ${fields || "unknown"}.`);
    this.name = "FilterError";
  }
}

/** Default window when the caller gives none: the last fourteen days, as the summary line says. */
export function defaultWindow(now = new Date()): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - 14 * 86_400_000), to: now };
}

export function windowOf(filters: Filters, now = new Date()): { from: Date; to: Date } {
  const fallback = defaultWindow(now);
  return {
    from: filters.from ? new Date(filters.from) : fallback.from,
    to: filters.to ? new Date(filters.to) : fallback.to,
  };
}
