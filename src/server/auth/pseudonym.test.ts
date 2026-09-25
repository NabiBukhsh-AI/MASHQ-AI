import { describe, it, expect } from "vitest";
import { pseudonymFor } from "./pseudonym";

describe("pseudonymFor", () => {
  it("is stable, secret-dependent and shaped L-XXXXXX", () => {
    const a = pseudonymFor("user-1", "secret-a");
    expect(a).toMatch(/^L-[A-Z2-7]{6}$/);
    expect(pseudonymFor("user-1", "secret-a")).toBe(a);
    expect(pseudonymFor("user-1", "secret-b")).not.toBe(a);
    expect(pseudonymFor("user-2", "secret-a")).not.toBe(a);
  });
});
