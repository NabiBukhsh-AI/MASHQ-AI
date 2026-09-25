import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tz, updatedAt } from "./common";
import { organizations, user } from "./identity";
import { concepts, journeys, missions } from "./journey";

export const INPUT_MODES = ["voice", "text", "tap", "drag", "idle"] as const;
export const EVIDENCE_SOURCES = ["key", "inline", "grader", "extractor", "seed"] as const;
export const ADAPTATION_SOURCES = ["policy", "panel_control", "admin_config"] as const;

export const learningSessions = pgTable(
  "learning_sessions",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journeys.id),
    currentMissionId: uuid("current_mission_id").references(() => missions.id),
    personaId: text("persona_id").notNull(),
    language: text("language").notNull(),
    register: text("register"),
    modality: text("modality").notNull().default("text"),
    presets: text("presets").array().notNull().default([]),
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
    configVersion: integer("config_version").notNull(),
    configHash: text("config_hash").notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    /** Panel controls waiting for the next turn to acknowledge (R03). Appended server side,
     * so a control and a streaming turn never overwrite each other's state. */
    pendingSwitch: jsonb("pending_switch")
      .$type<{ id: string; kind: string; to: string; reason: string }[]>()
      .notNull()
      .default([]),
    tokensUsed: integer("tokens_used").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
    startedAt: tz("started_at").defaultNow().notNull(),
    lastActiveAt: tz("last_active_at").defaultNow().notNull(),
    endedAt: tz("ended_at"),
    status: text("status", { enum: ["active", "ended", "abandoned"] })
      .notNull()
      .default("active"),
    isSeeded: boolean("is_seeded").notNull().default(false),
  },
  (t) => [
    index("learning_sessions_org_user_started_idx").on(t.orgId, t.userId, t.startedAt.desc()),
    index("learning_sessions_journey_idx").on(t.journeyId),
  ],
);

export const turns = pgTable(
  "turns",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    ordinal: integer("ordinal").notNull(),
    role: text("role", { enum: ["learner", "tutor", "system"] }).notNull(),
    inputMode: text("input_mode", { enum: INPUT_MODES }),
    text: text("text"),
    lang: text("lang"),
    missionId: uuid("mission_id").references(() => missions.id),
    moveType: text("move_type"),
    heardUntilSentence: smallint("heard_until_sentence"),
    timings: jsonb("timings").$type<Record<string, number>>(),
    protocolOk: boolean("protocol_ok"),
    providerTier: text("provider_tier"),
    createdAt: createdAt(),
  },
  (t) => [
    index("turns_session_ordinal_idx").on(t.sessionId, t.ordinal),
    index("turns_created_idx").on(t.createdAt),
    check("turns_text_len_chk", sql`length(${t.text}) <= 2000`),
  ],
);

export const evidenceEvents = pgTable(
  "evidence_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => learningSessions.id, { onDelete: "set null" }),
    turnId: uuid("turn_id").references(() => turns.id, { onDelete: "set null" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id),
    questionId: text("question_id"),
    signal: text("signal").notNull(),
    verdict: text("verdict").notNull(),
    score: real("score").notNull(),
    hintLevel: smallint("hint_level").notNull().default(0),
    latencyMs: integer("latency_ms"),
    selfCorrected: boolean("self_corrected").notNull().default(false),
    confidence: text("confidence"),
    lang: text("lang"),
    modality: text("modality"),
    misconceptionId: text("misconception_id"),
    weight: real("weight").notNull(),
    credit: real("credit").notNull(),
    /** Guess probability used for this event, so a mastery replay reproduces it exactly. */
    guess: real("guess"),
    pBefore: real("p_before").notNull(),
    pAfter: real("p_after").notNull(),
    source: text("source", { enum: EVIDENCE_SOURCES }).notNull(),
    supersededBy: uuid("superseded_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("evidence_events_user_concept_created_idx").on(t.userId, t.conceptId, t.createdAt),
    index("evidence_events_session_created_idx").on(t.sessionId, t.createdAt),
    index("evidence_events_org_created_idx").on(t.orgId, t.createdAt),
    index("evidence_events_concept_verdict_idx").on(t.conceptId, t.verdict),
    check("evidence_events_score_chk", sql`${t.score} between 0 and 1`),
    check("evidence_events_credit_chk", sql`${t.credit} between 0 and 1`),
    check(
      "evidence_events_p_chk",
      sql`${t.pBefore} between 0 and 1 and ${t.pAfter} between 0 and 1`,
    ),
  ],
);

export const masteryStates = pgTable(
  "mastery_states",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    p: real("p").notNull(),
    nEvents: integer("n_events").notNull().default(0),
    nEff: real("n_eff").notNull().default(0),
    signalTypes: text("signal_types").array().notNull().default([]),
    band: text("band").notNull(),
    lower: real("lower").notNull(),
    upper: real("upper").notNull(),
    lastEvidenceAt: tz("last_evidence_at"),
    nextCallbackAt: tz("next_callback_at"),
    configVersion: integer("config_version").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.conceptId] }),
    index("mastery_states_org_concept_idx").on(t.orgId, t.conceptId),
    check("mastery_states_p_chk", sql`${t.p} between 0 and 1`),
    check(
      "mastery_states_bounds_chk",
      sql`${t.lower} between 0 and 1 and ${t.upper} between 0 and 1`,
    ),
  ],
);

export const learnerProfiles = pgTable("learner_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  personaId: text("persona_id"),
  level: smallint("level"),
  language: text("language"),
  script: text("script"),
  modality: text("modality"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  calibration: jsonb("calibration").$type<Record<string, unknown>>().notNull().default({}),
  leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(false),
  updatedAt: updatedAt(),
});

export const adaptationEvents = pgTable(
  "adaptation_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").references(() => turns.id, { onDelete: "set null" }),
    ruleId: text("rule_id").notNull(),
    moveType: text("move_type").notNull(),
    modifiers: text("modifiers").array().notNull().default([]),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    reason: text("reason").notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    configVersion: integer("config_version").notNull(),
    source: text("source", { enum: ADAPTATION_SOURCES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("adaptation_events_session_created_idx").on(t.sessionId, t.createdAt),
    index("adaptation_events_org_rule_created_idx").on(t.orgId, t.ruleId, t.createdAt),
  ],
);
