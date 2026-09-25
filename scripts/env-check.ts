#!/usr/bin/env tsx
// Validates the environment with the same Zod schema the app uses (src/env.ts).
// Usage: pnpm env:check   (loads the local env file if present)

async function main() {
  const { parseEnv } = await import("../src/env");
  parseEnv(process.env as Record<string, string | undefined>);
  console.log("Environment check passed.");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

export {};
