import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Opt into the experimental Turbopack bundler during development.
  // Falls back to Webpack for production builds.
  // reactCompiler: true is not enabled yet (wait for stable).

  // Outputs: standalone is useful when deploying outside Vercel,
  // but Vercel auto-detects and does not need it.

  poweredByHeader: false,

  // Strict React mode catches common bugs during development.
  reactStrictMode: true,

  // Vercel Hobby allows up to 300 s function execution.
  // Individual routes set `export const maxDuration = ...` as needed.
  // Kept out of the server bundle because they resolve files or workers at runtime: unpdf
  // ships pdf.js with its own worker, and mammoth reads its style map from disk.
  //
  // Only add a package here if it can be require()d. Next loads an external package with a
  // CommonJS require, so listing an ESM only package swaps a bundling problem for an
  // ERR_REQUIRE_ESM one at function init. That is exactly what happened with jsdom, whose
  // html-encoding-sniffer requires the ESM only @exodus/bytes: POST /api/content returned an
  // empty 500 on Vercel before the handler ran, even to an unauthenticated caller who was
  // owed a 401. jsdom is gone from the server path now; linkedom replaces it and is ESM only,
  // so it must stay bundled. unpdf is dual format and mammoth is CommonJS, so both are safe.
  serverExternalPackages: ["unpdf", "mammoth"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

import { withAxiom } from "next-axiom";

export default withAxiom(nextConfig);
