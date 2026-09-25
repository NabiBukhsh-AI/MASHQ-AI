"use client";

import React from "react";
import { BidiText } from "../BidiText";
import { pickLabel, type L10nLabel, type UiLang } from "./types";

export interface SpotTheErrorProps {
  questionId: string;
  sentences: { id: string; text: L10nLabel }[];
  lang: UiLang;
  disabled?: boolean;
  selectedId?: string | null;
  onSelect: (sentenceId: string) => void;
}

/** A short passage where each sentence is a button; the learner picks the one with the error. */
export function SpotTheError({
  questionId,
  sentences,
  lang,
  disabled = false,
  selectedId = null,
  onSelect,
}: SpotTheErrorProps): React.JSX.Element {
  const rtl = lang === "ur";
  return (
    <div
      role="group"
      aria-label="Passage: pick the sentence with the error"
      data-testid="mechanic-spot-error"
      data-question={questionId}
      dir={rtl ? "rtl" : "ltr"}
      className="border-mist rounded-lg border bg-white p-3 text-sm leading-7"
    >
      {sentences.map((s) => {
        const pressed = selectedId === s.id;
        return (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            data-testid={`sentence-${s.id}`}
            onClick={() => onSelect(s.id)}
            className={`focus-visible:ring-neem me-1 inline rounded px-1 text-start focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed ${
              pressed ? "bg-haldi/30 text-ink" : "hover:bg-haldi/15 text-ink"
            }`}
          >
            <BidiText text={pickLabel(s.text, lang)} lang={rtl ? "ur" : "en"} as="span" />
          </button>
        );
      })}
    </div>
  );
}
