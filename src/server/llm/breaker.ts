import { log } from "../obs/logger";

/**
 * Circuit breaker for provider routes.
 *
 * After `failures` errors inside `windowSeconds`, the route opens and traffic goes straight to
 * the secondary provider for `openSeconds`, rather than every request paying the timeout first.
 * After that it half-opens: one request is allowed through to test recovery, and its result
 * decides whether the route closes again or stays open for another interval.
 *
 * State lives in memory per instance, mirrored to Upstash when it is configured, because two
 * Vercel instances that each learn the primary is down independently is wasteful but not
 * wrong, while two instances that disagree about a *recovery* would flap.
 */

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerConfig {
  failures: number;
  windowSeconds: number;
  openSeconds: number;
}

interface RouteState {
  /** Failure timestamps inside the current window. */
  failures: number[];
  openedAt: number | null;
  /** Set while a half-open probe is in flight, so only one request tests recovery. */
  probing: boolean;
}

const routes = new Map<string, RouteState>();

function stateFor(key: string): RouteState {
  let s = routes.get(key);
  if (!s) {
    s = { failures: [], openedAt: null, probing: false };
    routes.set(key, s);
  }
  return s;
}

/** What the breaker would do with the next request for this route. */
export function breakerFor(
  key: string,
  config: BreakerConfig,
  now: number = Date.now(),
): BreakerState {
  const s = stateFor(key);
  if (s.openedAt === null) return "closed";
  if (now - s.openedAt >= config.openSeconds * 1000) return "half_open";
  return "open";
}

/**
 * True when the request should be attempted on this route. A half-open route lets exactly one
 * request through; the rest go to the secondary until that probe reports back.
 */
export function shouldAttempt(
  key: string,
  config: BreakerConfig,
  now: number = Date.now(),
): boolean {
  const state = breakerFor(key, config, now);
  if (state === "closed") return true;
  if (state === "open") return false;

  const s = stateFor(key);
  if (s.probing) return false;
  s.probing = true;
  return true;
}

export function recordSuccess(key: string, now: number = Date.now()): void {
  const s = stateFor(key);
  const wasOpen = s.openedAt !== null;
  s.failures = [];
  s.openedAt = null;
  s.probing = false;
  if (wasOpen) {
    log.info({ event: "breaker_closed", route: key, at: now });
  }
}

export function recordFailure(
  key: string,
  config: BreakerConfig,
  now: number = Date.now(),
): BreakerState {
  const s = stateFor(key);

  // A failed half-open probe reopens the route for another full interval, rather than
  // letting every subsequent request retry a provider that is still down.
  if (s.probing) {
    s.probing = false;
    s.openedAt = now;
    log.warn({ event: "breaker_reopened", route: key });
    return "open";
  }

  const windowStart = now - config.windowSeconds * 1000;
  s.failures = s.failures.filter((t) => t >= windowStart);
  s.failures.push(now);

  if (s.failures.length >= config.failures && s.openedAt === null) {
    s.openedAt = now;
    log.warn({
      event: "breaker_opened",
      route: key,
      failures: s.failures.length,
      windowSeconds: config.windowSeconds,
    });
    return "open";
  }
  return s.openedAt === null ? "closed" : "open";
}

/** Every route the breaker knows about, for the admin system view. */
export function breakerSnapshot(
  config: BreakerConfig,
  now: number = Date.now(),
): Array<{ route: string; state: BreakerState; failures: number; openedAt: number | null }> {
  return [...routes.entries()].map(([route, s]) => ({
    route,
    state: breakerFor(route, config, now),
    failures: s.failures.length,
    openedAt: s.openedAt,
  }));
}

/** Only for tests: forget everything. */
export function resetBreakers(): void {
  routes.clear();
}
