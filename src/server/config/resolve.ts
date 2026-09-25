import crypto from "node:crypto";
import { ConfigSchema, type Config, type ConfigPatch, type Lang } from "./schema";
import { deepMerge } from "./merge";
import { semanticErrors } from "./semantic";

/** Learner-controlled choices. */
export interface LearnerChoices {
  language?: Lang;
}

export interface ResolveInput {
  /** The active org config (already validated). */
  org: Config;
  /** `contents.config_override` for the content in play. */
  contentOverride?: ConfigPatch | null;
  personaId?: string | null;
  /** Preset ids in the order they were applied. */
  presets?: string[];
  learnerChoices?: LearnerChoices | null;
}

export interface Resolved {
  config: Config;
  hash: string;
  layers: string[];
}

export class ConfigValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "ConfigValidationError";
  }
}

/** Parse plus semantic checks. Throws ConfigValidationError with readable messages. */
export function validateConfig(candidate: unknown): Config {
  const parsed = ConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`),
    );
  }
  const problems = semanticErrors(parsed.data);
  if (problems.length) throw new ConfigValidationError(problems);
  return parsed.data;
}

/** Stable hash of the resolved object: equal configs hash equally regardless of key order. */
export function hashConfig(config: Config): string {
  return crypto.createHash("sha256").update(stableStringify(config)).digest("hex").slice(0, 16);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Resolution order, later wins: code defaults are already
 * inside the org config; then content override, persona, presets in order,
 * learner choices. Personas contribute register and default persona id; their
 * other fields are read by the engine from `config.personas`.
 */
export function resolveConfig(input: ResolveInput): Resolved {
  const layers: string[] = ["org"];
  let merged: unknown = input.org;

  if (input.contentOverride && Object.keys(input.contentOverride).length) {
    merged = deepMerge(merged, input.contentOverride);
    layers.push("content");
  }

  if (input.personaId) {
    const persona = input.org.personas.find((p) => p.id === input.personaId);
    if (persona) {
      merged = deepMerge(merged, {
        learner: { defaultPersonaId: persona.id },
        language: { register: persona.register },
      });
      layers.push(`persona:${persona.id}`);
    }
  }

  for (const id of input.presets ?? []) {
    const preset = input.org.presets[id];
    if (!preset) continue;
    merged = deepMerge(merged, preset.patch);
    layers.push(`preset:${id}`);
  }

  const choices = input.learnerChoices;
  if (choices?.language) {
    merged = deepMerge(merged, { language: { default: choices.language } });
    layers.push("learner");
  }

  const config = validateConfig(merged);
  return { config, hash: hashConfig(config), layers };
}
