import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder (a parent folder may hold another lockfile).
  turbopack: { root: __dirname },
  // Let phones on the local network load the dev server (hostnames only, dev only).
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
  // Keep the dev badge away from the nav footer on the host screen.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
