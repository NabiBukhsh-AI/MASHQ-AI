import { ConfigSchema, type Config } from "./schema";
import { deepMerge } from "./merge";

/** Cross-field rules Zod cannot express. Returns readable messages. */
export function semanticErrors(config: Config): string[] {
  const errors: string[] = [];
  const { developing, proficient, mastered } = config.mastery.bands;
  if (!(developing < proficient && proficient < mastered)) {
    errors.push("mastery.bands must be strictly increasing: developing < proficient < mastered.");
  }
  if (!Object.values(config.mechanics.enabled).some(Boolean)) {
    errors.push("mechanics.enabled must keep at least one mechanic on.");
  }
  for (const lang of config.language.enabled) {
    if (!config.voice.tts.routes[lang])
      errors.push(`voice.tts.routes is missing a chain for enabled language "${lang}".`);
    if (!config.voice.speechMode[lang])
      errors.push(`voice.speechMode is missing an entry for enabled language "${lang}".`);
  }
  if (!config.language.enabled.includes(config.language.default)) {
    errors.push(`language.default "${config.language.default}" is not in language.enabled.`);
  }
  if (config.content.chunk.maxTokens < config.content.chunk.targetTokens) {
    errors.push("content.chunk.maxTokens must be at least content.chunk.targetTokens.");
  }
  for (const [name, route] of Object.entries(config.llm.routes)) {
    if (!config.llm.tiers[route.tier])
      errors.push(`llm.routes.${name} uses tier "${route.tier}" which has no entry in llm.tiers.`);
    for (const [lang, tier] of Object.entries(route.byLanguage ?? {})) {
      if (!config.llm.tiers[tier as keyof typeof config.llm.tiers])
        errors.push(`llm.routes.${name}.byLanguage.${lang} uses unknown tier "${tier}".`);
    }
  }
  const fallback = config.llm.tiers.fallback;
  const fast = config.llm.tiers.fast;
  const design = config.llm.tiers.design;
  if (
    fallback &&
    ((fast && fallback.provider === fast.provider) ||
      (design && fallback.provider === design.provider))
  ) {
    errors.push("llm.tiers.fallback must use a different provider from the fast and design tiers.");
  }
  if (!config.personas.some((p) => p.id === config.learner.defaultPersonaId)) {
    errors.push(
      `learner.defaultPersonaId "${config.learner.defaultPersonaId}" is not one of the personas.`,
    );
  }
  for (const [id, preset] of Object.entries(config.presets)) {
    const merged = ConfigSchema.safeParse(deepMerge(config, preset.patch));
    if (!merged.success) {
      errors.push(
        `presets.${id} does not validate when applied: ${merged.error.issues[0]?.path.join(".")} ${merged.error.issues[0]?.message}.`,
      );
      continue;
    }
    // Presets must also respect the cross-field rules once applied (no recursion into presets).
    const nested = semanticErrors({ ...merged.data, presets: {} });
    if (nested.length) errors.push(`presets.${id} breaks a rule when applied: ${nested[0]}`);
  }
  return errors;
}
