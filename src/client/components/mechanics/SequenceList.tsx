"use client";

import React, { useState } from "react";
import { BidiText } from "../BidiText";
import { pickLabel, type UiLang, type UiOption } from "./types";

const BTN =
  "border-mist text-ink hover:border-neem/60 focus-visible:ring-neem h-7 min-w-7 rounded border px-1.5 text-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40";

export interface SequenceListProps {
  questionId: string;
  steps: UiOption[];
  lang: UiLang;
  disabled?: boolean;
  onSubmit: (orderedIds: string[]) => void;
}

/**
 * Reorderable step list. Buttons only (move up, move down): works with mouse,
 * touch, keyboard and screen readers without a drag library.
 */
export function SequenceList({
  questionId,
  steps,
  lang,
  disabled = false,
  onSubmit,
}: SequenceListProps): React.JSX.Element {
  const [order, setOrder] = useState<string[]>(() => steps.map((s) => s.id));
  const [announce, setAnnounce] = useState("");
  const byId = new Map(steps.map((s) => [s.id, s]));
  const rtl = lang === "ur";

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setOrder(next);
    const label = pickLabel(byId.get(item!)!.label, lang);
    setAnnounce(`${label} moved to position ${to + 1} of ${next.length}.`);
  };

  return (
    <div
      data-testid="mechanic-sequence"
      data-question={questionId}
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col gap-2"
    >
      <ol aria-label="Steps in your order" className="flex flex-col gap-1.5">
        {order.map((id, i) => {
          const label = pickLabel(byId.get(id)!.label, lang);
          return (
            <li
              key={id}
              data-testid={`step-${id}`}
              className="border-mist flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <span className="text-ink/70 w-5 shrink-0 text-xs font-semibold tabular-nums">
                {i + 1}
              </span>
              <BidiText text={label} lang={rtl ? "ur" : "en"} as="span" className="flex-1" />
              <span className="flex shrink-0 gap-1">
                {/* aria-disabled, not disabled: a button that disables itself after a move drops keyboard focus. */}
                <button
                  type="button"
                  disabled={disabled}
                  aria-disabled={disabled || i === 0}
                  aria-label={`Move "${label}" up`}
                  onClick={() => move(i, i - 1)}
                  className={`${BTN} ${i === 0 ? "opacity-40" : ""}`}
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-disabled={disabled || i === order.length - 1}
                  aria-label={`Move "${label}" down`}
                  onClick={() => move(i, i + 1)}
                  className={`${BTN} ${i === order.length - 1 ? "opacity-40" : ""}`}
                >
                  &darr;
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <button
        type="button"
        disabled={disabled}
        data-testid="sequence-submit"
        onClick={() => onSubmit(order)}
        className="bg-neem hover:bg-neem/90 focus-visible:ring-neem/50 self-start rounded-lg px-4 py-2 text-xs font-semibold text-white focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        Check my order
      </button>
    </div>
  );
}
