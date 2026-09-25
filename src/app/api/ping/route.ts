import { NextResponse } from "next/server";

/**
 * Lightweight health-check endpoint.
 * Must never import from src/server/db or src/server/llm.
 * Used by uptime monitors; responds fast with no side effects.
 */
import { withHandler } from "@/server/http/handler";

export const GET = withHandler({ auth: "public" }, async () => {
  return NextResponse.json({ ok: true });
});
