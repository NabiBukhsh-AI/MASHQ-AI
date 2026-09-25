import type { Config } from "../config/schema";
import type { RawUsage } from "./types";

/** USD for one call from the config price table; unknown models cost 0 and are logged upstream. */
export function costUsd(pricing: Config["llm"]["pricing"], model: string, u: RawUsage): number {
  const p = pricing[model];
  if (!p) return 0;
  const perToken = (perM: number) => perM / 1_000_000;
  const usd =
    u.inputTokens * perToken(p.inPerM) +
    u.cacheReadTokens * perToken(p.inPerM) * p.cacheReadMult +
    u.cacheWriteTokens * perToken(p.inPerM) * p.cacheWriteMult +
    u.outputTokens * perToken(p.outPerM);
  return Math.round(usd * 1e6) / 1e6;
}
