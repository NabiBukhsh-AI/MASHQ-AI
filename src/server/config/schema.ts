import { z } from "zod";

// Every threshold the engine uses lives here, never as a literal.

export const Lang = z.enum(["en", "ur", "ur-Latn", "mixed"]);
export type Lang = z.infer<typeof Lang>;
export const Mechanic = z.enum([
  "scenario",
  "roleplay",
  "puzzle",
  "decision",
  "teach_back",
  "final_challenge",
]);
export type Mechanic = z.infer<typeof Mechanic>;
export const Tier = z.enum(["design", "fast", "fallback", "embed"]);
export type Tier = z.infer<typeof Tier>;
export const Provider = z.enum(["anthropic", "google"]);
export type Provider = z.infer<typeof Provider>;
const unit = z.number().min(0).max(1);

export const Persona = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  labelUr: z.string().min(1),
  level: z.enum(["novice", "intermediate", "expert"]),
  pInit: unit,
  startDifficulty: z.number().int().min(1).max(5),
  pace: z.enum(["slow", "normal", "fast"]),
  turnLength: z.enum(["short", "normal"]),
  register: z.enum(["colleague", "formal"]),
  exampleDomain: z.enum(["branch_counter", "back_office", "management", "digital_channels"]),
  mechanicWeights: z.record(Mechanic, unit),
  latencyBaselineMs: z.number().int().min(2000).max(60000),
});
export type Persona = z.infer<typeof Persona>;

export const LlmRoute = z.object({
  tier: Tier,
  maxOutputTokens: z.number().int().min(16).max(16000),
  temperature: z.number().min(0).max(1),
  timeoutMs: z.number().int().min(1000).max(240_000),
  firstTokenTimeoutMs: z.number().int().min(500).max(60_000),
  byLanguage: z.partialRecord(Lang, Tier).optional(),
});
export type LlmRoute = z.infer<typeof LlmRoute>;

export const ConfigSchema = z.object({
  schemaVersion: z.literal(1),
  branding: z.object({
    productName: z.string().max(40).default("Mashq"),
    orgDisplayName: z.string().max(60).default("Demo Bank"),
    guideCharacterName: z.string().max(30).default("Sana"),
  }),
  learner: z.object({
    defaultPersonaId: z.string().default("branch_new_joiner"),
    allowSelfSelectPersona: z.boolean().default(true),
  }),
  personas: z.array(Persona).min(1).max(12),
  content: z.object({
    learnerUploads: z.boolean().default(true),
    maxUploadMB: z.number().min(0.5).max(4).default(4),
    browserExtract: z.object({
      enabled: z.boolean().default(true),
      maxFileMB: z.number().min(1).max(100).default(50),
    }),
    maxPages: z.number().int().min(1).max(300).default(150),
    maxSlides: z.number().int().min(1).max(300).default(150),
    maxChars: z.number().int().min(1000).max(1_000_000).default(400_000),
    allowedTypes: z.array(z.enum(["pdf", "docx", "pptx", "txt", "md", "paste", "url", "image"])),
    url: z.object({
      enabled: z.boolean().default(true),
      timeoutMs: z.number().int().min(1000).max(20000).default(8000),
      maxBytes: z.number().int().min(100_000).max(5_000_000).default(3_000_000),
      maxRedirects: z.number().int().min(0).max(5).default(3),
      allowDomains: z.array(z.string()).default([]),
      blockDomains: z.array(z.string()).default([]),
    }),
    scanned: z.object({
      enabled: z.boolean().default(true),
      maxPages: z.number().int().min(1).max(50).default(20),
    }),
    chunk: z.object({
      targetTokens: z.number().int().min(200).max(800).default(500),
      maxTokens: z.number().int().min(300).max(1500).default(800),
      overlapTokens: z.number().int().min(0).max(200).default(60),
    }),
    design: z.object({
      maxConcepts: z.number().int().min(3).max(30).default(12),
      maxChapters: z.number().int().min(1).max(8).default(4),
      missionsPerChapter: z.number().int().min(1).max(4).default(2),
      /** Journey length follows the document: about one mission per this many tokens, from 1
       * up to maxChapters x missionsPerChapter. A short text no longer gets eight thin missions. */
      tokensPerMission: z.number().int().min(100).max(5000).default(500),
      fullDocMaxTokens: z.number().int().min(5000).max(200_000).default(60_000),
    }),
    overrides: z.record(z.string(), z.unknown()).default({}),
  }),
  language: z.object({
    enabled: z.array(Lang).default(["en", "ur", "ur-Latn", "mixed"]),
    default: Lang.default("en"),
    autoSwitch: z.boolean().default(true),
    autoSwitchTurns: z.number().int().min(1).max(5).default(2),
    urduDigits: z.enum(["western", "eastern"]).default("western"),
    tone: z.enum(["warm", "neutral"]).default("warm"),
    register: z.enum(["colleague", "formal"]).default("colleague"),
  }),
  session: z.object({
    maxMinutes: z.number().int().min(3).max(120).default(45),
    historyTurns: z.number().int().min(4).max(40).default(16),
  }),
  difficulty: z.object({
    levels: z.literal(5),
    curve: z.enum(["gentle", "standard", "steep"]).default("standard"),
    stepUpAfterCorrect: z.number().int().min(1).max(5).default(2),
    stepDownAfterIncorrect: z.number().int().min(1).max(5).default(2),
  }),
  mechanics: z.object({
    enabled: z.record(Mechanic, z.boolean()),
    weights: z.record(Mechanic, unit),
    maxRepeat: z.number().int().min(1).max(5).default(2),
    /** Score penalty per recent repeat of a mechanic; at maxRepeat the penalty is 1. */
    repeatPenalty: unit.default(0.15),
  }),
  mastery: z.object({
    transit: z.number().min(0).max(0.3).default(0.08),
    slip: z.number().min(0).max(0.3).default(0.1),
    bands: z.object({
      developing: unit.default(0.4),
      proficient: unit.default(0.7),
      mastered: unit.default(0.9),
    }),
    masteredMinEvents: z.number().int().min(1).max(10).default(3),
    masteredMinSignalTypes: z.number().int().min(1).max(5).default(2),
    masteredMinLower: unit.default(0.6),
    bandK: z.number().min(0.1).max(1).default(0.5),
    forgetting: z.object({
      enabled: z.boolean().default(false),
      halfLifeDays: z.number().min(1).max(180).default(14),
    }),
  }),
  evidence: z.object({
    weights: z.object({
      choice: unit,
      puzzle: unit,
      decision: unit,
      free_text: unit,
      explanation: unit,
      application: unit,
      teach_back: unit,
      retention: unit,
    }),
    guess: z.object({
      puzzle: unit,
      decision: unit,
      free_text: unit,
      explanation: unit,
      application: unit,
      teach_back: unit,
      retention: unit,
      choiceMin: unit,
    }),
    hintDiscount: z.array(unit).length(4).default([0, 0.3, 0.55, 0.8]),
    partialDefault: unit.default(0.5),
    selfCorrectionCredit: unit.default(0.7),
    retentionBoost: z.object({
      sameSession: z.number().min(1).max(2).default(1.15),
      nextDay: z.number().min(1).max(2).default(1.3),
      minDelayMinutes: z.number().int().min(1).max(120).default(8),
    }),
  }),
  hints: z.object({
    maxLevel: z.literal(3),
    autoOfferAfterIncorrect: z.number().int().min(0).max(3).default(1),
    workedExampleAfterIncorrect: z.number().int().min(1).max(5).default(2),
    allowLearnerRequest: z.boolean().default(true),
  }),
  engagement: z.object({
    frustrationThreshold: unit.default(0.7),
    fatigueThreshold: unit.default(0.6),
    ewmaAlpha: unit.default(0.4),
    idleNudgeSeconds: z.number().int().min(15).max(600).default(45),
    shortAnswerChars: z.number().int().min(1).max(60).default(12),
    idkPatterns: z.array(z.string()).max(50),
    frustrationPhrases: z.array(z.string()).max(50),
    /** Consecutive "I don't know" replies on one question that count as frustrated. */
    idkRepeatTrigger: z.number().int().min(1).max(5).default(2),
    /** Typed turns in a row while voice is on before the UI suggests text mode. */
    typedWhileVoiceTrigger: z.number().int().min(1).max(10).default(3),
    /** A gap between actions longer than this is a break, not time on task. */
    activeGapCapSeconds: z.number().int().min(30).max(1800).default(180),
    /** Latency samples needed before the trend term counts. */
    latencyTrendMinSamples: z.number().int().min(2).max(20).default(6),
    /** Median latency over baseline times this is slow; under paceFastRatio is fast. */
    paceSlowRatio: z.number().min(1).max(5).default(1.5),
    paceFastRatio: z.number().min(0.1).max(1).default(0.6),
  }),
  policy: z.object({
    rulesEnabled: z.record(z.string(), z.boolean()),
    callbackDelayMinutes: z.number().int().min(1).max(120).default(8),
    unlockPrereqMin: unit.default(0.6),
    /** R02: seconds left in a micro session at which the tutor summarizes and bookmarks. */
    microSessionWrapSeconds: z.number().int().min(15).max(300).default(60),
  }),
  engine: z.object({
    assessmentMode: z.enum(["inline", "separate"]).default("inline"),
    rulesOnly: z.boolean().default(false),
    maxOutputTokens: z.number().int().min(100).max(1200).default(450),
  }),
  grounding: z.object({
    strictness: z.enum(["strict", "assisted"]).default("strict"),
    fullContextMaxTokens: z.number().int().min(2000).max(120_000).default(24_000),
    retrieval: z.object({
      enabled: z.boolean().default(true),
      topK: z.number().int().min(1).max(12).default(6),
      minSemantic: unit.default(0.35),
      rrfK: z.number().int().min(1).max(200).default(60),
      maxExcerptTokens: z.number().int().min(200).max(6000).default(2500),
      flaggedPenalty: unit.default(0.5),
    }),
    turnAuditRate: unit.default(1.0),
    numberGuard: z.boolean().default(true),
  }),
  llm: z.object({
    tiers: z.record(Tier, z.object({ provider: Provider, model: z.string().min(1) })),
    routes: z.record(z.string(), LlmRoute),
    fallback: z.object({ enabled: z.boolean().default(true), force: z.boolean().default(false) }),
    cacheTtl: z.enum(["5m", "1h"]).default("5m"),
    retries: z.object({
      max: z.number().int().min(0).max(3).default(2),
      baseMs: z.number().int().min(100).max(3000).default(400),
    }),
    breaker: z.object({
      failures: z.number().int().min(1).max(20).default(3),
      windowSeconds: z.number().int().min(10).max(600).default(60),
      openSeconds: z.number().int().min(10).max(600).default(45),
    }),
    pricing: z.record(
      z.string(),
      z.object({
        inPerM: z.number(),
        outPerM: z.number(),
        cacheReadMult: z.number(),
        cacheWriteMult: z.number(),
      }),
    ),
  }),
  voice: z.object({
    input: z.object({
      enabled: z.boolean().default(true),
      defaultMode: z.enum(["push_to_talk", "hands_free"]).default("push_to_talk"),
    }),
    output: z.object({ enabled: z.boolean().default(true), autoplay: z.boolean().default(true) }),
    stt: z.object({
      provider: z.literal("soniox"),
      model: z.string().default("stt-rt-v5"),
      /** Used when the session's language has no entry in languageHintsByLang. */
      languageHints: z.array(z.string()).default(["ur", "en"]),
      /** Per practice language. strict restricts output to the hints (Soniox
       * language_hints_strict), which is robust only with a single language. */
      languageHintsByLang: z
        .record(z.string(), z.object({ hints: z.array(z.string()).min(1), strict: z.boolean() }))
        .default({ en: { hints: ["en"], strict: true } }),
      contextFromGlossary: z.boolean().default(true),
      keyTtlSeconds: z.number().int().min(10).max(3600).default(60),
      maxSessionSeconds: z.number().int().min(30).max(3600).default(600),
    }),
    tts: z.object({
      routes: z.record(
        Lang,
        z.object({ chain: z.array(z.enum(["uplift", "soniox", "browser"])).min(1) }),
      ),
      voices: z.record(z.string(), z.record(z.string(), z.string())),
      model: z.string().default("tts-rt-v2"),
      mixedStrategy: z.enum(["native", "transliterate", "split"]).default("transliterate"),
      format: z.string().default("MP3_22050_32"),
      ttfbTimeoutMs: z.number().int().min(300).max(5000).default(1500),
      dailySecondsCap: z.number().int().min(60).max(86_400).default(3600),
      maxChars: z.number().int().min(50).max(1000).default(400),
    }),
    speechMode: z.record(Lang, z.enum(["mirror", "normalize", "llm"])),
    bargeIn: z.boolean().default(true),
    fillerClips: z.boolean().default(false),
  }),
  limits: z.object({
    rate: z.object({
      perIpPerMinute: z.number().int().min(10).max(1000).default(120),
      turnsPerUserPerMinute: z.number().int().min(1).max(60).default(20),
      ingestsPerUserPerHour: z.number().int().min(1).max(100).default(10),
      voiceKeysPerUserPerMinute: z.number().int().min(1).max(60).default(8),
      ttsPerUserPerMinute: z.number().int().min(1).max(300).default(90),
      loginPerIpPerMinute: z.number().int().min(1).max(60).default(10),
    }),
    tokenBudgetPerSession: z.number().int().min(10_000).max(2_000_000).default(250_000),
    dailySpendCapUsd: z.number().min(0.5).max(500).default(5),
    degradeAtPercent: z.number().int().min(50).max(100).default(80),
    maxConcurrentIngests: z.number().int().min(1).max(10).default(2),
  }),
  gamification: z.object({
    enabled: z.boolean().default(true),
    xp: z.record(z.string(), z.number().int().min(0).max(1000)),
    levels: z.array(z.number().int().min(0)).min(2),
    streaks: z.object({
      enabled: z.boolean().default(true),
      timezone: z.string().default("Asia/Karachi"),
      freezesPerWeek: z.number().int().min(0).max(3).default(1),
    }),
    leaderboard: z.object({
      enabled: z.boolean().default(false),
      optIn: z.literal(true),
      pseudonymous: z.literal(true),
    }),
    timers: z.object({ enabled: z.boolean().default(false) }),
    celebrations: z.boolean().default(true),
  }),
  privacy: z.object({
    retentionDays: z.object({
      turns: z.number().int().min(1).max(365).default(30),
      evidence: z.number().int().min(7).max(730).default(180),
      llmCalls: z.number().int().min(7).max(365).default(90),
      feedback: z.number().int().min(7).max(730).default(180),
    }),
    showLearnerNames: z.boolean().default(false),
    redaction: z.object({
      cnic: z.boolean(),
      phone: z.boolean(),
      iban: z.boolean(),
      card: z.boolean(),
      email: z.boolean(),
    }),
    allowSelfDeletion: z.boolean().default(true),
  }),
  analytics: z.object({
    includeSeeded: z.boolean().default(true),
    defaultRangeDays: z.number().int().min(1).max(365).default(14),
  }),
  observability: z.object({
    traceContent: z.enum(["masked", "off"]).default("masked"),
    turnTimingsToClient: z.boolean().default(true),
  }),
  ui: z.object({
    showModelIdentifiers: z.boolean().default(false),
    inspectorDefaultOpen: z.boolean().default(false),
    lowBandwidth: z.boolean().default(false),
    reducedMotion: z.enum(["system", "on"]).default("system"),
    textScale: z.number().min(0.875).max(1.5).default(1),
    highContrast: z.boolean().default(false),
  }),
  features: z.object({
    teachBackMode: z.boolean().default(false),
    confidenceCalibration: z.boolean().default(false),
    contentHealthSuggestions: z.boolean().default(false),
    crossSessionCallbacks: z.boolean().default(false),
    xapiExport: z.boolean().default(false),
    managerNudges: z.boolean().default(false),
  }),
  presets: z.record(
    z.string(),
    z.object({ label: z.string(), labelUr: z.string(), patch: z.unknown() }),
  ),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export const CONFIG_SCHEMA_VERSION = 1;

/** Deep partial of the config: what overrides, presets and learner choices carry. */
export type ConfigPatch = DeepPartial<Config>;
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
