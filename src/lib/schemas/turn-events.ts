import { z } from "zod";

export const GradeLine = z.object({
  verdict: z.enum(["correct", "partial", "incorrect", "not_an_answer"]),
  question: z.string(),
  concept: z.string(),
  misconception: z.string().nullable(),
  score: z.number().min(0).max(1),
  self_correction: z.boolean(),
  help_request: z.boolean(),
  out_of_source: z.boolean(),
  lang: z.enum(["en", "ur", "ur-Latn", "mixed"]),
  confidence_cue: z.enum(["none", "low", "medium", "high"]),
});

export type GradeLine = z.infer<typeof GradeLine>;

const L10nLabel = z.object({ en: z.string(), ur: z.string(), urLatn: z.string() });
const UiOption = z.object({ id: z.string(), label: L10nLabel });

/** What the screen shows for the current question (engine/policy.ts uiPayload): never the answer key. */
export const UiPayloadSchema = z.object({
  kind: z.enum([
    "choice",
    "sequence",
    "match",
    "spot_error",
    "free_text",
    "explanation",
    "teach_back",
    "roleplay_turn",
  ]),
  questionId: z.string(),
  prompt: z.string(),
  options: z.array(UiOption).nullable().optional(),
  steps: z.array(UiOption).optional(),
  lefts: z.array(L10nLabel).optional(),
  rights: z.array(L10nLabel).optional(),
  sentences: z.array(z.object({ id: z.string(), text: L10nLabel })).optional(),
});
export type UiPayload = z.infer<typeof UiPayloadSchema>;
export type L10nLabel = z.infer<typeof L10nLabel>;
export type UiOption = z.infer<typeof UiOption>;

export const TurnEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn.start"),
    turnId: z.string(),
    moveTypes: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("verdict"), data: z.unknown() }),
  z.object({ type: z.literal("move"), id: z.string() }),
  z.object({ type: z.literal("display.delta"), text: z.string() }),
  z.object({
    type: z.literal("display.sentence"),
    index: z.number(),
    text: z.string(),
    /**
     * Figures in this sentence that are not in any allowed fact or excerpt. In strict mode the
     * sentence is replaced and this is empty; in assisted mode the sentence is shown as
     * written, and it has to be marked unverified rather than passed
     * off as sourced.
     */
    unverified: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("speech.item"),
    index: z.number(),
    text: z.string(),
    lang: z.string().optional(),
    profile: z.string().optional(),
    sig: z.string().optional(),
    exp: z.number().optional(),
  }),
  z.object({ type: z.literal("facts"), ids: z.array(z.string()) }),
  /**
   * The session moved on to the next mission. A finished mission is not a finished journey,
   * and without this the client had no way to know the station changed under it.
   */
  z.object({
    type: z.literal("mission.changed"),
    missionId: z.string(),
    ordinal: z.number(),
    journeyComplete: z.boolean(),
  }),
  z.object({ type: z.literal("ui"), payload: z.unknown().optional() }),
  z.object({ type: z.literal("inspector"), delta: z.unknown().optional() }),
  z.object({
    type: z.literal("retract"),
    turnId: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn.end"),
    turnId: z.string().optional(),
    timings: z.record(z.string(), z.number()).optional(),
  }),
  z.object({ type: z.literal("evidence"), data: z.unknown() }),
  z.object({ type: z.literal("gamification"), data: z.unknown().optional() }),
  z.object({ type: z.literal("end") }),
  z.object({ type: z.literal("error"), code: z.string().optional(), message: z.string() }),
  z.object({ type: z.literal("warning"), message: z.string() }),
]);

export type TurnEvent = z.infer<typeof TurnEventSchema>;
