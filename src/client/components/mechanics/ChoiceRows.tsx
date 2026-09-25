"use client";

import React from "react";
import { BidiText } from "../BidiText";
import { pickLabel, type UiLang, type UiOption } from "./types";

export interface ChoiceRowsProps {
  questionId: string;
  options: UiOption[];
  lang: UiLang;
  disabled?: boolean;
  /** The option picked on the last attempt, shown as pressed until the tutor replies. */
  selectedId?: string | null;
  onSelect: (optionId: string) => void;
}

/** Choice rows: one full-width button per option, letters A to D as the visual handle. */
export function ChoiceRows({
  questionId,
  options,
  lang,
  disabled = false,
  selectedId = null,
  onSelect,
}: ChoiceRowsProps): React.JSX.Element {
  const rtl = lang === "ur";
  return (
    <div
      role="group"
      aria-label="Answer options"
      data-testid="mechanic-choice"
      data-question={questionId}
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col gap-2"
    >
      {options.map((opt, i) => {
        const pressed = selectedId === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            data-testid={`choice-${opt.id}`}
            onClick={() => onSelect(opt.id)}
            className={`focus-visible:ring-neem flex min-h-11 w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-start text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
              pressed
                ? "border-neem bg-neem/10 text-ink"
                : "border-mist text-ink hover:border-neem/60 bg-white"
            }`}
          >
            <span
              aria-hidden="true"
              className="border-mist text-ink/70 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
            >
              {String.fromCharCode(65 + i)}
            </span>
            <BidiText text={pickLabel(opt.label, lang)} lang={rtl ? "ur" : "en"} as="span" />
          </button>
        );
      })}
    </div>
  );
}
