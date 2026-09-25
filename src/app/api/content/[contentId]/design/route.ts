import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { sseStream } from "@/server/http/sse";
import { runPipeline } from "@/server/ingest/pipeline";

export const maxDuration = 300;

export const GET = withHandler({ auth: "session" }, async (req, ctx) => {
  const params = await ctx.params;
  const contentId = params?.contentId;

  if (!contentId || typeof contentId !== "string") {
    throw errors.badRequest("contentId is required.");
  }

  const session = ctx.session!;

  return sseStream(req, async (send, signal) => {
    await runPipeline(contentId, session.orgId, {
      send: (event, data) => {
        send(JSON.stringify(data), event);
      },
      signal,
    });
  });
});
