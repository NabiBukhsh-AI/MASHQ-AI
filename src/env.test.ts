import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

const complete = {
  DATABASE_URL: "postgres://user:pw@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  ANTHROPIC_API_KEY: "sk-test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const env = parseEnv(complete);
    expect(env.APP_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.LANGFUSE_BASEURL).toBe("https://cloud.langfuse.com");
  });

  it("names every missing required variable", () => {
    const { DATABASE_URL: _d, ANTHROPIC_API_KEY: _a, ...partial } = complete;
    expect(() => parseEnv(partial)).toThrowError(/DATABASE_URL/);
    expect(() => parseEnv(partial)).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it("treats an empty string as unset", () => {
    expect(() => parseEnv({ ...complete, DATABASE_URL: "" })).toThrowError(/DATABASE_URL/);
    expect(parseEnv({ ...complete, SENTRY_DSN: "" }).SENTRY_DSN).toBeUndefined();
  });

  it("rejects a short auth secret and a malformed URL", () => {
    expect(() => parseEnv({ ...complete, BETTER_AUTH_SECRET: "short" })).toThrowError(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => parseEnv({ ...complete, NEXT_PUBLIC_APP_URL: "not a url" })).toThrowError(
      /NEXT_PUBLIC_APP_URL/,
    );
  });

  it("relaxed mode only skips presence checks", () => {
    expect(parseEnv({}, { relaxed: true }).DATABASE_URL).toBeUndefined();
    expect(() => parseEnv({ DATABASE_URL: "nope" }, { relaxed: true })).toThrowError(
      /DATABASE_URL/,
    );
  });
});
