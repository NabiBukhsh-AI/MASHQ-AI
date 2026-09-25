import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Server tests that need real credentials (the schema test needs DATABASE_URL)
// read the local env file; without it they skip. Never commit that file.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no local env file (CI)
}
// Live tests key off LIVE_DB. Without a real database, unit tests still import the db client
// and sign speech, so they get throwaway values that never reach a real service.
process.env.LIVE_DB = process.env.DATABASE_URL ? "1" : "";
process.env.DATABASE_URL ||= "postgres://test:test@localhost/test";
process.env.SPEECH_SIGNING_SECRET ||= "test-only-speech-signing-secret-not-for-production";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e"],
    globals: true,
    // Live Neon tests share one cold database under parallel load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.*", "src/**/*.d.ts"],
    },
  },
});
