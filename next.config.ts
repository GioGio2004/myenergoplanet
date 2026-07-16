import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// Suppress the @serwist/next Turbopack compatibility warning — Serwist is
// intentionally disabled in development and only active in production builds,
// so the warning is a false alarm. This env var is the official suppression
// mechanism documented by the Serwist project.
process.env.SERWIST_SUPPRESS_TURBOPACK_WARNING = "1";

const withSerwist = withSerwistInit({
  // Source SW file (compiled by Next.js / Serwist at build time)
  swSrc: "app/sw.ts",
  // Output location — must be in /public so the browser can fetch it at root scope
  swDest: "public/sw.js",
  // Recommended pattern: only enable the SW in production builds.
  // This is the exact wording suggested in the Serwist warning message.
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  // Next.js 16 uses Turbopack by default; declaring an empty turbopack block
  // tells it we are intentionally running in Turbopack mode.
  turbopack: {},
};

export default withSerwist(nextConfig);
