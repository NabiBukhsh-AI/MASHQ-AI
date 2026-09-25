import React, { type ReactNode } from "react";
import { applyDigitStyle } from "@/lib/text/digits";

export type SupportedLang = "en" | "ur" | "ur-Latn" | "mixed";
export type TextDirection = "ltr" | "rtl" | "auto";

export interface BidiTextProps {
  text?: string;
  children?: ReactNode;
  lang?: SupportedLang;
  dir?: TextDirection;
  className?: string;
  as?: "span" | "div" | "p";
  /** Org preference from config language.urduDigits. Western is the default. */
  digits?: "western" | "eastern";
}

// Unicode block for Arabic and Urdu characters
const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
// Matches Latin sequences (letters, numbers, common banking abbreviations like CNIC, IBAN, ATM)
const LATIN_TOKEN_REGEX = /([A-Za-z0-9][A-Za-z0-9\-./_%+@:]*)/g;

/**
 * Isolates embedded Latin terms within Urdu text using <bdi> (bidirectional isolate)
 * tags, applies appropriate text direction, and enforces a minimum 2.1 line-height
 * for Urdu Nastaliq typography to prevent vertical glyph clipping.
 */
export function BidiText({
  text,
  children,
  lang,
  dir,
  className = "",
  as = "span",
  digits = "western",
}: BidiTextProps): React.JSX.Element {
  const rawString = typeof text === "string" ? text : typeof children === "string" ? children : "";
  const contentString = applyDigitStyle(rawString, digits);

  // Determine direction and language if not explicitly provided
  const hasArabicScript = ARABIC_SCRIPT_REGEX.test(contentString);
  const effectiveLang: SupportedLang = lang ?? (hasArabicScript ? "ur" : "en");
  const effectiveDir: TextDirection =
    dir ??
    (effectiveLang === "ur"
      ? "rtl"
      : effectiveLang === "mixed"
        ? hasArabicScript
          ? "rtl"
          : "ltr"
        : "ltr");

  const Component = as;

  // Urdu styling classes enforcing line-height >= 2.1
  const isUrdu = effectiveLang === "ur" || effectiveDir === "rtl";
  const typographyClasses = isUrdu ? "font-urdu leading-[2.2]" : "font-sans leading-normal";

  // If text string is provided, perform bidirectional token isolation
  const renderedContent = contentString ? isolateBidi(contentString, isUrdu) : children;

  return (
    <Component
      lang={effectiveLang}
      dir={effectiveDir}
      className={`${typographyClasses} ${className}`.trim()}
    >
      {renderedContent}
    </Component>
  );
}

/**
 * Tokenizes text and wraps opposing script runs in <bdi> elements.
 * For Urdu (RTL) context: wraps Latin sequences in <bdi dir="ltr">.
 * For English (LTR) context: wraps Arabic script sequences in <bdi dir="rtl">.
 */
export function isolateBidi(content: string, isRtlContext: boolean): ReactNode[] {
  if (isRtlContext) {
    // In Urdu RTL context, isolate Latin alphanumeric terms (e.g. "CNIC", "IBAN", "42201-1234567-1")
    const nodes: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const regex = new RegExp(LATIN_TOKEN_REGEX);
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(content.slice(lastIndex, match.index));
      }
      const token = match[0];
      nodes.push(
        <bdi key={`bdi-ltr-${match.index}`} dir="ltr" className="inline">
          {token}
        </bdi>,
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      nodes.push(content.slice(lastIndex));
    }

    return nodes.length > 0 ? nodes : [content];
  } else {
    // In English LTR context, isolate any embedded Urdu/Arabic script phrases (without capturing outer spaces)
    const arabicRunRegex =
      /([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:\s+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*)/g;
    const nodes: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = arabicRunRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(content.slice(lastIndex, match.index));
      }
      const token = match[0];
      nodes.push(
        <bdi key={`bdi-rtl-${match.index}`} dir="rtl" lang="ur" className="font-urdu leading-[2.2]">
          {token}
        </bdi>,
      );
      lastIndex = arabicRunRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      nodes.push(content.slice(lastIndex));
    }

    return nodes.length > 0 ? nodes : [content];
  }
}
