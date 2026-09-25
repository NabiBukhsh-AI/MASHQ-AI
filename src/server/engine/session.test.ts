import { describe, it, expect, vi } from "vitest";
import { createSession, loadSessionState } from "./session";
import type { Db } from "../db/client";

describe("Session Engine", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const otherOrgId = "00000000-0000-0000-0000-000000000002";
  const userId = "user-123";
  const otherUserId = "user-456";
  const journeyId = "journey-abc";

  const mockJourney = {
    id: journeyId,
    orgId,
    title: "Customer Verification",
  };

  const mockMission = {
    id: "mission-1",
    journeyId,
    ordinal: 0,
    title: "The First Minute",
    chapterKey: "ch_greet",
    packStatus: "ready",
    pack: { objective: "Greet customer promptly." },
  };

  it("creates a session with resolved config version and hash", async () => {
    let insertedSession: Record<string, unknown> | null = null;

    const mockDb: Partial<Db> = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockResolvedValue([mockJourney]),
            orderBy: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([mockMission]),
            })),
          })),
        })),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          insertedSession = vals;
          return Promise.resolve();
        }),
      })),
    };

    const mockGetOrgConfig = vi.fn().mockResolvedValue({
      version: 3,
      hash: "config-hash-xyz",
    });

    const sessionId = await createSession(
      {
        journeyId,
        userId,
        orgId,
        personaId: "branch_officer",
        language: "ur",
        presets: ["high_contrast"],
      },
      {
        db: mockDb as Db,
        getOrgConfig: mockGetOrgConfig,
      },
    );

    expect(sessionId).toBeDefined();
    expect(insertedSession).toBeDefined();
    expect(insertedSession!["userId"]).toBe(userId);
    expect(insertedSession!["orgId"]).toBe(orgId);
    expect(insertedSession!["journeyId"]).toBe(journeyId);
    expect(insertedSession!["currentMissionId"]).toBe("mission-1");
    expect(insertedSession!["personaId"]).toBe("branch_officer");
    expect(insertedSession!["language"]).toBe("ur");
    expect(insertedSession!["configVersion"]).toBe(3);
    expect(insertedSession!["configHash"]).toBe("config-hash-xyz");
    // No config returned means speech output cannot be confirmed on, so text.
    expect(insertedSession!["modality"]).toBe("text");
  });

  it("starts the session in voice when the org has speech output on", async () => {
    let insertedSession: Record<string, unknown> | undefined;
    const mockDb: Partial<Db> = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            orderBy: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([{ id: "mission-1" }]),
            })),
            limit: vi.fn().mockResolvedValue([{ id: journeyId, orgId, title: "J" }]),
          })),
        })),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          insertedSession = vals;
          return Promise.resolve();
        }),
      })),
    };

    await createSession(
      { journeyId, userId, orgId },
      {
        db: mockDb as Db,
        getOrgConfig: vi.fn().mockResolvedValue({
          version: 3,
          hash: "h",
          config: { voice: { output: { enabled: true } } },
        }),
      },
    );

    // The engine derives speechMode from modality, so a text session is silent forever.
    expect(insertedSession!["modality"]).toBe("voice");
  });

  it("throws not found when journey does not belong to user organization", async () => {
    const mockDb: Partial<Db> = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockResolvedValue([]), // No journey found for this org
          })),
        })),
      })),
    };

    await expect(
      createSession(
        {
          journeyId,
          userId,
          orgId: otherOrgId,
        },
        { db: mockDb as Db },
      ),
    ).rejects.toThrow("Journey not found or not accessible");
  });

  it("loads session state for owner", async () => {
    const mockSessionRow = {
      id: "session-123",
      orgId,
      userId,
      journeyId,
      currentMissionId: "mission-1",
      personaId: "branch_new_joiner",
      language: "en",
      presets: [],
      configVersion: 1,
      configHash: "hash-123",
      status: "active",
    };

    const mockDb: Partial<Db> = {
      select: vi.fn().mockImplementation((fields?: Record<string, unknown>) => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            // First call: load session
            if (!fields) {
              return {
                limit: vi.fn().mockResolvedValue([mockSessionRow]),
              };
            }
            // Journey title
            if ("title" in fields && !("ordinal" in fields)) {
              return {
                limit: vi.fn().mockResolvedValue([{ title: "Customer Verification" }]),
              };
            }
            // Missions
            if ("ordinal" in fields && !("text" in fields)) {
              return {
                orderBy: vi.fn().mockResolvedValue([mockMission]),
              };
            }
            // Turns
            return {
              orderBy: vi
                .fn()
                .mockResolvedValue([
                  { id: "turn-1", ordinal: 0, role: "tutor", text: "Hello! Welcome.", lang: "en" },
                ]),
            };
          }),
        })),
      })),
    };

    const state = await loadSessionState("session-123", userId, orgId, {
      db: mockDb as Db,
    });

    expect(state).not.toBeNull();
    expect(state?.sessionId).toBe("session-123");
    expect(state?.journeyTitle).toBe("Customer Verification");
    expect(state?.currentMission?.title).toBe("The First Minute");
    expect(state?.turns).toHaveLength(1);
    expect(state?.turns[0]?.text).toBe("Hello! Welcome.");
  });

  it("returns null when attempting to access another user's session (returns 404 to caller)", async () => {
    const mockDb: Partial<Db> = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockResolvedValue([]), // No session matches this user ID
          })),
        })),
      })),
    };

    const state = await loadSessionState("session-123", otherUserId, orgId, {
      db: mockDb as Db,
    });

    expect(state).toBeNull();
  });
});
