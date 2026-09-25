"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type AppLanguage } from "@/lib/i18n/strings";
import { useLang } from "@/client/i18n/LanguageProvider";
import { BidiText } from "./BidiText";
import { SignOutButton } from "./SignOutButton";

export interface AppShellUser {
  name?: string;
  email?: string;
  role?: string;
}

export interface AppShellProps {
  children: React.ReactNode;
  user?: AppShellUser | null;
}

export type TextScale = "small" | "normal" | "large" | "xlarge";

export function AppShell({ children, user }: AppShellProps): React.JSX.Element {
  const pathname = usePathname();
  // The language lives in the provider so every page can read it, not just this header.
  const { lang, setLang, t } = useLang();
  const [contrast, setContrast] = useState<"normal" | "high">("normal");
  const [textScale, setTextScale] = useState<TextScale>("normal");
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Apply contrast and text-scale to document root for CSS selector matching
  // lang and dir are the provider's job; this only owns contrast and text scale.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-contrast", contrast);
      document.documentElement.setAttribute("data-text-scale", textScale);
    }
  }, [contrast, textScale]);

  const toggleContrast = () => {
    setContrast((prev) => (prev === "normal" ? "high" : "normal"));
  };

  const cycleTextScale = () => {
    const scales: TextScale[] = ["small", "normal", "large", "xlarge"];
    const nextIndex = (scales.indexOf(textScale) + 1) % scales.length;
    setTextScale(scales[nextIndex] ?? "normal");
  };

  const userRole = user?.role ?? "learner";

  // Build role-based navigation links
  const navLinks = [
    {
      href: "/learn",
      labelKey: "navPractise",
      roles: ["learner", "manager", "ld_manager", "admin"],
    },
    // No /journey route: the journey map is a column on /learn, so this used to 404. It is
    // linked to the same place the map is rather than duplicating the page.
    {
      href: "/learn/progress",
      labelKey: "navProgress",
      roles: ["learner", "manager", "ld_manager", "admin"],
    },
    // Where an L&D manager adds the material learners practise. The route was already role
    // gated but had no link, so the people whose job it is had no way to reach it.
    { href: "/library", labelKey: "navLibrary", roles: ["ld_manager", "admin"] },
    { href: "/manage", labelKey: "navDashboard", roles: ["manager", "ld_manager", "admin"] },
    // The route is report, singular. The plural 404ed.
    { href: "/manage/report", labelKey: "navReports", roles: ["manager", "ld_manager", "admin"] },
    // /admin is a stub; the settings screen is /admin/config.
    { href: "/admin/config", labelKey: "navConfig", roles: ["admin"] },
    { href: "/admin/audit", labelKey: "navAudit", roles: ["admin"] },
  ].filter((item) => item.roles.includes(userRole));

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-paper)] text-[var(--color-ink)]">
      {/* 1. Skip to Content link for keyboard accessibility */}
      <a
        href="#main-content"
        onClick={() => {
          document.getElementById("main-content")?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:bg-[var(--color-ink)] focus:px-4 focus:py-2 focus:text-[var(--color-paper)] focus:outline focus:outline-2 focus:outline-[var(--color-neem)]"
      >
        {t("skipToContent")}
      </a>

      {/* 2. Header and Navigation bar */}
      <header
        role="banner"
        className="sticky top-0 z-40 border-b border-[var(--color-mist)] bg-[var(--color-paper)]/95 backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          {/* Logo / Brand */}
          <div className="flex items-center space-x-3">
            <Link
              href={user ? "/learn" : "/login"}
              className="group flex items-center gap-2 rounded px-2 py-1 text-xl font-bold tracking-tight text-[var(--color-ink)] focus-visible:outline"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--color-neem)] text-sm font-bold text-white">
                M
              </span>
              <BidiText lang={lang} text={t("appName")} className="font-semibold" />
            </Link>
          </div>

          {/* Desktop Navigation Links */}
          <nav aria-label="Main Navigation" className="hidden md:flex md:items-center md:gap-1">
            {navLinks.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline ${
                    isActive
                      ? "bg-[var(--color-mist)] font-semibold text-[var(--color-ink)]"
                      : "text-[var(--color-ink)]/80 hover:bg-[var(--color-mist)]/50 hover:text-[var(--color-ink)]"
                  }`}
                >
                  <BidiText lang={lang} text={t(item.labelKey)} />
                </Link>
              );
            })}
          </nav>

          {/* Accessibility & Language Toolbar */}
          <div className="flex items-center gap-2" role="region" aria-label={t("a11yControls")}>
            {/* Language Switcher */}
            <div className="flex items-center rounded-md border border-[var(--color-mist)] p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setLang("en")}
                aria-pressed={lang === "en"}
                className={`rounded px-1.5 py-0.5 ${
                  lang === "en"
                    ? "bg-[var(--color-neem)] text-white"
                    : "text-[var(--color-ink)] hover:bg-black/5"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang("ur")}
                aria-pressed={lang === "ur"}
                className={`font-urdu rounded px-1.5 py-0.5 ${
                  lang === "ur"
                    ? "bg-[var(--color-neem)] text-white"
                    : "text-[var(--color-ink)] hover:bg-black/5"
                }`}
              >
                اردو
              </button>
              <button
                type="button"
                onClick={() => setLang("ur-Latn")}
                aria-pressed={lang === "ur-Latn"}
                className={`rounded px-1.5 py-0.5 ${
                  lang === "ur-Latn"
                    ? "bg-[var(--color-neem)] text-white"
                    : "text-[var(--color-ink)] hover:bg-black/5"
                }`}
              >
                Roman
              </button>
            </div>

            {/* Text Scale Button */}
            <button
              type="button"
              onClick={cycleTextScale}
              title={`${t("textSize")}: ${textScale}`}
              aria-label={`${t("textSize")} (${textScale})`}
              className="flex h-8 items-center justify-center rounded-md border border-[var(--color-mist)] px-2 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-mist)]/50 focus-visible:outline"
            >
              A
              {textScale === "large"
                ? "+"
                : textScale === "xlarge"
                  ? "++"
                  : textScale === "small"
                    ? "-"
                    : ""}
            </button>

            {/* High Contrast Toggle Button */}
            <button
              type="button"
              onClick={toggleContrast}
              aria-pressed={contrast === "high"}
              title={t("highContrast")}
              aria-label={t("highContrast")}
              className={`flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-mist)] text-xs font-bold transition-colors focus-visible:outline ${
                contrast === "high"
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                  : "text-[var(--color-ink)] hover:bg-[var(--color-mist)]/50"
              }`}
            >
              <span aria-hidden="true">◐</span>
            </button>

            {/* User details and Sign Out */}
            {user && (
              <div className="hidden items-center gap-2 border-l border-[var(--color-mist)] pl-2 text-xs lg:flex">
                <span className="font-medium text-[var(--color-ink)]/80">
                  {user.name || user.email}
                </span>
                <SignOutButton />
              </div>
            )}

            {/* Mobile Navigation Menu Toggle */}
            {navLinks.length > 0 && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-mist)] focus-visible:outline md:hidden"
              >
                <span aria-hidden="true">{mobileMenuOpen ? "✕" : "☰"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Nav Menu Drawer */}
        {mobileMenuOpen && (
          <nav
            aria-label="Mobile Navigation"
            className="border-t border-[var(--color-mist)] px-4 py-2 md:hidden"
          >
            <div className="flex flex-col space-y-1">
              {navLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-md px-3 py-2 text-base font-medium text-[var(--color-ink)] hover:bg-[var(--color-mist)]/50 focus-visible:outline"
                >
                  <BidiText lang={lang} text={t(item.labelKey)} />
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>

      {/* 3. Main Landmark Container */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col focus:outline-none"
      >
        {children}
      </main>
    </div>
  );
}
