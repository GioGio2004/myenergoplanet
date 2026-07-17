"use client";

import dynamic from "next/dynamic";

// BLACKOUT pre-game lobby: loadout, friends, 1v1 challenges (Convex-reactive).
const Lobby = dynamic(() => import("@/components/lobby/Lobby"), {
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
      ENTERING LOBBY…
    </div>
  ),
});

export default function LobbyPage() {
  return <Lobby />;
}
