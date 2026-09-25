import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { processEmbeddingBatch } from "@/server/ingest/queue";

export const GET = withHandler({ auth: "cron" }, async () => {
  const { processed, errors } = await processEmbeddingBatch();
  return NextResponse.json({ processed, errors });
});
