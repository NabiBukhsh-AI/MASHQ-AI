import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  breakerFor,
  breakerSnapshot,
  recordFailure,
  recordSuccess,
  resetBreakers,
  shouldAttempt,
} from "./breaker";

const config = { failures: 3, windowSeconds: 60, openSeconds: 45 };
const KEY = "anthropic:claude-haiku-4-5";

describe("circuit breaker", () => {
  beforeEach(() => {
    resetBreakers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("stays closed while nothing has failed", () => {
    expect(breakerFor(KEY, config)).toBe("closed");
    expect(shouldAttempt(KEY, config)).toBe(true);
  });

  it("opens after the configured failures inside the window", () => {
    const t = 1_000_000;
    recordFailure(KEY, config, t);
    recordFailure(KEY, config, t + 1000);
    expect(breakerFor(KEY, config, t + 1000)).toBe("closed");

    recordFailure(KEY, config, t + 2000);
    expect(breakerFor(KEY, config, t + 2000)).toBe("open");
    expect(shouldAttempt(KEY, config, t + 2000)).toBe(false);
  });

  it("does not open on failures spread beyond the window", () => {
    const t = 1_000_000;
    recordFailure(KEY, config, t);
    recordFailure(KEY, config, t + 30_000);
    // The first failure has aged out of the 60 s window by now.
    recordFailure(KEY, config, t + 70_000);
    expect(breakerFor(KEY, config, t + 70_000)).toBe("closed");
  });

  it("half opens once the open interval has passed", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) recordFailure(KEY, config, t + i);
    expect(breakerFor(KEY, config, t + 44_000)).toBe("open");
    expect(breakerFor(KEY, config, t + 45_003)).toBe("half_open");
  });

  it("lets exactly one request probe recovery while half open", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) recordFailure(KEY, config, t + i);
    const later = t + 46_000;

    expect(shouldAttempt(KEY, config, later)).toBe(true);
    // Everything else goes to the secondary rather than piling onto a sick provider.
    expect(shouldAttempt(KEY, config, later)).toBe(false);
    expect(shouldAttempt(KEY, config, later)).toBe(false);
  });

  it("closes again when the probe succeeds", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) recordFailure(KEY, config, t + i);
    const later = t + 46_000;
    shouldAttempt(KEY, config, later);

    recordSuccess(KEY, later);
    expect(breakerFor(KEY, config, later)).toBe("closed");
    expect(shouldAttempt(KEY, config, later)).toBe(true);
  });

  it("reopens for another full interval when the probe fails", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) recordFailure(KEY, config, t + i);
    const later = t + 46_000;
    shouldAttempt(KEY, config, later);

    recordFailure(KEY, config, later);
    expect(breakerFor(KEY, config, later)).toBe("open");
    // And it is a fresh interval, not the remainder of the old one.
    expect(breakerFor(KEY, config, later + 44_000)).toBe("open");
    expect(breakerFor(KEY, config, later + 46_000)).toBe("half_open");
  });

  it("a success clears the failure count, so old failures cannot accumulate", () => {
    const t = 1_000_000;
    recordFailure(KEY, config, t);
    recordFailure(KEY, config, t + 100);
    recordSuccess(KEY, t + 200);
    recordFailure(KEY, config, t + 300);
    expect(breakerFor(KEY, config, t + 300)).toBe("closed");
  });

  it("keeps routes independent, so one bad model does not disable another", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) recordFailure("provider-a:model-1", config, t + i);
    expect(breakerFor("provider-a:model-1", config, t)).toBe("open");
    expect(breakerFor("provider-b:model-2", config, t)).toBe("closed");
  });

  it("reports every known route for the system view", () => {
    const t = 1_000_000;
    recordFailure("a:1", config, t);
    for (let i = 0; i < 3; i++) recordFailure("b:2", config, t + i);

    const snap = breakerSnapshot(config, t + 5);
    expect(snap).toHaveLength(2);
    expect(snap.find((r) => r.route === "b:2")?.state).toBe("open");
    expect(snap.find((r) => r.route === "a:1")?.state).toBe("closed");
  });
});
