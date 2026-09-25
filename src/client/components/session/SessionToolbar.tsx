import React from "react";
import Link from "next/link";
import { BidiText } from "../BidiText";
import { LanguageSwitch } from "./LanguageSwitch";

export interface SessionToolbarProps {
  currentPersona?: string;
  onPersonaChange?: (persona: string) => void;
  currentLanguage?: string;
  onLanguageChange?: (language: string) => void;
  journeyTitle?: string;
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
}

const PERSONA_OPTIONS = [
  { id: "branch_new_joiner", label: "Branch new joiner" },
  { id: "ops_officer", label: "Operations officer" },
  { id: "senior_manager", label: "Senior manager" },
];

export function SessionToolbar({
  currentPersona = "branch_new_joiner",
  onPersonaChange,
  currentLanguage = "en",
  onLanguageChange,
  journeyTitle,
  inspectorOpen = false,
  onToggleInspector,
}: SessionToolbarProps): React.JSX.Element {
  return (
    <header
      role="toolbar"
      aria-label="Session controls"
      data-testid="session-toolbar"
      className="border-mist flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-3 md:px-6"
    >
      {/* Brand & Journey title */}
      <div className="flex items-center gap-3">
        <Link
          href="/learn"
          className="text-ink hover:text-neem text-sm font-bold tracking-tight transition-colors focus-visible:outline-none"
        >
          Mashq
        </Link>
        {journeyTitle && (
          <>
            <span className="text-mist" aria-hidden="true">
              /
            </span>
            <BidiText
              text={journeyTitle}
              as="span"
              className="text-ink/70 max-w-[220px] truncate text-xs font-medium"
            />
          </>
        )}
      </div>

      {/* Controls: Persona, Language, Inspector */}
      <div className="flex flex-wrap items-center gap-2 md:gap-4">
        {/* Persona selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="toolbar-persona-select" className="sr-only">
            Persona
          </label>
          <select
            id="toolbar-persona-select"
            value={currentPersona}
            onChange={(e) => onPersonaChange?.(e.target.value)}
            data-testid="toolbar-persona-select"
            className="border-mist bg-paper text-ink focus:border-neem rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none"
          >
            {PERSONA_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Language selector: each option carries its own lang and dir so a
            screen reader pronounces the Urdu label instead of spelling it in English. */}
        <LanguageSwitch
          value={currentLanguage}
          onChange={(lang) => onLanguageChange?.(lang)}
          className="bg-paper"
        />

        {/* Engine Inspector toggle */}
        {onToggleInspector && (
          <button
            type="button"
            id="toggle-inspector-btn"
            onClick={onToggleInspector}
            aria-label="Engine Inspector"
            aria-expanded={Boolean(inspectorOpen)}
            aria-controls="engine-inspector"
            data-testid="toggle-inspector-btn"
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none ${
              inspectorOpen
                ? "border-neem bg-neem/10 text-neem"
                : "border-mist bg-paper text-ink/70 hover:text-ink"
            }`}
          >
            <span>Inspector</span>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${inspectorOpen ? "bg-neem" : "bg-ink/40"}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    </header>
  );
}
