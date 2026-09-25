export interface ContentStatus {
  status: "parsing" | "chunking" | "embedding" | "ready" | "error";
  progress: number;
  error?: string;
}

export async function getContentStatus(contentId: string): Promise<ContentStatus | null> {
  // Mock implementation
  // In a real app we'd aggregate row counts in content_documents, document_chunks, content_embedding_queue
  if (contentId === "unknown") return null;
  if (contentId === "error") return { status: "error", progress: 0, error: "Mock error" };

  return { status: "ready", progress: 100 };
}
