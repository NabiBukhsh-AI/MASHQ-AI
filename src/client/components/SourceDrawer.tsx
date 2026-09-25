import React, { useEffect, useRef } from "react";
import { BidiText } from "./BidiText";

export interface SourceDrawerProps {
  open: boolean;
  onClose: () => void;
  factId: string | null;
  statement?: string;
  quote?: string;
  anchorKind?: string;
  anchorRef?: string;
  chunkText?: string;
  loading?: boolean;
}

export function SourceDrawer({
  open,
  onClose,
  factId,
  statement,
  quote,
  anchorKind,
  anchorRef,
  chunkText,
  loading = false,
}: SourceDrawerProps): React.JSX.Element | null {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Close on Escape key press
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  // Render passage with quote highlighted
  const renderPassage = () => {
    if (loading) {
      return (
        <div
          data-testid="source-loading"
          className="text-ink/60 flex items-center gap-2 py-8 text-xs"
        >
          <div className="border-mist border-t-neem h-4 w-4 animate-spin rounded-full border-2" />
          <span>Loading source passage...</span>
        </div>
      );
    }

    const text = chunkText || quote || "";
    if (!text) {
      return <p className="text-ink/60 text-xs italic">No source passage available.</p>;
    }

    const cleanQuote = quote?.trim();
    if (cleanQuote && text.includes(cleanQuote)) {
      const idx = text.indexOf(cleanQuote);
      const before = text.slice(0, idx);
      const after = text.slice(idx + cleanQuote.length);
      return (
        <div data-testid="source-passage" className="text-ink text-sm leading-relaxed">
          <span>{before}</span>
          <mark
            data-testid="highlighted-quote"
            className="bg-haldi/30 text-ink rounded px-1 py-0.5 font-semibold"
          >
            {cleanQuote}
          </mark>
          <span>{after}</span>
        </div>
      );
    }

    // Try without trailing punctuation if quote ends with . or ,
    const trimmedQuote = cleanQuote?.replace(/[.,;:]+$/, "");
    if (trimmedQuote && text.includes(trimmedQuote)) {
      const idx = text.indexOf(trimmedQuote);
      const before = text.slice(0, idx);
      const after = text.slice(idx + trimmedQuote.length);
      return (
        <div data-testid="source-passage" className="text-ink text-sm leading-relaxed">
          <span>{before}</span>
          <mark
            data-testid="highlighted-quote"
            className="bg-haldi/30 text-ink rounded px-1 py-0.5 font-semibold"
          >
            {trimmedQuote}
          </mark>
          <span>{after}</span>
        </div>
      );
    }

    return (
      <div data-testid="source-passage" className="text-ink text-sm leading-relaxed">
        <span>{text}</span>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-drawer-title"
      data-testid="source-drawer"
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity"
    >
      <div
        ref={drawerRef}
        className="border-mist flex h-full w-full max-w-md flex-col border-s bg-white shadow-xl"
      >
        {/* Header */}
        <header className="border-mist flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 id="source-drawer-title" className="text-ink text-sm font-bold">
              Verified Source
            </h2>
            {factId && <p className="text-ink/80 font-mono text-[11px]">Fact ID: {factId}</p>}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            data-testid="source-drawer-close"
            aria-label="Close source drawer"
            onClick={onClose}
            className="text-ink/80 hover:bg-paper hover:text-ink focus:ring-neem rounded-md p-1.5 focus:ring-2 focus:outline-none"
          >
            <span aria-hidden="true" className="text-base leading-none font-bold">
              &times;
            </span>
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Anchor location */}
          {(anchorKind || anchorRef) && (
            <div className="flex items-center gap-2">
              <span className="bg-mist/40 text-ink/80 rounded-full px-2.5 py-0.5 text-[11px] font-medium">
                {anchorKind ? `${anchorKind}: ` : ""}
                {anchorRef || "Document section"}
              </span>
            </div>
          )}

          {/* Fact Statement */}
          {statement && (
            <div className="border-mist/80 bg-paper/60 rounded-lg border p-3.5">
              <span className="text-ink/80 text-[11px] font-semibold tracking-wide uppercase">
                Key Fact
              </span>
              <p className="text-ink mt-1 text-xs leading-normal">
                <BidiText text={statement} as="span" />
              </p>
            </div>
          )}

          {/* Highlighted passage */}
          <div className="space-y-2">
            <span className="text-ink/80 text-[11px] font-semibold tracking-wide uppercase">
              Original Passage
            </span>
            <div className="border-mist bg-paper/30 rounded-lg border p-4">{renderPassage()}</div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-mist bg-paper/40 flex justify-end border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="border-mist text-ink hover:bg-paper focus:ring-neem rounded-lg border bg-white px-3 py-1.5 text-xs font-medium focus:ring-2 focus:outline-none"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
