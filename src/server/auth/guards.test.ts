import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("./auth", () => ({ auth: { api: { getSession } } }));
vi.mock("../obs/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { homeFor, requireRole, resolveSession } from "./guards";
import { AppError } from "../http/errors";

const req = () =>
  new Request("http://localhost/x", { headers: { cookie: "better-auth.session_token=abc" } });
const user = (over: Record<string, unknown> = {}) => ({
  user: {
    id: "u1",
    name: "Demo",
    email: "d@x.demo",
    orgId: "org1",
    role: "learner",
    pseudonym: "L-ABC234",
    ...over,
  },
  session: { id: "s1" },
});

describe("resolveSession", () => {
  beforeEach(() => getSession.mockReset());

  it("returns null when Better Auth has no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await resolveSession(req())).toBeNull();
    expect(getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
  });

  it("maps a Better Auth session to the app session", async () => {
    getSession.mockResolvedValue(user());
    expect(await resolveSession(req())).toEqual({
      userId: "u1",
      orgId: "org1",
      role: "learner",
      pseudonym: "L-ABC234",
      name: "Demo",
      email: "d@x.demo",
    });
  });

  it("treats a user without an organization or with an unknown role as signed out", async () => {
    getSession.mockResolvedValue(user({ orgId: null }));
    expect(await resolveSession(req())).toBeNull();
    getSession.mockResolvedValue(user({ role: "superuser" }));
    expect(await resolveSession(req())).toBeNull();
  });
});

describe("requireRole and homeFor", () => {
  const s = { userId: "u", orgId: "o", role: "learner" as const, name: "n", email: "e" };
  it("throws a 403 AppError for a disallowed role", () => {
    expect(() => requireRole(s, "admin", "ld_manager")).toThrowError(AppError);
    expect(requireRole(s, "learner")).toBe(s);
  });
  it("sends each role to its area", () => {
    expect(homeFor("admin")).toBe("/admin");
    expect(homeFor("ld_manager")).toBe("/manage");
    expect(homeFor("learner")).toBe("/learn");
  });
});
