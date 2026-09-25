import { describe, it, expect } from "vitest";
import { buildCsp, SECURITY_HEADERS } from "./csp";
import { assertSameOrigin } from "./origin";
import { AppError } from "../http/errors";

describe("buildCsp", () => {
  it("builds a strict CSP with nonce and strict-dynamic in production", () => {
    const nonce = "test-nonce-12345";
    const csp = buildCsp(nonce, false);

    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("'unsafe-eval'");

    // Required audio and observability hosts
    expect(csp).toContain("wss://stt-rt.soniox.com");
    expect(csp).toContain("https://tts-rt.soniox.com");
    expect(csp).toContain("wss://tts-rt.soniox.com");
    expect(csp).toContain("https://*.ingest.sentry.io");
  });

  it("includes unsafe-eval and omits upgrade-insecure-requests in development", () => {
    const nonce = "dev-nonce-abcde";
    const csp = buildCsp(nonce, true);

    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("builds CSP without nonce when none is supplied", () => {
    const csp = buildCsp(undefined, false);

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'nonce-");
    expect(csp).not.toContain("'strict-dynamic'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
});

describe("SECURITY_HEADERS", () => {
  it("defines standard security headers", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toBe(
      "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
    );
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });
});

describe("assertSameOrigin", () => {
  it("allows safe read-only methods regardless of origin", () => {
    const req = new Request("http://localhost:3100/api/ping", {
      method: "GET",
      headers: {
        host: "localhost:3100",
        origin: "https://evil.com",
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("allows mutating requests when Origin matches Host", () => {
    const req = new Request("http://localhost:3100/api/sessions", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        origin: "http://localhost:3100",
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("allows mutating requests when Origin matches X-Forwarded-Host", () => {
    const req = new Request("http://internal-ip:3100/api/sessions", {
      method: "POST",
      headers: {
        host: "internal-ip:3100",
        "x-forwarded-host": "mashq.example.com",
        origin: "https://mashq.example.com",
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("rejects mutating requests when Origin is foreign", () => {
    const req = new Request("http://localhost:3100/api/sessions", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        origin: "https://evil-attacker.com",
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
    try {
      assertSameOrigin(req);
    } catch (e) {
      expect((e as AppError).status).toBe(403);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("allows mutating requests with matching Referer when Origin is missing", () => {
    const req = new Request("http://localhost:3100/api/sessions", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        referer: "http://localhost:3100/learn",
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("rejects mutating requests with foreign Referer when Origin is missing", () => {
    const req = new Request("http://localhost:3100/api/sessions", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        referer: "https://evil.com/phishing",
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
    try {
      assertSameOrigin(req);
    } catch (e) {
      expect((e as AppError).status).toBe(403);
    }
  });

  it("allows requests without Origin or Referer (non-browser API clients)", () => {
    const req = new Request("http://localhost:3100/api/sessions", {
      method: "POST",
      headers: {
        host: "localhost:3100",
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("rejects requests with malformed Origin header", () => {
    const req = new Request("http://localhost:3100/api/sessions", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        origin: "not-a-valid-url",
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
  });
});
