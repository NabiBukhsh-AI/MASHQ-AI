import { errors } from "../http/errors";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Asserts that mutating requests originate from the same origin.
 * Protects route handlers against Cross-Site Request Forgery (CSRF).
 * Throws 403 Forbidden if a foreign Origin or Referer header is detected.
 */
export function assertSameOrigin(req: Request): void {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    return;
  }

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  // If neither Origin nor Referer is present (e.g. non-browser API client), allow request
  if (!origin && !referer) {
    return;
  }

  const expectedHost =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    new URL(req.url).host;

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost.toLowerCase() !== expectedHost.toLowerCase()) {
        throw errors.forbidden("Cross-origin request rejected.");
      }
      return;
    } catch (e) {
      if (e instanceof Error && "code" in e && (e as { code: string }).code === "FORBIDDEN") {
        throw e;
      }
      throw errors.forbidden("Invalid origin header.");
    }
  }

  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost.toLowerCase() !== expectedHost.toLowerCase()) {
        throw errors.forbidden("Cross-origin request rejected.");
      }
      return;
    } catch (e) {
      if (e instanceof Error && "code" in e && (e as { code: string }).code === "FORBIDDEN") {
        throw e;
      }
      throw errors.forbidden("Invalid referer header.");
    }
  }
}
