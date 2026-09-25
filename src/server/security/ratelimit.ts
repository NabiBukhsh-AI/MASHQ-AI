import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { redis as defaultRedis } from "../db/redis";
import { log } from "../obs/logger";

export type RateLimitRule =
  | "perIpPerMinute"
  | "perIp"
  | "turnsPerUserPerMinute"
  | "turns"
  | "chat"
  | "ingestsPerUserPerHour"
  | "ingest"
  | "voiceKeysPerUserPerMinute"
  | "voiceKeys"
  | "ttsPerUserPerMinute"
  | "tts"
  | "loginPerIpPerMinute"
  | "login"
  | "auth"
  | "inspector"
  | "analytics"
  | "exports";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetMs: number;
}

export interface LimitOptions {
  redis?: Redis | null;
  now?: () => number;
}

interface RuleConfig {
  count: number;
  windowStr: `${number} ${"s" | "m" | "h" | "d"}`;
  windowMs: number;
}

const RULE_CONFIGS: Record<RateLimitRule, RuleConfig> = {
  perIpPerMinute: { count: 120, windowStr: "1 m", windowMs: 60_000 },
  perIp: { count: 120, windowStr: "1 m", windowMs: 60_000 },
  turnsPerUserPerMinute: { count: 20, windowStr: "1 m", windowMs: 60_000 },
  turns: { count: 20, windowStr: "1 m", windowMs: 60_000 },
  chat: { count: 20, windowStr: "1 m", windowMs: 60_000 },
  ingestsPerUserPerHour: { count: 10, windowStr: "1 h", windowMs: 3_600_000 },
  ingest: { count: 10, windowStr: "1 h", windowMs: 3_600_000 },
  voiceKeysPerUserPerMinute: { count: 8, windowStr: "1 m", windowMs: 60_000 },
  voiceKeys: { count: 8, windowStr: "1 m", windowMs: 60_000 },
  ttsPerUserPerMinute: { count: 90, windowStr: "1 m", windowMs: 60_000 },
  tts: { count: 90, windowStr: "1 m", windowMs: 60_000 },
  inspector: { count: 60, windowStr: "1 m", windowMs: 60_000 },
  // Dashboard reads aggregate across sessions, so they are metered separately from
  // ordinary page traffic. One dashboard paint is about 7 requests.
  analytics: { count: 60, windowStr: "1 m", windowMs: 60_000 },
  exports: { count: 10, windowStr: "1 m", windowMs: 60_000 },
  loginPerIpPerMinute: { count: 10, windowStr: "1 m", windowMs: 60_000 },
  login: { count: 10, windowStr: "1 m", windowMs: 60_000 },
  auth: { count: 10, windowStr: "1 m", windowMs: 60_000 },
};

// In-memory sliding window bucket: key -> sorted list of hit timestamps
const memoryBuckets = new Map<string, number[]>();
const MEMORY_BUCKET_CAP = 10_000;
let lastErrorLogTime = 0;

/** Log fallback engagement at most once per 60 seconds to avoid log spamming. */
function logFallbackOnce(err: unknown) {
  const now = Date.now();
  if (now - lastErrorLogTime > 60_000) {
    lastErrorLogTime = now;
    log.warn({
      event: "redis_ratelimit_fallback_engaged",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Local in-memory sliding window rate limiter. */
function inMemoryLimit(
  ruleName: RateLimitRule,
  key: string,
  nowMs: number = Date.now(),
): RateLimitResult {
  const rule = RULE_CONFIGS[ruleName] ?? RULE_CONFIGS.perIp;
  const bucketKey = `${ruleName}:${key}`;
  const windowStart = nowMs - rule.windowMs;

  const existing = memoryBuckets.get(bucketKey) ?? [];
  const valid = existing.filter((t) => t > windowStart);
  if (valid.length === 0) memoryBuckets.delete(bucketKey);
  // ponytail: bounded map, drop the oldest key past the cap; per-instance only.
  if (!memoryBuckets.has(bucketKey) && memoryBuckets.size >= MEMORY_BUCKET_CAP) {
    const oldest = memoryBuckets.keys().next().value;
    if (oldest !== undefined) memoryBuckets.delete(oldest);
  }

  if (valid.length < rule.count) {
    valid.push(nowMs);
    memoryBuckets.set(bucketKey, valid);
    return {
      ok: true,
      remaining: rule.count - valid.length,
      resetMs: rule.windowMs,
    };
  }

  // Rate limit exceeded: calculate time until oldest hit leaves the sliding window
  const oldest = valid[0] ?? nowMs;
  const resetMs = Math.max(1000, oldest + rule.windowMs - nowMs);
  memoryBuckets.set(bucketKey, valid);

  return {
    ok: false,
    remaining: 0,
    resetMs,
  };
}

// Cache of Upstash Ratelimit instances per redis client and rule
const limiterCache = new WeakMap<Redis, Map<RateLimitRule, Ratelimit>>();

function getUpstashLimiter(client: Redis, ruleName: RateLimitRule): Ratelimit {
  let byRule = limiterCache.get(client);
  if (!byRule) {
    byRule = new Map();
    limiterCache.set(client, byRule);
  }

  let limiter = byRule.get(ruleName);
  if (!limiter) {
    const config = RULE_CONFIGS[ruleName] ?? RULE_CONFIGS.perIp;
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(config.count, config.windowStr),
      prefix: `mashq:rl:${ruleName}`,
    });
    byRule.set(ruleName, limiter);
  }

  return limiter;
}

/**
 * Evaluate rate limit for a given key and rule.
 * Uses Upstash Redis sliding window by default.
 * If Redis is unavailable or throws an error, gracefully falls back to local in-memory tracking.
 */
export async function limit(
  ruleName: RateLimitRule,
  key: string,
  options?: LimitOptions,
): Promise<RateLimitResult> {
  const redisClient = options?.redis !== undefined ? options.redis : defaultRedis;
  const nowMs = options?.now ? options.now() : Date.now();

  if (!redisClient) {
    return inMemoryLimit(ruleName, key, nowMs);
  }

  try {
    const upstashLimiter = getUpstashLimiter(redisClient, ruleName);
    const res = await upstashLimiter.limit(key);
    const resetMs = Math.max(1000, res.reset - nowMs);

    return {
      ok: res.success,
      remaining: res.remaining,
      resetMs,
    };
  } catch (err) {
    logFallbackOnce(err);
    return inMemoryLimit(ruleName, key, nowMs);
  }
}

/**
 * Simplified boolean check for rate limits.
 */
export async function rateLimitCheck(
  key: string,
  ruleName: RateLimitRule,
  options?: LimitOptions,
): Promise<boolean> {
  const res = await limit(ruleName, key, options);
  return res.ok;
}

/** Clear all in-memory buckets and reset log timers (used in tests). */
export function resetRatelimitMemory(): void {
  memoryBuckets.clear();
  lastErrorLogTime = 0;
}
