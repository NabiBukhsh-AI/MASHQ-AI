"use client";

import React from "react";
import { useLang } from "@/client/i18n/LanguageProvider";
import { LanguageToggle } from "@/client/i18n/LanguageToggle";
import { BidiText } from "@/client/components/BidiText";

/**
 * The sign in form, as a client component so it can read the chosen language. The page was
 * English only, including the language a learner would use to choose their language.
 */
export function LoginForm({
  action,
  error,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error?: string;
}): React.JSX.Element {
  const { lang, t } = useLang();

  const errorText = error === "rate" ? t("signInTooMany") : error ? t("signInWrong") : null;

  return (
    <>
      <div className="mb-6 flex justify-end">
        <LanguageToggle />
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-[var(--color-ink)]">
        <BidiText lang={lang} text={t("signInTitle")} />
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink)]/70">
        <BidiText lang={lang} text={t("signInSubtitle")} />
      </p>

      <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
        {errorText ? (
          <p
            id="login-error"
            role="alert"
            className="rounded border border-[var(--color-kattha)]/30 bg-red-50 p-3 text-sm font-medium text-[var(--color-kattha)]"
          >
            <BidiText lang={lang} text={errorText} />
          </p>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--color-ink)]">
          <BidiText lang={lang} text={t("email")} />
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            dir="ltr"
            aria-describedby={error ? "login-error" : undefined}
            className="rounded-md border border-[var(--color-mist)] bg-white px-3 py-2 text-[var(--color-ink)] shadow-xs transition-colors focus-visible:outline"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--color-ink)]">
          <BidiText lang={lang} text={t("password")} />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
            aria-describedby={error ? "login-error" : undefined}
            className="rounded-md border border-[var(--color-mist)] bg-white px-3 py-2 text-[var(--color-ink)] shadow-xs transition-colors focus-visible:outline"
          />
        </label>

        <button
          type="submit"
          className="mt-2 rounded-md bg-[var(--color-neem)] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-95 focus-visible:outline"
        >
          <BidiText lang={lang} text={t("navSignIn")} />
        </button>
      </form>
    </>
  );
}
