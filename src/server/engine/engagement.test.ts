import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config/defaults";
import {
  EMPTY_ENGAGEMENT,
  engagementFlags,
  latencyTrend,
  matchesAny,
  paceOf,
  updateEngagement,
  type EngagementAction,
} from "./engagement";

const config = DEFAULT_CONFIG.engagement;
const t0 = 1_800_000_000_000;

function run(actions: EngagementAction[]) {
  let s = EMPTY_ENGAGEMENT;
  const trace: number[] = [];
  actions.forEach((a, i) => {
    s = updateEngagement(s, { now: t0 + i * 20_000, ...a }, config).state;
    trace.push(s.frustration);
  });
  return { state: s, trace };
}

describe("frustration", () => {
  it('"pata nahi" twice on the same question trips the frustrated flag with default settings', () => {
    const { state, trace } = run([
      { mode: "text", text: "pata nahi", verdict: "not_an_answer", questionId: "q1" },
      { mode: "text", text: "pata nahi", verdict: "not_an_answer", questionId: "q1" },
    ]);
    // Exact 8.4 EWMA: 0.4 * 0.55 = 0.22, then 0.4 * 0.8 + 0.6 * 0.22 = 0.452, rising.
    expect(trace[0]).toBeCloseTo(0.22, 3);
    expect(state.frustration).toBeCloseTo(0.452, 3);
    expect(state.idkStreak).toBe(2);
    expect(engagementFlags(state, config).frustrated).toBe(true);
    // The trigger holds anywhere in the session, not only at the start.
    const mid = run([
      { mode: "tap", verdict: "incorrect", questionId: "q1" },
      { mode: "text", text: "Greet first", verdict: "correct", questionId: "q1" },
      { mode: "text", text: "pata nahi", verdict: "not_an_answer", questionId: "q2" },
      { mode: "text", text: "nahi pata", verdict: "not_an_answer", questionId: "q2" },
    ]).state;
    expect(engagementFlags(mid, config).frustrated).toBe(true);
    // One "I don't know" alone is not frustration.
    const once = run([
      { mode: "text", text: "pata nahi", verdict: "not_an_answer", questionId: "q1" },
    ]).state;
    expect(engagementFlags(once, config).frustrated).toBe(false);
  });

  it("matches the three-language pattern lists from config, case and space insensitive", () => {
    expect(matchesAny("  Pata  NAHI yaar", config.idkPatterns)).toBe(true);
    expect(matchesAny("پتہ نہیں", config.idkPatterns)).toBe(true);
    expect(matchesAny("Samajh nahi aa raha", config.frustrationPhrases)).toBe(true);
    expect(matchesAny("Greet the customer first", config.idkPatterns)).toBe(false);
  });

  it("a good answer after a wrong streak brings frustration down, not to zero at once", () => {
    const { trace } = run([
      { mode: "text", text: "type it in", verdict: "incorrect", questionId: "q1" },
      { mode: "text", text: "call someone", verdict: "incorrect", questionId: "q1" },
      {
        mode: "text",
        text: "Greet within thirty seconds and listen",
        verdict: "correct",
        questionId: "q1",
      },
    ]);
    expect(trace[1]).toBeGreaterThan(trace[0]!);
    expect(trace[2]).toBeLessThan(trace[1]!);
    expect(trace[2]).toBeGreaterThan(0);
  });

  it("the wrong streak resets on a new question; idle and start do not move frustration", () => {
    const { state } = run([
      { mode: "text", text: "no", verdict: "incorrect", questionId: "q1" },
      { mode: "text", text: "no", verdict: "incorrect", questionId: "q2" },
    ]);
    expect(state.streakWrong).toBe(1);
    const before = state.frustration;
    const after = updateEngagement(state, { mode: "idle", now: t0 + 90_000 }, config).state;
    expect(after.frustration).toBe(before);
    expect(after.idleCount).toBe(1);
  });
});

describe("fatigue", () => {
  it("a rising latency trend raises fatigue; flat latencies do not", () => {
    const flat = run(
      [9000, 9000, 9000, 9000, 9000, 9000].map((latencyMs) => ({
        mode: "text" as const,
        text: "An answer with enough words",
        verdict: "correct" as const,
        latencyMs,
      })),
    ).state;
    const rising = run(
      [8000, 8000, 8000, 20000, 22000, 24000].map((latencyMs) => ({
        mode: "text" as const,
        text: "An answer with enough words",
        verdict: "correct" as const,
        latencyMs,
      })),
    ).state;
    expect(latencyTrend(flat.latencies, config.latencyTrendMinSamples)).toBe(0);
    expect(latencyTrend(rising.latencies, config.latencyTrendMinSamples)).toBeCloseTo(1.75, 2);
    expect(rising.fatigue).toBeGreaterThan(flat.fatigue);
    // The trend term is 0.3 * latencyTrend inside the outer clip, not capped at 0.3.
    expect(rising.fatigue).toBeGreaterThanOrEqual(0.3 * 1.75);
  });

  it("time on task counts capped gaps and idle nudges, so a resumed session is not tired", () => {
    let s = EMPTY_ENGAGEMENT;
    s = updateEngagement(s, { mode: "text", text: "first answer here", now: t0 }, config).state;
    // a day away: the gap is capped at activeGapCapSeconds
    s = updateEngagement(
      s,
      { mode: "text", text: "another answer here", now: t0 + 24 * 3_600_000 },
      config,
    ).state;
    expect(s.activeMs).toBe(config.activeGapCapSeconds * 1000);
    expect(engagementFlags(s, config).fatigued).toBe(false);
    // steady work for 30 minutes saturates the time term at 0.5
    let w = EMPTY_ENGAGEMENT;
    for (let i = 0; i <= 30; i++)
      w = updateEngagement(
        w,
        { mode: "text", text: "a full answer here", now: t0 + i * 60_000 },
        config,
      ).state;
    expect(w.fatigue).toBeCloseTo(0.5, 5);
    // idle nudges count once: answer at 0 s, nudges at 45 s and 90 s, answer at 100 s = 100 s on task
    let n = updateEngagement(
      EMPTY_ENGAGEMENT,
      { mode: "text", text: "first answer here", now: t0 },
      config,
    ).state;
    n = updateEngagement(n, { mode: "idle", now: t0 + 45_000 }, config).state;
    n = updateEngagement(n, { mode: "idle", now: t0 + 90_000 }, config).state;
    n = updateEngagement(
      n,
      { mode: "text", text: "second answer here", now: t0 + 100_000 },
      config,
    ).state;
    expect(n.activeMs).toBe(100_000);
  });

  it("pace compares the median latency with the persona baseline using the config ratios", () => {
    expect(paceOf([30000, 32000], 14000, config)).toBe("slow");
    expect(paceOf([5000, 6000], 14000, config)).toBe("fast");
    expect(paceOf([12000, 15000], 14000, config)).toBe("normal");
    expect(paceOf([5000], 14000, config)).toBe("normal");
  });
});

describe("modality suggestion", () => {
  it("typing three times while voice is on suggests text mode; a voice turn resets it", () => {
    const typed = { mode: "text" as const, text: "typed answer here", voiceOn: true };
    const { state } = run([typed, typed, typed]);
    expect(engagementFlags(state, config).suggestText).toBe(true);
    const reset = updateEngagement(state, { mode: "voice", text: "spoken" }, config).state;
    expect(engagementFlags(reset, config).suggestText).toBe(false);
  });
});
