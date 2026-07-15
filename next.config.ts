import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  // Source SW file (compiled by Next.js / Serwist at build time)
  swSrc: "app/sw.ts",
  // Output location — must be in /public so the browser can fetch it at root scope
  swDest: "public/sw.js",
  // Disable SW in development to avoid caching stale hot-reload content
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // Silence the Turbopack/webpack conflict warning introduced by @serwist/next.
  // Next.js 16 uses Turbopack by default; declaring an empty turbopack block
  // tells it we are intentionally running in Turbopack mode.
  turbopack: {},
};

export default withSerwist(nextConfig);
