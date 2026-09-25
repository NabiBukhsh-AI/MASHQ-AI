"use client";

import { signOut } from "@/app/(auth)/login/actions";
import { useLang } from "@/client/i18n/LanguageProvider";
import { BidiText } from "./BidiText";

export function SignOutButton() {
  const { lang, t } = useLang();
  return (
    <form action={signOut}>
      <button type="submit" className="text-sm underline">
        <BidiText lang={lang} text={t("navSignOut")} />
      </button>
    </form>
  );
}
