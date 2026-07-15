import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EnerGo Planet — Georgia's Energy Future",
    short_name: "EnerGo Planet",
    description:
      "An isometric strategy game teaching young Georgians about renewable energy and the real energy challenges facing their country.",
    start_url: "/",
    display: "standalone",
    // Lock mobile devices to landscape on install — no screen rotation needed
    orientation: "landscape",
    background_color: "#080c12",
    theme_color: "#f97316",
    categories: ["games", "education"],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
