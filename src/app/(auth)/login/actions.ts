"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { getSession, homeFor } from "@/server/auth/guards";
import { log } from "@/server/obs/logger";
import { limit } from "@/server/security/ratelimit";

const credentials = z.object({ email: z.email(), password: z.string().min(1) });

export async function signIn(formData: FormData): Promise<void> {
  // Server actions bypass the /api/auth rate limit, so throttle here per IP.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await limit("login", ip)).ok) redirect("/login?error=rate");

  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=invalid");

  try {
    // nextCookies() in the auth config sets the session cookie from a server action.
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (e) {
    log.info({ event: "sign_in_failed", reason: e instanceof Error ? e.message : "unknown" });
    redirect("/login?error=invalid");
  }
  const session = await getSession();
  redirect(session ? homeFor(session.role) : "/login?error=invalid");
}

export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
