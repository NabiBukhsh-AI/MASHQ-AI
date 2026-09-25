import { describe, it, expect } from "vitest";
import { parseFilters, FilterError, windowOf, defaultWindow } from "./filters";
import { runWidget, summarySentence, WIDGETS, type Kpis } from "./queries";

const q = (s: string) => new URLSearchParams(s);

describe("filters", () => {
  it("defaults to the last fourteen days, which the summary sentence claims", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const w = defaultWindow(now);
    expect(Math.round((w.to.getTime() - w.from.getTime()) / 86_400_000)).toBe(14);
  });

  it("includes seeded rows unless asked not to, so the dashboards are never blank", () => {
    expect(parseFilters(q("")).includeSeeded).toBe(true);
    expect(parseFilters(q("includeSeeded=false")).includeSeeded).toBe(false);
  });

  it("splits comma separated lists", () => {
    const f = parseFilters(q("departments=Compliance,Digital&languages=en,ur"));
    expect(f.departments).toEqual(["Compliance", "Digital"]);
    expect(f.languages).toEqual(["en", "ur"]);
  });

  it("rejects a language that is not one of the four modes", () => {
    expect(() => parseFilters(q("languages=klingon"))).toThrow(FilterError);
  });

  it("rejects a content id that is not a uuid, rather than passing it to the database", () => {
    expect(() => parseFilters(q("contentIds=not-a-uuid"))).toThrow(FilterError);
  });

  it("rejects a malformed date", () => {
    expect(() => parseFilters(q("from=yesterday"))).toThrow(FilterError);
  });

  it("caps list lengths so a query string cannot build an enormous IN clause", () => {
    const many = Array.from({ length: 60 }, (_, i) => `dept${i}`).join(",");
    expect(() => parseFilters(q(`departments=${many}`))).toThrow(FilterError);
  });

  it("refuses a window wider than the cap, which would scan the whole history", () => {
    // An unbounded window is a cheap way for one manager to exhaust the compute budget.
    expect(() => parseFilters(q("from=1970-01-01T00:00:00Z&to=2999-01-01T00:00:00Z"))).toThrow(
      FilterError,
    );
  });

  it("refuses a window that runs backwards", () => {
    expect(() => parseFilters(q("from=2026-09-20T00:00:00Z&to=2026-09-01T00:00:00Z"))).toThrow(
      FilterError,
    );
  });

  it("accepts a normal reporting window", () => {
    expect(() =>
      parseFilters(q("from=2026-06-01T00:00:00Z&to=2026-09-01T00:00:00Z")),
    ).not.toThrow();
  });

  it("refuses an open ended from that reaches back to the epoch", () => {
    expect(() => parseFilters(q("from=1970-01-01T00:00:00Z"))).toThrow(FilterError);
  });

  it("honours an explicit window", () => {
    const f = parseFilters(q("from=2026-09-01T00:00:00Z&to=2026-09-10T00:00:00Z"));
    const w = windowOf(f);
    expect(w.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("ignores unknown parameters instead of failing", () => {
    expect(() => parseFilters(q("somethingElse=1"))).not.toThrow();
  });
});

describe("summary sentence", () => {
  const base: Kpis = {
    activeLearners: 42,
    sessions: 120,
    turns: 900,
    completionRate: 0.78,
    meanMasteryGain: 0.31,
    conceptsPractised: 6,
    costUsd: 4.2,
  };

  it("is written from the numbers, and reports them faithfully", () => {
    const s = summarySentence(base);
    expect(s).toContain("42 learners");
    expect(s).toContain("6 topics");
    expect(s).toContain("0.31");
    expect(s).toContain("78%");
  });

  it("says plainly when there is nothing to report, rather than showing zeros", () => {
    expect(summarySentence({ ...base, sessions: 0 })).toContain("No practice recorded");
  });

  it("gets the singular right for one learner and one topic", () => {
    const s = summarySentence({ ...base, activeLearners: 1, conceptsPractised: 1 });
    expect(s).toContain("1 learner practised 1 topic.");
  });

  it("never claims mastery without the word estimated", () => {
    // Mastery is always labelled as an estimate.
    expect(summarySentence(base).toLowerCase()).toContain("estimated");
  });
});

describe("widget list", () => {
  it("covers every widget the manager dashboard renders", () => {
    expect(WIDGETS).toContain("summary");
    expect(WIDGETS).toContain("masteryMatrix");
    expect(WIDGETS).toContain("funnel");
    expect(WIDGETS).toContain("contentHealth");
    expect(WIDGETS).toContain("languageVoice");
  });
});

/**
 * The Neon driver flattens a one element JS array to a scalar, so a filter with exactly one
 * value reached Postgres as `= ANY($1)` with $1 a bare string and every widget threw a 500.
 * Filtering the dashboard to one language is the most ordinary thing a manager does, and the
 * e2e suite could not see it because it mocks the analytics API.
 */
describe("array filters survive a single value", () => {
  it.each([
    ["one value", ["ur"]],
    ["two values", ["ur", "en"]],
  ])("binds each element of %s as its own parameter", async (_label, languages) => {
    let built = "";
    const db = {
      execute: async (q: unknown) => {
        // The whole chunk tree, since the scope fragment is a nested sql object.
        built += JSON.stringify(q, (_k, v) => (typeof v === "bigint" ? String(v) : v));
        return { rows: [{}] };
      },
    };
    const filters = parseFilters(new URLSearchParams(`languages=${languages.join(",")}`));
    await runWidget("masteryMatrix", "org-1", filters, { db } as never);

    // ARRAY[...] with one placeholder per element, never a single array-valued parameter.
    expect(built).toContain("ARRAY[");
    for (const lang of languages) {
      expect(built).toContain(`"${lang}"`);
    }
    expect(built).not.toContain(JSON.stringify(languages));
  });
});
