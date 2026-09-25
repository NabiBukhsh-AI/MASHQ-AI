import { after, NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { AppError, errors } from "@/server/http/errors";
import { executeTurn } from "@/server/engine/turn";
import {
  acquireTurnLock,
  releaseTurnLock,
  getIdempotentTurn,
  saveIdempotentTurn,
} from "@/server/engine/lock";
import type { TurnEvent } from "@/lib/schemas/turn-events";

/**
 * heardUntilSentence is client supplied and lands in a smallint column, so it is bounded
 * here. An out of range value would throw inside the persistence batch and lose the turn,
 * the evidence and the session state with it.
 */
const TurnRequestSchema = z.object({
  input: z
    .object({
      mode: z.enum(["text", "voice", "tap", "drag", "idle", "start"]).optional(),
      text: z.string().max(4000).optional(),
      answer: z.unknown().optional(),
      questionId: z.string().max(200).optional(),
      clientTimings: z.record(z.string(), z.number()).optional(),
      interrupted: z.boolean().optional(),
      heardUntilSentence: z.number().int().min(0).max(1000).optional(),
    })
    .optional(),
  idempotencyKey: z.string().max(200).optional(),
  assessmentMode: z.enum(["inline", "separate"]).optional(),
});

type TurnRequestBody = z.infer<typeof TurnRequestSchema>;

function createSseStreamResponse(events: TurnEvent[], isReplay = false): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.close();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };

  if (isReplay) {
    headers["X-Idempotent-Replay"] = "true";
  }

  return new Response(stream, { headers });
}

export const POST = withHandler(
  { auth: "session", rateLimit: "chat" },
  async (request: Request, ctx) => {
    const params = await ctx.params;
    const sessionId = params?.sessionId;

    if (!sessionId || typeof sessionId !== "string") {
      throw errors.badRequest("Session id is required.");
    }

    let body: TurnRequestBody = {};
    try {
      const parsed = TurnRequestSchema.safeParse(await request.json());
      if (!parsed.success) {
        throw errors.badRequest("Check the reply you sent, then try again.");
      }
      body = parsed.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      body = {};
    }

    const idempotencyKey =
      request.headers.get("Idempotency-Key") || body.idempotencyKey || undefined;

    // Check idempotency cache first
    if (idempotencyKey) {
      const cachedEvents = await getIdempotentTurn(sessionId, idempotencyKey);
      if (cachedEvents) {
        return createSseStreamResponse(cachedEvents, true);
      }
    }

    // Step 1: Per-session turn lock
    const locked = await acquireTurnLock(sessionId);
    if (!locked) {
      return NextResponse.json({ error: "Turn in progress for this session." }, { status: 409 });
    }

    const session = ctx.session!;
    const emittedEvents: TurnEvent[] = [];
    const abortController = new AbortController();

    // Listen for client disconnect
    request.signal.addEventListener("abort", () => {
      abortController.abort();
      void releaseTurnLock(sessionId);
    });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of executeTurn(
            {
              sessionId,
              userId: session.userId,
              orgId: session.orgId,
              input: body.input,
              signal: abortController.signal,
            },
            { defer: (fn) => after(fn) },
          )) {
            emittedEvents.push(event);
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        } catch (streamErr) {
          controller.error(streamErr);
        } finally {
          await releaseTurnLock(sessionId);
          if (idempotencyKey && emittedEvents.length > 0) {
            await saveIdempotentTurn(sessionId, idempotencyKey, emittedEvents);
          }
        }
      },
      cancel() {
        abortController.abort();
        void releaseTurnLock(sessionId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
);
