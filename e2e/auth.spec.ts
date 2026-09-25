import { test, expect, type Page } from "@playwright/test";

const learner = {
  email: process.env.DEMO_LEARNER_EMAIL!,
  password: process.env.DEMO_LEARNER_PASSWORD!,
};
const manager = {
  email: process.env.DEMO_MANAGER_EMAIL!,
  password: process.env.DEMO_MANAGER_PASSWORD!,
};

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("@auth", () => {
  test.skip(!learner.email, "DEMO_LEARNER_EMAIL not set");

  test("learner signs in, lands on /learn, and is kept out of /manage and /admin", async ({
    page,
  }) => {
    await signIn(page, learner);
    await expect(page).toHaveURL(/\/learn$/);
    await page.goto("/manage");
    await expect(page).toHaveURL(/\/learn$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/learn$/);
  });

  test("manager reaches /manage but not /admin", async ({ page }) => {
    await signIn(page, manager);
    await expect(page).toHaveURL(/\/manage$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/manage$/);
  });

  test("wrong password shows an error and keeps the visitor on /login", async ({ page }) => {
    await signIn(page, { email: learner.email, password: "definitely-wrong" });
    await expect(page).toHaveURL(/\/login\?error=invalid$/);
    await expect(page.locator("#login-error")).toContainText("did not match");
  });

  test("signed-out visitors are redirected to /login", async ({ page }) => {
    await page.goto("/learn");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("session cookie is HttpOnly and SameSite=Lax", async ({ page, context }) => {
    await signIn(page, learner);
    await expect(page).toHaveURL(/\/learn$/);
    const cookie = (await context.cookies()).find((c) =>
      c.name.endsWith("better-auth.session_token"),
    );
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
  });

  test("sign-up is disabled and session routes reject anonymous calls", async ({ request }) => {
    const signUp = await request.post("/api/auth/sign-up/email", {
      data: { email: "intruder@mashq.demo", password: "Password-123456", name: "Intruder" },
    });
    expect(signUp.ok()).toBe(false);
    const sessions = await request.post("/api/sessions", { data: { journeyId: "x" } });
    expect(sessions.status()).toBe(401);
    expect(sessions.headers()["x-request-id"]).toBeTruthy();
  });

  test("sign out ends the session", async ({ page }) => {
    await signIn(page, learner);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/learn");
    await expect(page).toHaveURL(/\/login$/);
  });
});
