import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Import every route module and assert each HTTP export carries withHandler guard
// metadata with an explicit auth mode. Heavy modules are stubbed: this test is
// about the wrapper, not the database or the auth provider.
vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: {}, handler: async () => new Response() } }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: async () => new Response(), POST: async () => new Response() }),
  nextCookies: () => ({}),
}));

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const apiDir = path.join(process.cwd(), "src/app/api");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

const routes = walk(apiDir).map(
  (f) =>
    "@/" + path.relative(path.join(process.cwd(), "src"), f).split(path.sep).join("/").slice(0, -3),
);

describe("route manifest", () => {
  it("finds the API routes", () => {
    expect(routes.length).toBeGreaterThan(3);
  });

  it.each(routes)(
    "%s declares an auth guard on every method",
    async (modulePath) => {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
      const exported = METHODS.filter((m) => m in mod);
      expect(exported.length, "no HTTP method exported").toBeGreaterThan(0);
      for (const m of exported) {
        const guard = (mod[m] as { guard?: { auth?: string } }).guard;
        expect(guard?.auth, `${m} is not wrapped with withHandler`).toMatch(
          /^(public|session|cron|health)$/,
        );
      }
    },
    // The first route import compiles the whole server graph; slow under a full parallel run.
    90_000,
  );
});
