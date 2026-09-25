import React, { type ReactNode } from "react";

export interface SafeMarkdownProps {
  text: string;
  className?: string;
}

/**
 * Strips raw HTML, markdown links, and markdown images from text,
 * then safely parses and renders only bold, italic, lists, and line breaks
 * as native React elements. Never uses dangerouslySetInnerHTML.
 */
export function SafeMarkdown({ text, className }: SafeMarkdownProps): React.JSX.Element {
  const sanitized = sanitizeInput(text || "");
  const blocks = parseBlocks(sanitized);

  return <div className={className}>{blocks}</div>;
}

/**
 * Strips all raw HTML tags, markdown links, markdown images, and angle brackets.
 */
export function sanitizeInput(raw: string): string {
  let s = raw;
  // 1. Remove markdown images: ![alt](url) -> keep alt or strip
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // 2. Remove markdown links: [text](url) -> keep text only
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // 3. Remove raw HTML tags (e.g. <script>, <img ...>, <a>, etc.)
  s = s.replace(/<[^>]*>/g, "");
  return s;
}

/**
 * Parses block-level markdown (paragraphs, unordered lists, ordered lists, blockquotes).
 */
function parseBlocks(content: string): ReactNode[] {
  const rawLines = content.split(/\r?\n/);
  const elements: ReactNode[] = [];

  let i = 0;
  let blockKey = 0;

  while (i < rawLines.length) {
    const line = rawLines[i] ?? "";

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Unordered list item: starts with "- " or "* "
    if (/^[-*]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < rawLines.length && /^[-*]\s+/.test(rawLines[i] ?? "")) {
        const itemLine = rawLines[i] ?? "";
        listItems.push(itemLine.replace(/^[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${blockKey++}`} className="my-2 list-disc space-y-1 pl-5">
          {listItems.map((item, idx) => (
            <li key={idx}>{parseInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list item: starts with "1. ", "2. ", etc.
    if (/^\d+\.\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i] ?? "")) {
        const itemLine = rawLines[i] ?? "";
        listItems.push(itemLine.replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${blockKey++}`} className="my-2 list-decimal space-y-1 pl-5">
          {listItems.map((item, idx) => (
            <li key={idx}>{parseInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blockquote: starts with "> "
    if (/^>\s*/.test(line)) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && /^>\s*/.test(rawLines[i] ?? "")) {
        const qLine = rawLines[i] ?? "";
        quoteLines.push(qLine.replace(/^>\s*/, ""));
        i++;
      }
      elements.push(
        <blockquote
          key={`bq-${blockKey++}`}
          className="my-2 border-l-4 border-[var(--color-haldi)] pl-3 text-[var(--color-ink)] italic opacity-90"
        >
          {quoteLines.map((ql, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <br />}
              {parseInline(ql)}
            </React.Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Standard paragraph: accumulate consecutive non-empty lines
    const paragraphLines: string[] = [];
    while (
      i < rawLines.length &&
      (rawLines[i] ?? "").trim() !== "" &&
      !/^[-*]\s+/.test(rawLines[i] ?? "") &&
      !/^\d+\.\s+/.test(rawLines[i] ?? "") &&
      !/^>\s*/.test(rawLines[i] ?? "")
    ) {
      paragraphLines.push(rawLines[i] ?? "");
      i++;
    }

    elements.push(
      <p key={`p-${blockKey++}`} className="my-1.5 leading-relaxed">
        {paragraphLines.map((pLine, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {parseInline(pLine)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return elements;
}

/**
 * Parses inline markdown: bold (** or __), italic (* or _), and returns React nodes.
 */
export function parseInline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  // Tokenizer regex matching bold (***, **, __) and italic (*, _)
  // Order matters: match 3 stars/underscores first, then 2, then 1.
  const regex = /(\*\*\*[^*]+\*\*\*|___[^_]+___|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    const matched = match[0];
    const key = `inline-${match.index}`;

    if (matched.startsWith("***") && matched.endsWith("***")) {
      const inner = matched.slice(3, -3);
      tokens.push(
        <strong key={key}>
          <em>{parseInline(inner)}</em>
        </strong>,
      );
    } else if (matched.startsWith("___") && matched.endsWith("___")) {
      const inner = matched.slice(3, -3);
      tokens.push(
        <strong key={key}>
          <em>{parseInline(inner)}</em>
        </strong>,
      );
    } else if (
      (matched.startsWith("**") && matched.endsWith("**")) ||
      (matched.startsWith("__") && matched.endsWith("__"))
    ) {
      const inner = matched.slice(2, -2);
      tokens.push(<strong key={key}>{parseInline(inner)}</strong>);
    } else if (
      (matched.startsWith("*") && matched.endsWith("*")) ||
      (matched.startsWith("_") && matched.endsWith("_"))
    ) {
      const inner = matched.slice(1, -1);
      tokens.push(<em key={key}>{parseInline(inner)}</em>);
    } else {
      tokens.push(matched);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}
