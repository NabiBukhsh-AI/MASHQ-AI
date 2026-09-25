import { NextResponse } from "next/server";
import { withHandler } from "@/server/http/handler";
import { getContentStatus } from "@/server/ingest/status";

export const GET = withHandler(
  { auth: "session", rateLimit: "chat" },
  async (request: Request, context: unknown) => {
    const ctx = context as { params: { contentId: string } };
    const status = await getContentStatus(ctx.params.contentId);

    if (!status) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Content not found" } },
        { status: 404 },
      );
    }

    return NextResponse.json(status);
  },
);
