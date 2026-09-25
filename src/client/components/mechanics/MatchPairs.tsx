"use client";

import React, { useState } from "react";
import { BidiText } from "../BidiText";
import { pickLabel, type L10nLabel, type UiLang } from "./types";

export interface MatchPairsProps {
  questionId: string;
  lefts: L10nLabel[];
  /** Already reshuffled by the server; the payload carries no pairing. */
  rights: L10nLabel[];
  lang: UiLang;
  disabled?: boolean;
  /** Keys are the English left label, values the English right label (what keyVerdict compares). */
  onSubmit: (matches: Record<string, string>) => void;
}

/** Match pairs: each left item gets a native select of the right-hand items. Keyboard-native. */
export function MatchPairs({
  questionId,
  lefts,
  rights,
  lang,
  disabled = false,
  onSubmit,
}: MatchPairsProps): React.JSX.Element {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const rtl = lang === "ur";
  const complete = lefts.every((l) => picked[l.en]);

  return (
    <div
      data-testid="mechanic-match"
      data-question={questionId}
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col gap-2"
    >
      {lefts.map((left, i) => {
        const selectId = `${questionId}-match-${i}`;
        return (
          <div
            key={left.en}
            className="border-mist flex flex-col gap-1 rounded-lg border bg-white px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
          >
            <label htmlFor={selectId} className="text-ink flex-1">
              <BidiText text={pickLabel(left, lang)} lang={rtl ? "ur" : "en"} as="span" />
            </label>
            <select
              id={selectId}
              disabled={disabled}
              value={picked[left.en] ?? ""}
              onChange={(e) => setPicked({ ...picked, [left.en]: e.target.value })}
              className="border-mist bg-paper text-ink focus:border-neem min-h-9 rounded-md border px-2 text-sm focus:outline-none sm:w-64"
            >
              <option value="">Choose a match</option>
              {rights.map((r) => (
                <option key={r.en} value={r.en}>
                  {pickLabel(r, lang)}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <button
        type="button"
        disabled={disabled || !complete}
        data-testid="match-submit"
        onClick={() => onSubmit(picked)}
        className="bg-neem hover:bg-neem/90 focus-visible:ring-neem/50 self-start rounded-lg px-4 py-2 text-xs font-semibold text-white focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        Check my matches
      </button>
    </div>
  );
}
