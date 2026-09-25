// The `ui` payload a turn emits for the current question (server/engine/policy.ts uiPayload).
// Labels arrive in three scripts; components pick the session language and fall back to English.
import type { L10nLabel } from "@/lib/schemas/turn-events";

export type { L10nLabel, UiOption, UiPayload } from "@/lib/schemas/turn-events";

export type UiLang = "en" | "ur" | "ur-Latn" | "mixed";

export function pickLabel(label: L10nLabel | string, lang: UiLang): string {
  if (typeof label === "string") return label;
  if (lang === "ur") return label.ur || label.en;
  if (lang === "ur-Latn") return label.urLatn || label.en;
  return label.en || label.urLatn || label.ur;
}

/** What a mechanic hands back: the input mode and the answer shape keyVerdict expects. */
export type MechanicAnswer =
  | { mode: "tap"; answer: string }
  | { mode: "drag"; answer: string[] }
  | { mode: "tap"; answer: Record<string, string> };
