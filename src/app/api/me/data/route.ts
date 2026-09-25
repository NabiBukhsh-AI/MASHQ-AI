import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withHandler } from "@/server/http/handler";
import { errors } from "@/server/http/errors";
import { db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { deleteLearnerData, exportLearnerData } from "@/server/security/retention";

/**
 * Self service export and deletion.
 *
 * Both act on the caller and nobody else: the identity comes from the session, so there is no
 * parameter to tamper with.
 */
async function pseudonymFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ pseudonym: user.pseudonym })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.pseudonym ?? "unknown";
}

export const GET = withHandler(
  { auth: "session", rateLimit: "perIpPerMinute" },
  async (_req, ctx) => {
    const session = ctx.session!;
    const data = await exportLearnerData(
      session.userId,
      session.orgId,
      await pseudonymFor(session.userId),
    );
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="my-mashq-data.json"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);

export const DELETE = withHandler(
  {
    auth: "session",
    rateLimit: "perIpPerMinute",
    // Typing the word is the confirmation: a deletion should not be one stray click.
    body: z.object({ confirm: z.literal("DELETE MY DATA") }),
  },
  async (_req, ctx) => {
    const session = ctx.session!;
    if (!ctx.body) throw errors.badRequest("Confirm the deletion to continue.");

    const counts = await deleteLearnerData(
      session.userId,
      session.orgId,
      await pseudonymFor(session.userId),
    );
    return NextResponse.json({ deleted: counts });
  },
);
