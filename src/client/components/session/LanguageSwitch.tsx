"use client";

import React from "react";
import type { AppLanguage } from "@/lib/i18n/strings";

export interface LanguageSwitchProps {
  value: AppLanguage | string;
  onChange: (language: AppLanguage) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The four language modes: English, Urdu, Roman Urdu and mixed. Each option carries its own lang and dir so a
 * screen reader pronounces "اردو" in Urdu rather than spelling it out in English, which is what
 * happens when the whole control inherits the page language.
 */
export const LANGUAGE_OPTIONS: Array<{
  id: AppLanguage;
  label: string;
  /** What the option is called in English, for the accessible name. */
  description: string;
  lang: string;
  dir: "ltr" | "rtl";
}> = [
  { id: "en", label: "EN", description: "English", lang: "en", dir: "ltr" },
  { id: "ur", label: "اردو", description: "Urdu", lang: "ur", dir: "rtl" },
  { id: "ur-Latn", label: "Roman", description: "Roman Urdu", lang: "ur-Latn", dir: "ltr" },
  { id: "mixed", label: "Mixed", description: "Urdu with English terms", lang: "ur", dir: "rtl" },
];

export function LanguageSwitch({
  value,
  onChange,
  disabled = false,
  className = "",
}: LanguageSwitchProps): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Language selection"
      data-testid="language-switch"
      className={`border-mist flex items-center gap-0.5 rounded-lg border p-0.5 ${className}`}
    >
      {LANGUAGE_OPTIONS.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.description}
            disabled={disabled}
            data-testid={`lang-btn-${opt.id}`}
            onClick={() => onChange(opt.id)}
            // Nastaliq needs the room; the label is a script sample, not just a code.
            style={opt.dir === "rtl" ? { lineHeight: 2.1 } : undefined}
            lang={opt.lang}
            dir={opt.dir}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? "bg-neem text-white" : "text-ink/70 hover:bg-mist/40"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
