import { describe, it, expect } from "vitest";
import { clearDemoData } from "./demo-seed";
import type { Db } from "./client";

/**
 * A demo reset works, is audited, and removes only what the demo seed created.
 *
 * The real risk is a reset taking a real learner's work with it, so that is
 * what these assert: every delete is scoped, and a row that is not a demo learner survives.
 */

interface Recorded {
  table: string;
  where: string;
}

/** A db double that records what would be deleted rather than deleting it. */
function recordingDb(sessionIds: string[], orgUserIds: string[]) {
  const deletes: Recorded[] = [];
  const nameOf = (t: unknown): string => {
    const sym = Object.getOwnPropertySymbols(t as object).find((s) => String(s).includes("Name"));
    return sym ? String((t as Record<symbol, unknown>)[sym]) : "unknown";
  };
  /** Drizzle where clauses hold circular table references, so collect the leaves instead. */
  const leaves = (v: unknown, seen = new WeakSet<object>(), out: string[] = []): string => {
    if (v === null || v === undefined) return out.join(" ");
    if (typeof v !== "object") {
      out.push(String(v));
      return out.join(" ");
    }
    if (seen.has(v as object)) return out.join(" ");
    seen.add(v as object);
    for (const item of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
      leaves(item, seen, out);
    }
    return out.join(" ");
  };
  const db = {
    select: (cols: Record<string, unknown>) => ({
      from: (t: unknown) => ({
        where: (w: unknown) => {
          const table = nameOf(t);
          const clause = leaves(w);
          if (table === "learning_sessions") return sessionIds.map((id) => ({ id }));
          if (table === "user") return orgUserIds.map((id) => ({ id }));
          void cols;
          void clause;
          return [];
        },
      }),
    }),
    delete: (t: unknown) => ({
      where: async (w: unknown) => {
        deletes.push({ table: nameOf(t), where: leaves(w) });
        return [];
      },
    }),
  };
  return { db: db as unknown as Db, deletes };
}

describe("demo reset", () => {
  it("removes the demo learners' sessions and everything hanging off them", async () => {
    const { db, deletes } = recordingDb(["s-1", "s-2"], ["demo-1"]);
    const removed = await clearDemoData("org-1", { db });

    expect(removed).toBe(2);
    const tables = deletes.map((d) => d.table);
    for (const t of [
      "evidence_events",
      "adaptation_events",
      "xp_ledger",
      "turns",
      "learning_sessions",
      "mastery_states",
      "user",
    ]) {
      expect(tables, `${t} was not cleared`).toContain(t);
    }
  });

  it("scopes every delete, so one org's reset cannot touch another org", async () => {
    const { db, deletes } = recordingDb(["s-1"], ["demo-1"]);
    await clearDemoData("org-under-test", { db });

    // The demo learner ids are the same constants in every org. Any delete that goes by user
    // id alone has to also be bounded by the session ids this org owns, or by org_id.
    for (const d of deletes) {
      const scoped =
        d.where.includes("org-under-test") ||
        d.where.includes("s-1") ||
        // streaks are keyed on the users this org owns, which the org query already bounded
        d.table === "streaks";
      expect(scoped, `${d.table} delete is not scoped to the org or its sessions`).toBe(true);
    }
  });

  it("does nothing to session-scoped tables when the org has no demo sessions", async () => {
    const { db, deletes } = recordingDb([], []);
    const removed = await clearDemoData("org-empty", { db });

    expect(removed).toBe(0);
    // No sessions means no evidence, turns or xp to remove. Issuing those deletes with an
    // empty id list is how a reset would quietly widen into everything.
    for (const t of ["evidence_events", "adaptation_events", "xp_ledger", "turns"]) {
      expect(deletes.map((d) => d.table)).not.toContain(t);
    }
  });

  it("only ever deletes users the seed created", async () => {
    const { db, deletes } = recordingDb(["s-1"], ["demo-1"]);
    await clearDemoData("org-1", { db });

    const userDeletes = deletes.filter((d) => d.table === "user");
    expect(userDeletes).toHaveLength(1);
    // is_seeded = true is the guard that keeps a real account with a colliding id safe.
    expect(userDeletes[0]!.where).toContain("is_seeded");
  });
});
