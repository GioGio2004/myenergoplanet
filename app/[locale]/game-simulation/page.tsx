"use client";

import dynamic from "next/dynamic";

// NOTE: this route lives under app/[locale]/ on purpose — proxy.ts rewrites
// every top-level path to /<locale>/..., so a route outside [locale] would be
// unreachable. URL in the browser: /game-simulation
const Simulation = dynamic(() => import("@/components/simulation/Simulation"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-hud)",
        fontSize: 13,
        letterSpacing: "0.15em",
      }}
    >
      LOADING TRAINING GROUND…
    </div>
  ),
});

export default function GameSimulationPage() {
  return (
    <main
      style={{
        position: "relative",
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        backgroundColor: "#0a1420",
      }}
    >
      <Simulation />
    </main>
  );
}
