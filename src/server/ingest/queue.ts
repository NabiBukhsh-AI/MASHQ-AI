export async function enqueueChunks(docId: string, chunkIds: string[]): Promise<void> {
  // Mock queuing
  // In a real app we'd insert into content_embedding_queue
}

export async function processEmbeddingBatch(): Promise<{ processed: number; errors: number }> {
  // Mock processing
  // Fetch up to 100 queued chunks
  // Generate embeddings
  // Update chunk tables
  // Delete from queue
  return { processed: 0, errors: 0 };
}
