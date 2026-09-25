// Move catalog: a closed set. UI payloads are attached by code from the
// mission pack according to the move; the model only renders the move in words.

export const MOVE_TYPES = [
  "continue_beat",
  "present_question",
  "feedback_correct",
  "feedback_partial",
  "feedback_incorrect",
  "graded_hint",
  "worked_example",
  "simplify",
  "deepen",
  "switch_mechanic",
  "change_pace",
  "offer_break",
  "switch_language",
  "restyle",
  "retention_callback",
  "celebrate_unlock",
  "answer_question",
  "out_of_source",
  "teach_back_prompt",
  "clarify_and_encourage",
  "encourage_and_simplify",
  "summarize_and_bookmark",
  "wrap_up",
] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export type ModifierKind = "celebrate" | "pace" | "language" | "scheduleCallback";
export interface Modifier {
  kind: ModifierKind;
  value?: string | number | boolean;
}

export interface Move {
  id: string;
  type: MoveType;
  ruleId: string;
  reason: string;
  params: Record<string, unknown>;
  /** At most two. */
  modifiers?: Modifier[];
}

export const RULE_IDS = [
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
  "R99",
] as const;
export type RuleId = (typeof RULE_IDS)[number];
