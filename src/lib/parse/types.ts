import { z } from "zod";

// Shared between the server parsers and the browser worker, so the
// server validates whatever a client sends as `kind: "parsed"`.

export const BlockKind = z.enum(["page", "slide", "section", "url"]);
export type BlockKind = z.infer<typeof BlockKind>;

export const ParsedBlockSchema = z.object({
  kind: BlockKind,
  ref: z.string().min(1).max(200),
  heading: z.string().max(500).optional(),
  text: z.string(),
  notes: z.string().optional(),
});
export type ParsedBlock = z.infer<typeof ParsedBlockSchema>;

export const ParsedDocSchema = z.object({
  title: z.string().max(300).optional(),
  sourceType: z.enum(["pdf", "docx", "pptx", "txt", "md", "paste", "url", "image", "html"]),
  blocks: z.array(ParsedBlockSchema).min(1).max(5000),
  text: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ParsedDoc = z.infer<typeof ParsedDocSchema>;

/** Caps from config.content, applied before text is extracted. */
export interface ParseLimits {
  maxPages?: number;
  maxSlides?: number;
}
