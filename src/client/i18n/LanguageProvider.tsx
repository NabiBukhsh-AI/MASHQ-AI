"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { t as translate, type AppLanguage } from "@/lib/i18n/strings";

/**
 * The chosen interface language, shared across the whole app.
 *
 * It used to live in AppShell's own useState, which meant nothing outside the header could read
 * it: switching to Urdu changed the nav and left every page, button and label in English. It
 * also reset on every navigation. This holds it in one place, remembers it, and sets lang and
 * dir on the document so Urdu lays out right to left.
 */

interface LanguageContextValue {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  /** Look up a UI string in the current language. */
  t: (key: string) => string;
  /** True when the current language is written right to left. */
  rtl: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "mashq.lang";
const VALID: readonly string[] = ["en", "ur", "ur-Latn", "mixed"];

/**
 * localStorage as an external store.
 *
 * Reading it into state from an effect causes a cascading render, and reading it in a lazy
 * initializer mismatches hydration, because the server has no idea what the browser saved.
 * useSyncExternalStore is built for exactly this: the server snapshot is the default and React
 * reconciles the stored value after hydration without a warning.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the language should follow here too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStored(): AppLanguage {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // Strings compare by value, so returning a fresh one each call is still a stable snapshot.
    return saved && VALID.includes(saved) ? (saved as AppLanguage) : "en";
  } catch {
    // Private mode or blocked storage: the default is fine.
    return "en";
  }
}

function writeStored(next: AppLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembering the choice is a smaller failure than not applying it.
  }
  for (const listener of listeners) listener();
}

export function LanguageProvider({
  children,
  defaultLang = "en",
}: {
  children: React.ReactNode;
  defaultLang?: AppLanguage;
}): React.JSX.Element {
  const lang = useSyncExternalStore(subscribe, readStored, () => defaultLang);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // Urdu script is right to left. Roman Urdu is Urdu in Latin letters, so it stays left to
    // right, and mixed follows the dominant script of each message rather than the page.
    const isUrduScript = lang === "ur";
    document.documentElement.setAttribute("lang", isUrduScript ? "ur" : "en");
    document.documentElement.setAttribute("dir", isUrduScript ? "rtl" : "ltr");
  }, [lang]);

  const setLang = useCallback((next: AppLanguage) => writeStored(next), []);

  const value: LanguageContextValue = {
    lang,
    setLang,
    t: useCallback((key: string) => translate(key, lang), [lang]),
    rtl: lang === "ur",
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Reads the interface language. Safe outside a provider, where it reports English: a component
 * rendered on its own in a test should not throw for want of a wrapper.
 */
export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx) return ctx;
  return {
    lang: "en",
    setLang: () => {},
    t: (key: string) => translate(key, "en"),
    rtl: false,
  };
}
