import { NextResponse } from "next/server";
import { z } from "zod";
import { withHandler } from "@/server/http/handler";
import { createSession } from "@/server/engine/session";

const CreateSessionSchema = z.object({
  journeyId: z.string().min(1),
  personaId: z.string().optional(),
  language: z.string().optional(),
  presets: z.array(z.string()).optional(),
});

export const POST = withHandler(
  {
    auth: "session",
    rateLimit: "chat",
    body: CreateSessionSchema,
  },
  async (_req, ctx) => {
    const session = ctx.session!;
    const { journeyId, personaId, language, presets } = ctx.body;

    const sessionId = await createSession({
      journeyId,
      userId: session.userId,
      orgId: session.orgId,
      personaId,
      language,
      presets,
    });

    return NextResponse.json({ sessionId }, { status: 201 });
  },
);
