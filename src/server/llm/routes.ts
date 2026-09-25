import type { Config, Lang, LlmRoute, Provider, Tier } from "../config/schema";
import { LlmError } from "./errors";

export interface ResolvedRoute {
  task: string;
  tier: Tier;
  provider: Provider;
  model: string;
  route: LlmRoute;
}

/** Task name to tier, provider and model. Per-language tier overrides apply first. */
export function resolveRoute(config: Config, task: string, lang?: Lang): ResolvedRoute {
  const route = config.llm.routes[task];
  if (!route) throw new LlmError("no_route", `No llm.routes entry for task "${task}".`);
  const tier = (lang && route.byLanguage?.[lang]) || route.tier;
  const target = config.llm.tiers[tier];
  if (!target) throw new LlmError("no_route", `Tier "${tier}" has no llm.tiers entry.`);
  return { task, tier, provider: target.provider, model: target.model, route };
}

/** The tier a failed call falls back to, or null when fallback is off or pointless. */
export function fallbackFor(config: Config, current: ResolvedRoute): ResolvedRoute | null {
  if (!config.llm.fallback.enabled || current.tier === "fallback" || current.tier === "embed")
    return null;
  const target = config.llm.tiers.fallback;
  if (!target || target.provider === current.provider) return null;
  return { ...current, tier: "fallback", provider: target.provider, model: target.model };
}
