"use client";

import React from "react";
import { ChoiceRows } from "./ChoiceRows";
import { MatchPairs } from "./MatchPairs";
import { SequenceList } from "./SequenceList";
import { SpotTheError } from "./SpotTheError";
import { TeachBackPrompt } from "./TeachBackPrompt";
import type { MechanicAnswer, UiLang, UiPayload } from "./types";

export type { MechanicAnswer, UiLang, UiPayload } from "./types";
export { ChoiceRows, MatchPairs, SequenceList, SpotTheError, TeachBackPrompt };

export interface MechanicProps {
  ui: UiPayload;
  lang: UiLang;
  disabled?: boolean;
  /** The learner's last keyed answer for this question, kept pressed until the tutor replies. */
  lastAnswer?: unknown;
  onAnswer: (answer: MechanicAnswer) => void;
}

/** Renders the mechanic for a `ui` payload. Open kinds show a framing card; the composer sends the text. */
export function Mechanic({
  ui,
  lang,
  disabled,
  lastAnswer,
  onAnswer,
}: MechanicProps): React.JSX.Element | null {
  const picked = typeof lastAnswer === "string" ? lastAnswer : null;
  switch (ui.kind) {
    case "choice":
      if (!ui.options?.length) return null;
      return (
        <ChoiceRows
          questionId={ui.questionId}
          options={ui.options}
          lang={lang}
          disabled={disabled}
          selectedId={picked}
          onSelect={(id) => onAnswer({ mode: "tap", answer: id })}
        />
      );
    case "sequence":
      if (!ui.steps?.length) return null;
      return (
        <SequenceList
          key={ui.questionId}
          questionId={ui.questionId}
          steps={ui.steps}
          lang={lang}
          disabled={disabled}
          onSubmit={(order) => onAnswer({ mode: "drag", answer: order })}
        />
      );
    case "match":
      if (!ui.lefts?.length || !ui.rights?.length) return null;
      return (
        <MatchPairs
          key={ui.questionId}
          questionId={ui.questionId}
          lefts={ui.lefts}
          rights={ui.rights}
          lang={lang}
          disabled={disabled}
          onSubmit={(m) => onAnswer({ mode: "tap", answer: m })}
        />
      );
    case "spot_error":
      if (!ui.sentences?.length) return null;
      return (
        <SpotTheError
          questionId={ui.questionId}
          sentences={ui.sentences}
          lang={lang}
          disabled={disabled}
          selectedId={picked}
          onSelect={(id) => onAnswer({ mode: "tap", answer: id })}
        />
      );
    case "free_text":
    case "explanation":
    case "teach_back":
    case "roleplay_turn":
      return (
        <TeachBackPrompt questionId={ui.questionId} kind={ui.kind} prompt={ui.prompt} lang={lang} />
      );
    default:
      return null;
  }
}
