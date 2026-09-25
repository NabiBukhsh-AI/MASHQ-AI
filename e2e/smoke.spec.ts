import { test, expect } from "@playwright/test";

test("GET /api/ping returns ok", async ({ request }) => {
  const response = await request.get("/api/ping");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ ok: true });
});
