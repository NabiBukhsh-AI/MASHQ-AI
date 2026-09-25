"use client";

import React from "react";
import { useLang } from "./LanguageProvider";
import type { AppLanguage } from "@/lib/i18n/strings";

/**
 * The EN / Urdu / Roman switch. It lived inside AppShell, which meant the login page had no way
 * to offer it: a learner who reads Urdu had to sign in through an English form first.
 */

const OPTIONS: Array<{ value: AppLanguage; label: string; urduFont: boolean }> = [
  { value: "en", label: "EN", urduFont: false },
  { value: "ur", label: "اردو", urduFont: true },
  { value: "ur-Latn", label: "Roman", urduFont: false },
];

export function LanguageToggle({ className = "" }: { className?: string }): React.JSX.Element {
  const { lang, setLang, t } = useLang();

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={`flex items-center rounded-md border border-[var(--color-mist)] p-0.5 text-xs font-medium ${className}`}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setLang(opt.value)}
          aria-pressed={lang === opt.value}
          lang={opt.value === "ur" ? "ur" : "en"}
          className={`rounded px-1.5 py-0.5 ${opt.urduFont ? "font-urdu" : ""} ${
            lang === opt.value
              ? "bg-[var(--color-neem)] text-white"
              : "text-[var(--color-ink)] hover:bg-black/5"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
