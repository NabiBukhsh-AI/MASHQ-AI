import { defineConfig, devices } from "@playwright/test";

// Specs that sign in read the demo credentials from the local env file.
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides them as secrets
}

const production = process.env.EVAL_BASE_URL
  ? [
      {
        name: "production",
        use: { ...devices["Desktop Chrome"], baseURL: process.env.EVAL_BASE_URL },
      },
    ]
  : [];

export default defineConfig({
  testDir: "./e2e",
  // Dot directories under e2e are scratch (review agents drop screenshots and throwaway specs
  // there, and .gitignore already excludes them). They are not the suite.
  testIgnore: "**/.*/**",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker: the dev server compiles routes on first hit and parallel cold hits time out.
  workers: 1,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, ...production],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        port: 3100,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
