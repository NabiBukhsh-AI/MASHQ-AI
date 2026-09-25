import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withHandler } from "@/server/http/handler";
import { db } from "@/server/db/client";
import { contentChunks } from "@/server/db/schema";

export const GET = withHandler({ auth: "session", rateLimit: "chat" }, async (_req, ctx) => {
  const params = (await ctx.params) as { contentId?: string; chunkId?: string };
  const contentId = params?.contentId;
  const chunkId = params?.chunkId;

  if (!contentId || !chunkId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Missing contentId or chunkId" } },
      { status: 400 },
    );
  }

  const orgId = ctx.session?.orgId;
  if (!orgId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const [chunk] = await db
    .select({
      id: contentChunks.id,
      contentId: contentChunks.contentId,
      ordinal: contentChunks.ordinal,
      anchorKind: contentChunks.anchorKind,
      anchorRef: contentChunks.anchorRef,
      text: contentChunks.text,
      headingPath: contentChunks.headingPath,
    })
    .from(contentChunks)
    .where(
      and(
        eq(contentChunks.id, chunkId),
        eq(contentChunks.contentId, contentId),
        eq(contentChunks.orgId, orgId),
      ),
    )
    .limit(1);

  if (!chunk) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Chunk not found" } },
      { status: 404 },
    );
  }

  return NextResponse.json({ chunk });
});
