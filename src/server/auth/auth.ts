import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import crypto from "node:crypto";
import { env } from "@/env";
import { pseudonymFor } from "./pseudonym";
import { db } from "../db/client";
import * as schema from "../db/schema";

/**
 * Better Auth with database sessions and email + password only.
 * Sign-up is disabled for the app instance; the seed script builds its own
 * instance with `allowSignUp: true` to create the demo accounts.
 * Extra user fields (org, role, pseudonym) are never client-settable.
 */
export function createAuth(opts: { allowSignUp?: boolean } = {}) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, disableSignUp: !opts.allowSignUp },
    user: {
      additionalFields: {
        orgId: { type: "string", required: false, input: false },
        role: { type: "string", required: false, input: false, defaultValue: "learner" },
        department: { type: "string", required: false, input: false },
        cohort: { type: "string", required: false, input: false },
        personaId: { type: "string", required: false, input: false },
        pseudonym: { type: "string", required: false, input: false },
        isSeeded: { type: "boolean", required: false, input: false, defaultValue: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Without this a real learner has a null pseudonym, and the manager dashboard,
          // which identifies learners only by pseudonym, would collapse them all into one
          // blank row. It is set here so it exists before any analytics row references it.
          before: async (u: Record<string, unknown>) => ({
            data: { ...u, pseudonym: pseudonymFor(String(u.id ?? crypto.randomUUID())) },
          }),
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, path: "/" },
    },
    plugins: [nextCookies()],
  });
}

export const auth = createAuth();
export type Auth = typeof auth;
