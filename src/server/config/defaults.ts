import { ConfigSchema, type Config, type ConfigInput, type Persona } from "./schema";

// Code defaults: the bottom of the resolution order. Values
// with a schema default are omitted here and filled by Zod, so this file only
// states what the schema cannot default. Model ids live here and nowhere else.

const mechanicWeights = (w: Partial<Record<string, number>>) => ({
  scenario: 0.9,
  roleplay: 0.8,
  puzzle: 0.7,
  decision: 0.8,
  teach_back: 0.7,
  final_challenge: 1,
  ...w,
});

export const PERSONAS: Persona[] = [
  {
    id: "branch_new_joiner",
    label: "Branch new joiner",
    labelUr: "برانچ کا نیا ساتھی",
    level: "novice",
    pInit: 0.15,
    startDifficulty: 1,
    pace: "slow",
    turnLength: "short",
    register: "colleague",
    exampleDomain: "branch_counter",
    mechanicWeights: mechanicWeights({ scenario: 1, roleplay: 0.9, teach_back: 0.5 }),
    latencyBaselineMs: 14000,
  },
  {
    id: "branch_officer",
    label: "Branch officer",
    labelUr: "برانچ افسر",
    level: "intermediate",
    pInit: 0.25,
    startDifficulty: 3,
    pace: "normal",
    turnLength: "normal",
    register: "colleague",
    exampleDomain: "branch_counter",
    mechanicWeights: mechanicWeights({}),
    latencyBaselineMs: 10000,
  },
  {
    id: "back_office_specialist",
    label: "Back office specialist",
    labelUr: "بیک آفس ماہر",
    level: "intermediate",
    pInit: 0.25,
    startDifficulty: 3,
    pace: "normal",
    turnLength: "normal",
    register: "colleague",
    exampleDomain: "back_office",
    mechanicWeights: mechanicWeights({ puzzle: 0.9, decision: 0.9 }),
    latencyBaselineMs: 10000,
  },
  {
    id: "senior_manager",
    label: "Senior manager",
    labelUr: "سینئر منیجر",
    level: "expert",
    pInit: 0.35,
    startDifficulty: 4,
    pace: "fast",
    turnLength: "short",
    register: "formal",
    exampleDomain: "management",
    mechanicWeights: mechanicWeights({
      decision: 1,
      teach_back: 0.9,
      scenario: 0.7,
      roleplay: 0.5,
    }),
    latencyBaselineMs: 8000,
  },
];

const ROUTE = (tier: "fast" | "design" | "embed", maxOutputTokens: number, temperature = 0.4) => ({
  tier,
  maxOutputTokens,
  temperature,
  timeoutMs: tier === "design" ? 120_000 : 30_000,
  firstTokenTimeoutMs: tier === "design" ? 20_000 : 6_000,
});

export const DEFAULT_CONFIG_INPUT: ConfigInput = {
  schemaVersion: 1,
  branding: {},
  learner: {},
  personas: PERSONAS,
  content: {
    browserExtract: {},
    allowedTypes: ["pdf", "docx", "pptx", "txt", "md", "paste", "url", "image"],
    url: {},
    scanned: {},
    chunk: {},
    design: {},
  },
  language: {},
  session: {},
  difficulty: { levels: 5 },
  mechanics: {
    enabled: {
      scenario: true,
      roleplay: true,
      puzzle: true,
      decision: true,
      teach_back: true,
      final_challenge: true,
    },
    weights: mechanicWeights({}),
  },
  mastery: { bands: {}, forgetting: {} },
  evidence: {
    weights: {
      choice: 0.4,
      puzzle: 0.5,
      decision: 0.6,
      free_text: 0.7,
      explanation: 0.85,
      application: 0.9,
      teach_back: 1,
      retention: 0.9,
    },
    guess: {
      puzzle: 0.15,
      decision: 0.2,
      free_text: 0.05,
      explanation: 0.05,
      application: 0.05,
      teach_back: 0.02,
      retention: 0.1,
      choiceMin: 0.25,
    },
    retentionBoost: {},
  },
  hints: { maxLevel: 3 },
  engagement: {
    idkPatterns: [
      "i don't know",
      "idk",
      "pata nahi",
      "pata nhi",
      "nahi pata",
      "پتہ نہیں",
      "پتا نہیں",
      "معلوم نہیں",
      "no idea",
    ],
    frustrationPhrases: [
      "this is confusing",
      "samajh nahi aa raha",
      "samajh nahi aaya",
      "سمجھ نہیں آ رہا",
      "bohat mushkil",
      "i give up",
      "whatever",
    ],
  },
  policy: {
    rulesEnabled: Object.fromEntries(
      [
        "R01",
        "R02",
        "R03",
        "R04",
        "R05",
        "R06",
        "R07",
        "R08",
        "R09",
        "R10",
        "R11",
        "R12",
        "R13",
        "R14",
        "R15",
      ].map((r) => [r, true]),
    ),
  },
  engine: {},
  grounding: { retrieval: {} },
  llm: {
    // Verified 18 Sep 2026 against the official model pages. Fallback: newest GA
    // Gemini Flash. scripts/llm-smoke.ts checks the ids resolve before the first deploy.
    tiers: {
      fast: { provider: "anthropic", model: "claude-haiku-4-5" },
      design: { provider: "anthropic", model: "claude-sonnet-5" },
      fallback: { provider: "google", model: "gemini-3.8-flash" },
      embed: { provider: "google", model: "gemini-embedding-001" },
    },
    routes: {
      "turn.respond": ROUTE("fast", 450, 0.5),
      "turn.grade": ROUTE("fast", 120, 0),
      "turn.extract_evidence": ROUTE("fast", 300, 0),
      "turn.audit": ROUTE("fast", 200, 0),
      "content.outline": ROUTE("design", 8000, 0.3),
      "content.facts_chapter": ROUTE("design", 6000, 0.2),
      "content.glossary": ROUTE("fast", 4000, 0.2),
      "content.section_digest": ROUTE("fast", 600, 0.2),
      "content.inject_classify": ROUTE("fast", 60, 0),
      "mission.generate": ROUTE("design", 10000, 0.5),
      // One JSON object per claim (id, verdict, note, and a corrected statement for a partial
      // verdict), and a whole mission's facts are judged in one call. At 200 the reply was
      // truncated mid string, the repair pass could not parse it either, and the pipeline
      // failed with "designing the journey failed" after the outline stage. A cap only costs
      // what is actually generated, so it is sized for the worst case rather than the mean.
      "grounding.check": ROUTE("fast", 4000, 0),
      "query.rewrite": ROUTE("fast", 120, 0),
      "scanned.transcribe": ROUTE("design", 4000, 0),
      "embed.text": ROUTE("embed", 16, 0),
    },
    fallback: {},
    retries: {},
    breaker: {},
    // USD per million tokens, official pricing pages on 18 Sep 2026. Gemini 3.8 Flash
    // rises to 1.5 / 7.5 on 1 Jan 2027.
    pricing: {
      "claude-haiku-4-5": { inPerM: 1, outPerM: 5, cacheReadMult: 0.1, cacheWriteMult: 1.25 },
      "claude-sonnet-5": { inPerM: 2, outPerM: 10, cacheReadMult: 0.1, cacheWriteMult: 1.25 },
      "gemini-3.8-flash": { inPerM: 0.75, outPerM: 3.75, cacheReadMult: 0.1, cacheWriteMult: 1 },
      "gemini-embedding-001": { inPerM: 0.2, outPerM: 0, cacheReadMult: 1, cacheWriteMult: 1 },
    },
  },
  voice: {
    input: {},
    output: {},
    stt: { provider: "soniox" },
    tts: {
      // Uplift first in every language, so the tutor keeps one voice (v_meklc281, Nabi's
      // choice). English used to try Soniox first, whose voice is the placeholder "default"
      // and always fails, which ate into the time Uplift had before the browser voice took over.
      routes: {
        en: { chain: ["uplift", "soniox", "browser"] },
        ur: { chain: ["uplift", "soniox", "browser"] },
        "ur-Latn": { chain: ["uplift", "soniox", "browser"] },
        mixed: { chain: ["uplift", "soniox", "browser"] },
      },
      model: "tts-rt-v2",
      // Uplift's first byte runs 1.0 to 1.5 s, so the old 1.5 s cutoff dropped some lines to the
      // browser voice (male on Windows) mid-session. A slightly later start beats a voice swap.
      ttfbTimeoutMs: 3000,
      // provider -> profile -> voice id.
      voices: {
        uplift: {
          guide: "v_meklc281",
          elder_customer: "v_yypgzenx",
          young_customer: "v_kwmp7zxt",
          new_joiner: "v_30s70t3a",
        },
        soniox: { guide: "default" },
      },
    },
    // Mirror would skip glossary hints, symbol and number expansion, which
    // is the whole substance of the speech channel.
    speechMode: { en: "normalize", ur: "normalize", "ur-Latn": "llm", mixed: "normalize" },
  },
  limits: { rate: {} },
  gamification: {
    // Every reason code the engine awards has to exist here, or awardXp
    // silently falls back to the code defaults and the org cannot tune it.
    xp: {
      correct_first_try: 10,
      correct_after_hint: 5,
      correct_with_hint: 5,
      partial: 3,
      self_correction: 6,
      teach_back: 25,
      teach_back_strong: 25,
      callback_correct: 15,
      retention_hit: 15,
      mission_complete: 50,
      chapter_complete: 100,
      first_session_of_day: 20,
    },
    levels: [0, 100, 250, 500, 900, 1400, 2000],
    streaks: {},
    leaderboard: { optIn: true, pseudonymous: true },
    timers: {},
  },
  privacy: {
    retentionDays: {},
    redaction: { cnic: true, phone: true, iban: true, card: true, email: true },
  },
  analytics: {},
  observability: {},
  ui: {},
  features: {},
  presets: {},
};

/** The fully defaulted, validated code defaults. Presets are attached in presets.ts. */
export const DEFAULT_CONFIG: Config = ConfigSchema.parse(DEFAULT_CONFIG_INPUT);
