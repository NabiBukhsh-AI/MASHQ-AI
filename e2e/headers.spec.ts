import { test, expect, type Page } from "@playwright/test";

const learner = {
  email: process.env.DEMO_LEARNER_EMAIL ?? "",
  password: process.env.DEMO_LEARNER_PASSWORD ?? "",
};

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("@headers", () => {
  test.beforeEach(async () => {
    test.setTimeout(60_000);
  });

  test("login page returns full suite of security headers and CSP", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response).not.toBeNull();

    const headers = response!.headers();

    // Content Security Policy
    const csp = headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("strict-dynamic");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("stt-rt.soniox.com");
    expect(csp).toContain("ingest.sentry.io");

    // Standard defense-in-depth headers
    expect(headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  });

  test("permissions policy limits microphone to self and disables sensitive features", async ({
    page,
  }) => {
    const response = await page.goto("/login");
    expect(response).not.toBeNull();

    const permissionsPolicy = response!.headers()["permissions-policy"];
    expect(permissionsPolicy).toBeDefined();
    expect(permissionsPolicy).toContain("microphone=(self)");
    expect(permissionsPolicy).toContain("camera=()");
    expect(permissionsPolicy).toContain("geolocation=()");
    expect(permissionsPolicy).toContain("payment=()");
    expect(permissionsPolicy).toContain("usb=()");
  });

  test("API routes return defense-in-depth security headers", async ({ request }) => {
    const response = await request.get("/api/ping");
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  });

  test("no CSP violation errors are logged to the console on login or session pages", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (
        msg.type() === "error" ||
        text.toLowerCase().includes("content security policy") ||
        text.toLowerCase().includes("violates the following")
      ) {
        consoleErrors.push(text);
      }
    });

    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

    if (learner.email) {
      await signIn(page, learner);
      await expect(page).toHaveURL(/\/learn$/);
      await expect(page.locator("#main-content")).toBeVisible();
    }

    const cspErrors = consoleErrors.filter(
      (err) =>
        err.toLowerCase().includes("content security policy") ||
        err.toLowerCase().includes("csp") ||
        err.toLowerCase().includes("violates the following"),
    );

    expect(cspErrors).toEqual([]);
  });

  test("mutating POST request with foreign Origin returns 403 Forbidden", async ({ request }) => {
    const response = await request.post("/api/sessions", {
      headers: {
        Origin: "https://malicious-cross-origin-attacker.com",
        "Content-Type": "application/json",
      },
      data: {
        journeyId: "test-journey",
      },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
