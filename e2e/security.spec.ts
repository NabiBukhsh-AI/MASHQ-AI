import { expect } from "@playwright/test";
import { admin, adminTest, learner, manager, managerTest, test } from "./helpers/session-mock";

/**
 * The authorization and web security sweep.
 *
 * These are the checks that a role boundary is enforced by the server rather than by a hidden
 * link, that one learner cannot read another's work, and that the headers and cookie flags a
 * browser relies on are actually set. Everything here goes through the real routes.
 */

test.describe("Security: learner boundaries @security", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("a learner cannot reach any manager or admin route", async ({ page }) => {
    const forbidden = [
      "/api/analytics/summary",
      "/api/analytics/masteryMatrix",
      "/api/analytics/system",
      "/api/export/masteryMatrix",
      "/api/admin/config",
      "/api/admin/audit",
    ];
    for (const path of forbidden) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} should be forbidden for a learner`).toBe(403);
    }
  });

  test("a learner cannot write settings or reset the demo", async ({ page }) => {
    const patch = await page.request.patch("/api/admin/config", {
      data: { patch: { grounding: { strictness: "assisted" } }, reason: "x" },
    });
    expect(patch.status()).toBe(403);

    const reset = await page.request.post("/api/admin/demo/reset", {
      data: { keepUploadedContent: true, reseed: false },
    });
    expect(reset.status()).toBe(403);
  });

  test("a session that belongs to someone else is not readable", async ({ page }) => {
    // A well formed id that is not this learner's: the route must not distinguish between
    // "does not exist" and "belongs to another learner".
    const res = await page.request.get("/api/sessions/00000000-0000-4000-8000-000000000001");
    expect([403, 404]).toContain(res.status());
  });

  test("the progress route takes no identity from the caller", async ({ page }) => {
    const mine = await page.request.get("/api/progress");
    expect(mine.status()).toBe(200);

    // Passing somebody else's identity changes nothing, because the server ignores it.
    const spoofed = await page.request.get("/api/progress?userId=someone-else&orgId=another-org");
    expect(spoofed.status()).toBe(200);
    expect(await spoofed.text()).toBe(await mine.text());
  });

  test("an unauthenticated caller gets 401, not data", async ({ browser }) => {
    const anon = await browser.newContext({ storageState: undefined });
    const page = await anon.newPage();
    for (const path of ["/api/progress", "/api/analytics/summary", "/api/admin/config"]) {
      const res = await page.request.get(path);
      expect([401, 403], `${path} for an anonymous caller`).toContain(res.status());
    }
    await anon.close();
  });
});

managerTest.describe("Security: manager boundaries @security", () => {
  managerTest.skip(!manager.email, "DEMO_MANAGER_EMAIL not set");

  managerTest("a manager reads analytics but not admin routes", async ({ page }) => {
    expect((await page.request.get("/api/analytics/summary")).status()).toBe(200);
    expect((await page.request.get("/api/admin/config")).status()).toBe(403);
    expect((await page.request.get("/api/analytics/system")).status()).toBe(403);
  });

  managerTest("analytics ignore an org supplied in the query string", async ({ page }) => {
    const own = await page.request.get("/api/analytics/summary");
    const spoofed = await page.request.get(
      "/api/analytics/summary?orgId=00000000-0000-4000-8000-000000000009",
    );
    expect(spoofed.status()).toBe(200);
    // Same org either way: the filters narrow, they never widen.
    const a = (await own.json()) as { data: unknown };
    const b = (await spoofed.json()) as { data: unknown };
    expect(JSON.stringify(b.data)).toBe(JSON.stringify(a.data));
  });

  managerTest("a bad filter is refused rather than silently ignored", async ({ page }) => {
    const res = await page.request.get("/api/analytics/summary?languages=klingon");
    expect(res.status()).toBe(400);
  });

  managerTest("an unknown widget is 404, not an empty success", async ({ page }) => {
    expect((await page.request.get("/api/analytics/allSecrets")).status()).toBe(404);
  });
});

adminTest.describe("Security: headers, cookies and CSRF @security", () => {
  adminTest.skip(!admin.email, "DEMO_ADMIN_EMAIL not set");

  adminTest("responses carry the security headers a browser relies on", async ({ page }) => {
    const res = await page.request.get("/admin");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["content-security-policy"] ?? h["content-security-policy-report-only"]).toBeTruthy();
  });

  adminTest("the session cookie is httpOnly and sameSite", async ({ page }) => {
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => /session|auth/i.test(c.name));
    expect(session, "a session cookie should exist after signing in").toBeTruthy();
    // A cookie readable from script is one XSS away from an account takeover.
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).not.toBe("None");
  });

  adminTest("a write from another origin is refused", async ({ page }) => {
    const res = await page.request.patch("/api/admin/config", {
      headers: { Origin: "https://attacker.test" },
      data: { patch: { grounding: { strictness: "assisted" } }, reason: "csrf attempt" },
    });
    expect([400, 403]).toContain(res.status());
  });

  adminTest("a CSV export cannot be rendered as a page", async ({ page }) => {
    const res = await page.request.get("/api/export/personas");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  adminTest("a rollback to a version that does not exist is refused", async ({ page }) => {
    const res = await page.request.post("/api/admin/config/rollback", {
      data: { toVersion: 99999 },
    });
    expect([400, 404]).toContain(res.status());
  });

  adminTest("settings input is validated, so a bad value cannot be stored", async ({ page }) => {
    const res = await page.request.patch("/api/admin/config", {
      data: { config: { grounding: { strictness: "whatever" } }, reason: "invalid" },
    });
    expect(res.status()).toBe(400);
  });
});
