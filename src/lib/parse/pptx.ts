import { strFromU8, unzipSync } from "fflate";
import { ParseError } from "./errors";
import type { ParsedBlock, ParsedDoc, ParseLimits } from "./types";

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractTextFromXml(xml: string): {
  title?: string;
  paragraphs: string[];
} {
  const paragraphs: string[] = [];
  // Match each paragraph <a:p ...> ... </a:p>
  const pMatches = xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g);

  for (const pMatch of pMatches) {
    // Drop field runs (slide numbers, dates, footers) before collecting text runs.
    const pContent = (pMatch[1] || "").replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, "");
    const tMatches = pContent.matchAll(/<a:t\b[^>]*>([^<]*)<\/a:t>/g);
    let line = "";
    for (const tMatch of tMatches) {
      line += tMatch[1] || "";
    }
    const decoded = decodeXmlEntities(line).trim();
    if (decoded) {
      paragraphs.push(decoded);
    }
  }

  const title = paragraphs.length > 0 ? paragraphs[0] : undefined;
  return { title, paragraphs };
}

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\//, "");
}

function resolveRelativePath(baseDir: string, relativePath: string): string {
  const parts = (baseDir ? baseDir.split("/") : []).concat(relativePath.split("/"));
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

export async function parsePptx(bytes: Uint8Array, limits: ParseLimits = {}): Promise<ParsedDoc> {
  let unzipped: Record<string, Uint8Array>;
  try {
    // Inflate only the parts the parser reads; media and themes stay compressed.
    unzipped = unzipSync(bytes, {
      filter: (f) =>
        /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/[^/]+\.xml|slides\/_rels\/[^/]+\.rels|notesSlides\/[^/]+\.xml)$/.test(
          f.name,
        ),
    });
  } catch {
    throw new ParseError(
      "This PowerPoint file could not be opened. Export it again as .pptx or paste the text.",
    );
  }

  // Build normalized path map
  const fileMap = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(unzipped)) {
    fileMap.set(normalizeZipPath(key), value);
  }

  // 1. Determine slide order from ppt/presentation.xml and its rels
  const orderedSlidePaths: string[] = [];
  const presBytes = fileMap.get("ppt/presentation.xml");
  const presRelsBytes = fileMap.get("ppt/_rels/presentation.xml.rels");

  if (presBytes && presRelsBytes) {
    const presXml = strFromU8(presBytes);
    const presRelsXml = strFromU8(presRelsBytes);

    // Map relationship Id to Target
    const relsMap = new Map<string, string>();
    const relMatches = presRelsXml.matchAll(/<Relationship\b([^>]*)>/g);
    for (const m of relMatches) {
      const attrs = m[1] || "";
      const idMatch = attrs.match(/\bId="([^"]+)"/);
      const targetMatch = attrs.match(/\bTarget="([^"]+)"/);
      if (idMatch && targetMatch) {
        relsMap.set(idMatch[1]!, targetMatch[1]!);
      }
    }

    // Match slide order in <p:sldIdLst>
    const sldIdMatches = presXml.matchAll(/<p:sldId\b([^>]*)>/g);
    for (const m of sldIdMatches) {
      const attrs = m[1] || "";
      const rIdMatch = attrs.match(/\br:id="([^"]+)"/) || attrs.match(/\bid="([^"]+)"/);
      if (rIdMatch) {
        const target = relsMap.get(rIdMatch[1]!);
        if (target) {
          const resolvedPath = resolveRelativePath("ppt", target);
          if (fileMap.has(resolvedPath)) {
            orderedSlidePaths.push(resolvedPath);
          }
        }
      }
    }
  }

  // Fallback: If no slides discovered via relationships, find all slide XMLs and sort numerically
  if (orderedSlidePaths.length === 0) {
    const slideEntries: { path: string; num: number }[] = [];
    for (const path of fileMap.keys()) {
      const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
      if (match) {
        slideEntries.push({ path, num: Number(match[1]) });
      }
    }
    slideEntries.sort((a, b) => a.num - b.num);
    for (const entry of slideEntries) {
      orderedSlidePaths.push(entry.path);
    }
  }

  if (limits.maxSlides && orderedSlidePaths.length > limits.maxSlides) {
    throw new ParseError(
      `This deck has ${orderedSlidePaths.length} slides; the limit is ${limits.maxSlides}. Split it into parts.`,
    );
  }

  const blocks: ParsedBlock[] = [];
  let docTitle: string | undefined;

  for (let i = 0; i < orderedSlidePaths.length; i++) {
    const slidePath = orderedSlidePaths[i]!;
    const slideBytes = fileMap.get(slidePath);
    if (!slideBytes) continue;

    const slideXml = strFromU8(slideBytes);
    const { title: slideTitle, paragraphs } = extractTextFromXml(slideXml);
    if (!docTitle && slideTitle) {
      docTitle = slideTitle;
    }

    // Check for speaker notes in relationships
    let speakerNotes: string | undefined;
    const slideDir = slidePath.substring(0, slidePath.lastIndexOf("/"));
    const slideFileName = slidePath.substring(slidePath.lastIndexOf("/") + 1);
    const slideRelsPath = `${slideDir}/_rels/${slideFileName}.rels`;
    const slideRelsBytes = fileMap.get(slideRelsPath);

    if (slideRelsBytes) {
      const slideRelsXml = strFromU8(slideRelsBytes);
      const relMatches = slideRelsXml.matchAll(/<Relationship\b([^>]*)>/g);
      for (const m of relMatches) {
        const attrs = m[1] || "";
        const typeMatch = attrs.match(/\bType="([^"]+)"/);
        const targetMatch = attrs.match(/\bTarget="([^"]+)"/);
        if (typeMatch && targetMatch && typeMatch[1]!.includes("notesSlide")) {
          const notesPath = resolveRelativePath(slideDir, targetMatch[1]!);
          const notesBytes = fileMap.get(notesPath);
          if (notesBytes) {
            const notesXml = strFromU8(notesBytes);
            const { paragraphs: notesParagraphs } = extractTextFromXml(notesXml);
            if (notesParagraphs.length > 0) {
              speakerNotes = notesParagraphs.join("\n");
            }
          }
          break;
        }
      }
    }

    // Body and notes stay separate; the chunker joins them once.
    blocks.push({
      kind: "slide",
      ref: String(i + 1),
      heading: slideTitle,
      text: paragraphs.join("\n"),
      notes: speakerNotes,
    });
  }

  const fullText = blocks
    .map((b) => (b.notes ? `${b.text}\n\nNotes: ${b.notes}` : b.text))
    .filter(Boolean)
    .join("\n\n");

  return {
    title: docTitle,
    sourceType: "pptx",
    blocks,
    text: fullText,
    meta: {
      slideCount: blocks.length,
    },
  };
}
