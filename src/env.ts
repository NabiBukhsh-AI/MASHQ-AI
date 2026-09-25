import { z } from "zod";

// Server-side environment. Validated once at module load, so a missing required
// variable fails `pnpm build` (route modules are evaluated during page-data
// collection) and names the variable. Never import this file from client code.

const secret = z.string().min(1);

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),

  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().optional(),

  ANTHROPIC_API_KEY: secret,
  GOOGLE_GENERATIVE_AI_API_KEY: secret.optional(),
  SONIOX_API_KEY: secret.optional(),
  UPLIFT_API_KEY: secret.optional(),

  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: secret.optional(),

  SENTRY_DSN: z.url().optional(),
  LANGFUSE_PUBLIC_KEY: secret.optional(),
  LANGFUSE_SECRET_KEY: secret.optional(),
  LANGFUSE_BASEURL: z.url().default("https://cloud.langfuse.com"),

  HEALTH_TOKEN: secret.optional(),
  CRON_SECRET: secret.optional(),
  PSEUDONYM_SECRET: secret.optional(),
  SPEECH_SIGNING_SECRET: secret.optional(),
  CANARY_TOKEN: secret.optional(),
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
});

const fullSchema = serverSchema.extend(publicSchema.shape);
export type Env = z.infer<typeof fullSchema>;

/** Empty strings count as unset, so `KEY=` in an env file does not pass a min(1) check. */
function blankToUndefined(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) out[key] = value === "" ? undefined : value;
  return out;
}

export function parseEnv(
  source: Record<string, string | undefined>,
  opts: { relaxed?: boolean } = {},
): Env {
  const schema = opts.relaxed ? fullSchema.partial() : fullSchema;
  const parsed = schema.safeParse(blankToUndefined(source));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Missing or invalid environment variables:\n  ${lines.join("\n  ")}`);
  }
  return parsed.data as Env;
}

// Unit tests run without a real environment; everything else must be complete.
const relaxed = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const env: Env = parseEnv(process.env, { relaxed });

export const isProduction = env.APP_ENV === "production";
