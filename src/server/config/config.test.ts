import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_INPUT } from "./defaults";
import { PRESETS } from "./presets";
import { ConfigSchema } from "./schema";
import { deepMerge } from "./merge";
import { diff, summarize } from "./json-patch";
import { semanticErrors } from "./semantic";
import {
  ConfigValidationError,
  hashConfig,
  resolveConfig,
  stableStringify,
  validateConfig,
} from "./resolve";

const base = validateConfig({ ...DEFAULT_CONFIG, presets: PRESETS });

describe("schema and defaults", () => {
  it("code defaults validate and fill schema defaults", () => {
    expect(DEFAULT_CONFIG.grounding.strictness).toBe("strict");
    expect(DEFAULT_CONFIG.mastery.bands).toEqual({
      developing: 0.4,
      proficient: 0.7,
      mastered: 0.9,
    });
    expect(DEFAULT_CONFIG.evidence.hintDiscount).toEqual([0, 0.3, 0.55, 0.8]);
    expect(DEFAULT_CONFIG.personas.map((p) => p.id)).toEqual([
      "branch_new_joiner",
      "branch_officer",
      "back_office_specialist",
      "senior_manager",
    ]);
  });

  it("rejects invalid values with field paths", () => {
    const bad = deepMerge(DEFAULT_CONFIG_INPUT, {
      mastery: { transit: 0.9 },
      limits: { dailySpendCapUsd: 1000 },
    });
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("mastery.transit");
    expect(paths).toContain("limits.dailySpendCapUsd");
  });

  it("validateConfig throws readable messages with paths", () => {
    expect(() =>
      validateConfig(deepMerge(DEFAULT_CONFIG, { engine: { maxOutputTokens: 5 } })),
    ).toThrowError(/engine\.maxOutputTokens/);
  });
});

describe("semantic checks", () => {
  it("passes on the defaults", () => {
    expect(semanticErrors(base)).toEqual([]);
  });

  it.each([
    [{ mastery: { bands: { developing: 0.8 } } }, /strictly increasing/],
    [
      {
        mechanics: {
          enabled: {
            scenario: false,
            roleplay: false,
            puzzle: false,
            decision: false,
            teach_back: false,
            final_challenge: false,
          },
        },
      },
      /at least one mechanic/,
    ],
    [{ content: { chunk: { targetTokens: 800, maxTokens: 700 } } }, /maxTokens/],
    [
      { llm: { routes: { "turn.respond": { tier: "design", byLanguage: { ur: "fallback" } } } } },
      /^$/,
    ],
    [{ llm: { tiers: { fallback: { provider: "anthropic", model: "x" } } } }, /different provider/],
    [{ learner: { defaultPersonaId: "ghost" } }, /not one of the personas/],
    [{ language: { default: "ur", enabled: ["en"] } }, /not in language.enabled/],
    [
      { presets: { broken: { label: "b", labelUr: "b", patch: { session: { maxMinutes: 1 } } } } },
      /presets.broken/,
    ],
  ])("reports a readable message for %j", (patch, re) => {
    const candidate = ConfigSchema.parse(deepMerge(base, patch));
    const errors = semanticErrors(candidate);
    if (re.source === "^$") expect(errors).toEqual([]);
    else expect(errors.join(" ")).toMatch(re);
  });

  it("rejects a preset that breaks a semantic rule once applied", () => {
    const candidate = ConfigSchema.parse(
      deepMerge(base, {
        language: { enabled: ["en"] },
        presets: { urdu_first: PRESETS.urdu_first },
      }),
    );
    expect(semanticErrors(candidate).join(" ")).toMatch(/presets\.urdu_first breaks a rule/);
  });

  it("every built-in preset validates when merged over the defaults", () => {
    for (const [id, preset] of Object.entries(PRESETS)) {
      expect(() => validateConfig(deepMerge(base, preset.patch)), id).not.toThrow();
    }
    expect(Object.keys(PRESETS)).toHaveLength(8);
  });
});

describe("resolution order", () => {
  it("applies org, content, persona, presets in order, then learner choices", () => {
    const r = resolveConfig({
      org: base,
      contentOverride: { grounding: { strictness: "assisted" }, session: { maxMinutes: 30 } },
      personaId: "senior_manager",
      presets: ["urdu_first", "audio_off", "micro_session"],
      learnerChoices: { language: "ur-Latn" },
    });
    expect(r.layers).toEqual([
      "org",
      "content",
      "persona:senior_manager",
      "preset:urdu_first",
      "preset:audio_off",
      "preset:micro_session",
      "learner",
    ]);
    expect(r.config.grounding.strictness).toBe("assisted"); // content
    expect(r.config.language.register).toBe("formal"); // persona
    expect(r.config.learner.defaultPersonaId).toBe("senior_manager"); // persona
    expect(r.config.voice.output.enabled).toBe(false); // audio_off after urdu_first
    expect(r.config.session.maxMinutes).toBe(5); // preset over content
    expect(r.config.language.default).toBe("ur-Latn"); // learner over preset
  });

  it("later presets win over earlier ones", () => {
    const a = resolveConfig({ org: base, presets: ["audio_off", "urdu_first"] });
    const b = resolveConfig({ org: base, presets: ["urdu_first", "audio_off"] });
    expect(a.config.voice.output.enabled).toBe(true);
    expect(b.config.voice.output.enabled).toBe(false);
  });

  it("ignores unknown persona and preset ids", () => {
    const r = resolveConfig({ org: base, personaId: "nobody", presets: ["nope"] });
    expect(r.layers).toEqual(["org"]);
    expect(r.hash).toBe(hashConfig(base));
  });

  it("rejects a resolved config that breaks a semantic rule", () => {
    expect(() =>
      resolveConfig({ org: base, contentOverride: { mastery: { bands: { proficient: 0.95 } } } }),
    ).toThrowError(ConfigValidationError);
  });
});

describe("hash and diff", () => {
  it("equal configs hash equally regardless of key order", () => {
    const reordered = JSON.parse(stableStringify(base));
    const shuffled = { ...reordered, ui: { ...reordered.ui }, branding: { ...reordered.branding } };
    expect(hashConfig(shuffled)).toBe(hashConfig(base));
    expect(hashConfig(deepMerge(base, { ui: { textScale: 1.25 } }))).not.toBe(hashConfig(base));
  });

  it("diff produces RFC 6902 ops and a readable summary", () => {
    const next = deepMerge(base, {
      grounding: { strictness: "assisted" },
      session: { maxMinutes: 30 },
    });
    const ops = diff(base, next);
    expect(ops).toEqual([
      { op: "replace", path: "/session/maxMinutes", value: 30 },
      { op: "replace", path: "/grounding/strictness", value: "assisted" },
    ]);
    expect(summarize(ops)).toBe(
      'session.maxMinutes is now 30, grounding.strictness is now "assisted"',
    );
    expect(diff({ a: { b: 1 } }, { a: {} })).toEqual([{ op: "remove", path: "/a/b" }]);
    expect(diff({}, { "x/y": 1 })).toEqual([{ op: "add", path: "/x~1y", value: 1 }]);
  });
});
