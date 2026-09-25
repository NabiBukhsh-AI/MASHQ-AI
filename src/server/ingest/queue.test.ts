import { describe, it, expect } from "vitest";
import { enqueueChunks, processEmbeddingBatch } from "./queue";

describe("Embedding Queue", () => {
  it("enqueues and processes (mock)", async () => {
    await enqueueChunks("doc1", ["c1", "c2"]);
    const res = await processEmbeddingBatch();
    expect(res.processed).toBeDefined();
    expect(res.errors).toBeDefined();
  });
});
