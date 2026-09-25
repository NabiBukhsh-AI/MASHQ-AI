import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/client";
import { spendDaily } from "../db/schema";
import type { Config } from "../config/schema";

export type SpendState = "ok" | "degrade" | "block";

const CACHE_MS = 15_000;
const cache = new Map<string, { usd: number; expires: number }>();

/** Calendar date in Asia/Karachi as YYYY-MM-DD, the spend_daily key. */
export function karachiDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function todaysSpendUsd(
  orgId: string,
  db: Db = defaultDb,
  now = new Date(),
): Promise<number> {
  const key = `${orgId}:${karachiDay(now)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.usd;
  const [row] = await db
    .select({ usd: sql<string>`coalesce(sum(${spendDaily.usd}), 0)` })
    .from(spendDaily)
    .where(and(eq(spendDaily.orgId, orgId), eq(spendDaily.day, karachiDay(now))));
  const usd = Number(row?.usd ?? 0);
  cache.set(key, { usd, expires: Date.now() + CACHE_MS });
  return usd;
}

/** ok below degradeAtPercent of the daily cap, degrade up to the cap, block at or above it. */
export function spendState(usd: number, limits: Config["limits"]): SpendState {
  if (usd >= limits.dailySpendCapUsd) return "block";
  if (usd >= (limits.dailySpendCapUsd * limits.degradeAtPercent) / 100) return "degrade";
  return "ok";
}

export async function checkSpend(
  orgId: string,
  limits: Config["limits"],
  db: Db = defaultDb,
): Promise<SpendState> {
  return spendState(await todaysSpendUsd(orgId, db), limits);
}

export async function recordSpend(
  orgId: string,
  provider: string,
  usd: number,
  tokens: number,
  db: Db = defaultDb,
  now = new Date(),
): Promise<void> {
  const day = karachiDay(now);
  await db
    .insert(spendDaily)
    .values({ orgId, day, provider, usd: usd.toFixed(4), tokens })
    .onConflictDoUpdate({
      target: [spendDaily.orgId, spendDaily.day, spendDaily.provider],
      set: {
        usd: sql`${spendDaily.usd} + ${usd.toFixed(4)}`,
        tokens: sql`${spendDaily.tokens} + ${tokens}`,
      },
    });
  const key = `${orgId}:${day}`;
  const hit = cache.get(key);
  if (hit) hit.usd += usd;
}

export function bustSpendCache() {
  cache.clear();
}
