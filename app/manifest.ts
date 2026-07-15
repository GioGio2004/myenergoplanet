import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EnerGo Planet — Georgia's Energy Future",
    short_name: "EnerGo Planet",
    description:
      "An isometric strategy game teaching young Georgians about renewable energy and the real energy challenges facing their country.",
    // start_url stays at "/" — the middleware rewrites it to /en transparently
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Lock mobile devices to landscape on install — no screen rotation needed
    orientation: "landscape",
    background_color: "#080c12",
    theme_color: "#f97316",
    categories: ["games", "education"],
    icons: [
      {
        src: "/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        src: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
