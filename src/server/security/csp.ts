/**
 * Content Security Policy (CSP) and defense-in-depth security headers.
 * Follows OWASP header guidance and Next.js 16 conventions.
 */

export interface CspOptions {
  nonce?: string;
  isDev?: boolean;
}

/**
 * Builds a strict Content-Security-Policy header string.
 * Nonce-based in production with strict-dynamic.
 * In development, adds unsafe-eval for Turbopack/HMR and React error stack reconstruction.
 */
export function buildCsp(nonce?: string, isDev?: boolean): string {
  const scriptSrcDirectives: string[] = ["'self'"];
  if (nonce) {
    scriptSrcDirectives.push(`'nonce-${nonce}'`);
    scriptSrcDirectives.push("'strict-dynamic'");
  }
  if (isDev) {
    scriptSrcDirectives.push("'unsafe-eval'");
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrcDirectives,
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      "wss://stt-rt.soniox.com",
      "https://tts-rt.soniox.com",
      "wss://tts-rt.soniox.com",
      "https://*.ingest.sentry.io",
    ],
    "worker-src": ["'self'", "blob:"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };

  const parts: string[] = Object.entries(directives).map(
    ([directive, values]) => `${directive} ${values.join(" ")}`,
  );

  if (!isDev) {
    parts.push("upgrade-insecure-requests");
  }

  return parts.join("; ").trim();
}

/**
 * Standard HTTP security headers.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};
