import { describe, it, expect } from "vitest";
import { listLibrary } from "./library";
import type { Db } from "../db/client";

/**
 * The library used to be a mock that returned a hardcoded "Sample Document", and its test
 * asserted exactly that, so it passed while showing nothing that had been uploaded. These pin
 * the two things that matter: the query is scoped to the caller's org, and a row is mapped
 * faithfully, including a document that has no journey yet.
 */
describe("content library", () => {
  const capture = (rows: Array<Record<string, unknown>>) => {
    let sent = "";
    const db = {
      execute: async (q: unknown) => {
        sent = JSON.stringify(q, (_k, v) => (typeof v === "bigint" ? String(v) : v));
        return { rows };
      },
    } as unknown as Db;
    return { db, sent: () => sent };
  };

  it("scopes the query to the caller's organization and hides deleted content", async () => {
    const { db, sent } = capture([]);
    await listLibrary("org-under-test", { db });
    expect(sent()).toContain("org-under-test");
    expect(sent()).toContain("deleted_at IS NULL");
  });

  it("limits a learner to playable journeys and finds their own session to continue", async () => {
    const all = capture([]);
    await listLibrary("org-1", { db: all.db, userId: "manager-1" });
    expect(all.sent()).not.toContain("AND EXISTS");
    expect(all.sent()).toContain("manager-1");

    const learner = capture([]);
    await listLibrary("org-1", { db: learner.db, userId: "learner-1", playableOnly: true });
    expect(learner.sent()).toContain("AND EXISTS");
    expect(learner.sent()).toContain("learner-1");
  });

  it("maps a document with its journey and mission readiness", async () => {
    const { db } = capture([
      {
        id: "c1",
        title: "Cash Handling SOP",
        source_type: "paste",
        lang_primary: "en",
        status: "ready",
        created_at: "2026-09-21T10:00:00.000Z",
        chars: 3330,
        uploaded_by: "Demo Admin",
        journey_id: "j1",
        journey_title: "Counting Every Note Twice",
        journey_status: "ready",
        missions: 8,
        ready_missions: 3,
        topics: ["Opening float", "Counterfeit notes"],
      },
    ]);
    const [item] = await listLibrary("org-1", { db });
    expect(item).toMatchObject({
      title: "Cash Handling SOP",
      language: "en",
      uploadedBy: "Demo Admin",
      journey: { title: "Counting Every Note Twice", missions: 8, readyMissions: 3 },
      topics: ["Opening float", "Counterfeit notes"],
    });
  });

  it("reports a document whose journey has not been designed yet", async () => {
    const { db } = capture([
      {
        id: "c2",
        title: "Just uploaded",
        source_type: "pdf",
        lang_primary: null,
        status: "intake",
        created_at: "2026-09-21T10:00:00.000Z",
        chars: null,
        uploaded_by: null,
        journey_id: null,
        topics: [],
      },
    ]);
    const [item] = await listLibrary("org-1", { db });
    expect(item?.journey).toBeNull();
    expect(item?.topics).toEqual([]);
  });
});
