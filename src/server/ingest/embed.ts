import { log } from "../obs/logger";

// Embeddings are off for now:
// retrieval runs on full-text search plus the glossary, and small sources ride
// in the prefix in full. This stage records the decision so the pipeline and
// the ingestion report stay honest; the semantic branch in retrieval/hybrid.ts
// activates as soon as chunks carry embeddings.
export async function embedChunks(
  contentId: string,
): Promise<{ embedded: number; skipped: string }> {
  const skipped = "embeddings disabled: full-text retrieval only";
  log.info({ event: "embed_skipped", contentId, reason: skipped });
  return { embedded: 0, skipped };
}
