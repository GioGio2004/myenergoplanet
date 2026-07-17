"use client";

import dynamic from "next/dynamic";

// The landing / game lobby. The island game that used to live here moved to
// /energoplanet — its page is app/[locale]/energoplanet/page.tsx.
const Landing = dynamic(() => import("@/components/landing/Landing"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100dvh",
        background: "#f2f7f0",
        color: "#1b5e3b",
        fontFamily: "var(--font-geist-sans, system-ui), sans-serif",
        fontSize: 13,
        letterSpacing: "0.3em",
        fontWeight: 700,
      }}
    >
      ENERGOLAB
    </div>
  ),
});

export default function Home() {
  return <Landing />;
}
