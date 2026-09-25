import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { withHandler } from "@/server/http/handler";

// Shallow: process is up. Deep (?deep=1): database reachable and pgvector present.
export const GET = withHandler(
  { auth: "health", query: z.object({ deep: z.enum(["0", "1"]).default("0") }) },
  async (_req, ctx) => {
    if (ctx.query.deep !== "1") return NextResponse.json({ status: "ok" });

    const started = performance.now();
    const rows = await db.execute(
      sql`select extversion from pg_extension where extname = 'vector'`,
    );
    const vectorVersion = (rows.rows[0]?.extversion as string | undefined) ?? null;
    return NextResponse.json({
      status: vectorVersion ? "ok" : "degraded",
      db: { ok: true, ms: Math.round(performance.now() - started), vectorVersion },
    });
  },
);
