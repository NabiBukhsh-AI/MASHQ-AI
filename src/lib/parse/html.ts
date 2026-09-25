import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { ParseError } from "./errors";
import type { ParsedBlock, ParsedDoc } from "./types";

/**
 * Article extraction with Readability, then one block per heading section so
 * fact anchors can point at `url#heading-id`. Falls back to a single block.
 *
 * linkedom rather than jsdom. jsdom 30 depends on html-encoding-sniffer, which requires the
 * ESM only @exodus/bytes, so on Vercel this module threw ERR_REQUIRE_ESM while the function
 * was still initialising and every POST to /api/content returned an empty 500, including to
 * unauthenticated callers owed a 401. linkedom is built for serverless, has no such chain,
 * and gives Readability the DOM it needs. jsdom stays a devDependency for one test that asks
 * for a jsdom environment.
 */
export function parseHtml(html: string, url: string): ParsedDoc {
  const { document } = parseHTML(html);
  // Readability resolves relative links against this; linkedom leaves it unset.
  try {
    Object.defineProperty(document, "documentURI", { value: url, configurable: true });
  } catch {
    // Not settable on this build: link resolution suffers, text extraction does not.
  }
  const article = new Readability(document as unknown as Document).parse();
  if (!article || !article.textContent?.trim()) {
    throw new ParseError(
      "This page has no readable article text. Try a different page or paste the text.",
    );
  }

  const title = (article.title || document.title || "Untitled").trim();
  // A full document, not a bare <body>: linkedom parses the fragment but leaves the body
  // unqueryable, so querySelectorAll below silently returned nothing and every section
  // collapsed into one block.
  const content = parseHTML(`<html><body>${article.content ?? ""}</body></html>`).document.body;
  const blocks: ParsedBlock[] = [];
  // Readability lifts the h1 into the title, so the opening section carries the title.
  let heading: string | undefined = title;
  let headingId = "top";
  let buffer: string[] = [];
  const usedIds = new Map<string, number>();

  const flush = () => {
    const text = buffer
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text) blocks.push({ kind: "url", ref: `${url}#${headingId}`, heading, text });
    buffer = [];
  };

  for (const el of Array.from(
    content.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre, td, th, figcaption"),
  )) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/^H[1-4]$/.test(el.tagName)) {
      flush();
      heading = text;
      const base =
        (el.id || text)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60) || "section";
      const n = (usedIds.get(base) ?? 0) + 1;
      usedIds.set(base, n);
      headingId = n === 1 ? base : `${base}-${n}`;
    } else {
      buffer.push(text);
    }
  }
  flush();

  if (!blocks.length) {
    blocks.push({
      kind: "url",
      ref: `${url}#top`,
      heading: title,
      text: article.textContent.replace(/\s+/g, " ").trim(),
    });
  }

  return {
    title,
    sourceType: "url",
    blocks,
    text: blocks.map((b) => (b.heading ? `${b.heading}\n${b.text}` : b.text)).join("\n\n"),
    meta: {
      sectionsCount: blocks.length,
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
    },
  };
}
