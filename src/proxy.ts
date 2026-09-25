import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { buildCsp, SECURITY_HEADERS } from "./server/security/csp";

// Coarse redirect only: send signed-out visitors of app areas to /login based on
// cookie presence. Not an auth boundary; every layout and route checks the session.
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];
const PROTECTED_PREFIXES = ["/learn", "/manage", "/admin", "/library"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const hasCookie = SESSION_COOKIES.some((c) => request.cookies.has(c));

  if (isProtected && !hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      redirectResponse.headers.set(header, value);
    }
    return redirectResponse;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const cspHeader = buildCsp(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", cspHeader);
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value);
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
