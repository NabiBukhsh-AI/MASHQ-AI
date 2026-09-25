import React from "react";
import { BidiText } from "../BidiText";
import type { UiLang } from "./types";

export interface TeachBackPromptProps {
  questionId: string;
  kind: "teach_back" | "explanation" | "free_text" | "roleplay_turn";
  prompt: string;
  lang: UiLang;
}

const FRAMING: Record<TeachBackPromptProps["kind"], { eyebrow: string; help: string }> = {
  teach_back: {
    eyebrow: "Teach it back",
    help: "Explain it in your own words, as if to a new colleague. Any language is fine.",
  },
  explanation: { eyebrow: "Explain", help: "Say why, not just what. Type or speak your answer." },
  free_text: { eyebrow: "Your answer", help: "Type or speak your answer below." },
  roleplay_turn: {
    eyebrow: "Role play",
    help: "Reply as you would to the customer at the counter.",
  },
};

/** Framing card for open answers; the reply itself goes through the composer. */
export function TeachBackPrompt({
  questionId,
  kind,
  prompt,
  lang,
}: TeachBackPromptProps): React.JSX.Element {
  const f = FRAMING[kind];
  const rtl = lang === "ur";
  return (
    <div
      data-testid="mechanic-open"
      data-question={questionId}
      data-kind={kind}
      dir={rtl ? "rtl" : "ltr"}
      className="border-haldi/60 bg-haldi/10 rounded-lg border-s-4 px-4 py-3 text-sm"
    >
      <p className="text-ink/70 text-xs font-semibold">{f.eyebrow}</p>
      <BidiText text={prompt} lang={rtl ? "ur" : "en"} as="p" className="text-ink mt-1" />
      <p className="text-ink/70 mt-1 text-xs">{f.help}</p>
    </div>
  );
}
