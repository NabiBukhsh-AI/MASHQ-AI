import { describe, expect, it } from "vitest";
import {
  applyRetentionBoost,
  calculateCallbackMetrics,
  checkPendingCallbacks,
  isCallbackDue,
  scheduleCallback,
} from "./callbacks";

describe("In-Session Retention Callbacks", () => {
  it("schedules callback at proficient with default 8-minute delay", () => {
    const t0 = new Date("2026-09-19T10:00:00.000Z");
    const cb = scheduleCallback("concept_update_details", t0, {}, "c_update_details");

    expect(cb.conceptId).toBe("concept_update_details");
    expect(cb.conceptKey).toBe("c_update_details");
    expect(cb.delayMinutes).toBe(8);
    expect(cb.scheduledAt.toISOString()).toBe("2026-09-19T10:00:00.000Z");
    expect(cb.dueAt.toISOString()).toBe("2026-09-19T10:08:00.000Z");
    expect(cb.fired).toBe(false);
  });

  it("checks callback due timing against fake clock", () => {
    const t0 = new Date("2026-09-19T10:00:00.000Z");
    const cb = scheduleCallback("concept_kyc", t0);

    // 5 minutes later: not due
    const t5 = new Date("2026-09-19T10:05:00.000Z");
    expect(isCallbackDue(cb, t5)).toBe(false);

    // 7 minutes 59 seconds: not due
    const t7m59 = new Date("2026-09-19T10:07:59.000Z");
    expect(isCallbackDue(cb, t7m59)).toBe(false);

    // Exactly 8 minutes: due
    const t8 = new Date("2026-09-19T10:08:00.000Z");
    expect(isCallbackDue(cb, t8)).toBe(true);

    // 12 minutes (worked example): due
    const t12 = new Date("2026-09-19T10:12:00.000Z");
    expect(isCallbackDue(cb, t12)).toBe(true);
  });

  it("fires only at beat boundaries (R12)", () => {
    const t0 = new Date("2026-09-19T10:00:00.000Z");
    const cb = scheduleCallback("c1", t0);
    const t10 = new Date("2026-09-19T10:10:00.000Z"); // Due

    // Mid-beat: should NOT fire
    const midBeat = checkPendingCallbacks([cb], t10, false);
    expect(midBeat).toBeNull();

    // Beat boundary: fires
    const beatBoundary = checkPendingCallbacks([cb], t10, true);
    expect(beatBoundary).not.toBeNull();
    expect(beatBoundary?.conceptId).toBe("c1");
  });

  it("reproduces the worked example retention boost to 2 decimal places", () => {
    // Before 8 minutes: no boost (base weight 0.80)
    expect(applyRetentionBoost(0.8, 5)).toBe(0.8);

    // Worked example: retention callback 12 min later gives w = 0.92
    // 0.8 * 1.15 = 0.92
    const boosted8m = applyRetentionBoost(0.8, 8);
    expect(boosted8m).toBe(0.92);

    const boosted12m = applyRetentionBoost(0.8, 12);
    expect(boosted12m).toBe(0.92);

    // Next day boost: 0.8 * 1.30 = 1.04, capped at 1.0
    const nextDay = applyRetentionBoost(0.8, 1440, true);
    expect(nextDay).toBe(1);
  });

  it("tracks callback success metrics accurately", () => {
    const history = [
      { completed: true, correct: true },
      { completed: true, correct: false },
      { completed: true, correct: true },
      { completed: false }, // Pending
    ];

    const metrics = calculateCallbackMetrics(history);
    expect(metrics.totalCallbacks).toBe(3);
    expect(metrics.successfulCallbacks).toBe(2);
    expect(metrics.successRate).toBe(0.667);
  });
});
