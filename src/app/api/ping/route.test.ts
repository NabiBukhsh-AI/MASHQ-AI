import { describe, it, expect } from "vitest";

/**
 * Validates that the ping route module does not import
 * anything from src/server/db or src/server/llm.
 *
 * This is a static import check: we read the source and assert
 * no disallowed imports appear.
 */
describe("GET /api/ping", () => {
  it("responds with { ok: true }", async () => {
    // Dynamic import of the route module
    const mod = await import("@/app/api/ping/route");
    const req = new Request("http://localhost/api/ping");
    const response = await mod.GET(req, {});
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(response.status).toBe(200);
  });

  it("does not import from src/server/db or src/server/llm", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routePath = path.join(process.cwd(), "src", "app", "api", "ping", "route.ts");
    const source = fs.readFileSync(routePath, "utf-8");
    expect(source).not.toMatch(/^import\b.*from\s+["'].*server\/db/m);
    expect(source).not.toMatch(/^import\b.*from\s+["'].*server\/llm/m);
  });
});
