"use client";

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";

const View3D = dynamic(() => import("@/components/View3D"), {
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
      LOADING…
    </div>
  ),
});

// ─── Start Screen ─────────────────────────────────────────────────────────────
function StartScreen({ onStart }: { onStart: (gyro: boolean) => void }) {
  const [requesting, setRequesting] = useState(false);

  const handleTap = useCallback(async () => {
    setRequesting(true);

    // iOS 13+ requires an explicit user-gesture permission prompt for
    // DeviceOrientationEvent. On Android / desktop the API is available
    // without a prompt so we fall straight through to startGame().
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (DeviceOrientationEvent as any).requestPermission === "function"
    ) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (DeviceOrientationEvent as any).requestPermission();
        onStart(response === "granted");
      } catch {
        // User dismissed or permission denied — start without gyro
        onStart(false);
      }
    } else {
      // Non-iOS or older Android — gyro events are available without a prompt
      onStart(true);
    }
  }, [onStart]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at 50% 60%, #0f1e2e 0%, #080c12 70%)",
        zIndex: 100,
        gap: 32,
      }}
    >
      {/* Ambient glow orb */}
      <div
        style={{
          position: "absolute",
          width: 320,
          height: 320,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(249,115,22,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Logo */}
      <div style={{ textAlign: "center", position: "relative" }}>
        <div
          style={{
            fontFamily: "var(--font-hud)",
            fontSize: "clamp(28px, 7vw, 48px)",
            fontWeight: 900,
            letterSpacing: "0.25em",
            color: "var(--color-accent)",
            textShadow: "0 0 24px rgba(249,115,22,0.7), 0 0 48px rgba(249,115,22,0.3)",
          }}
        >
          ENERGO<span style={{ color: "var(--color-text)" }}>PLANET</span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-game)",
            fontSize: "clamp(11px, 2.5vw, 14px)",
            color: "var(--color-text-muted)",
            letterSpacing: "0.3em",
            marginTop: 6,
          }}
        >
          GEORGIA · ENERGY FUTURE
        </div>
      </div>

      {/* Decorative rule */}
      <div
        style={{
          width: "min(280px, 60vw)",
          height: 1,
          background:
            "linear-gradient(90deg, transparent, var(--color-accent), transparent)",
          opacity: 0.5,
        }}
      />

      {/* CTA button */}
      <button
        id="start-game-btn"
        onClick={handleTap}
        disabled={requesting}
        style={{
          position: "relative",
          padding: "16px 40px",
          border: "1.5px solid var(--color-accent)",
          borderRadius: 8,
          background: "rgba(249, 115, 22, 0.08)",
          color: requesting ? "var(--color-text-muted)" : "var(--color-accent)",
          fontFamily: "var(--font-hud)",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.2em",
          cursor: requesting ? "default" : "pointer",
          transition: "background 0.2s, box-shadow 0.2s, transform 0.15s",
          boxShadow: requesting ? "none" : "var(--glow-sm)",
          WebkitTapHighlightColor: "transparent",
        }}
        onPointerEnter={(e) => {
          if (!requesting)
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(249,115,22,0.18)";
        }}
        onPointerLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(249,115,22,0.08)";
        }}
      >
        {requesting ? "REQUESTING SENSORS…" : "TAP TO START"}
      </button>

      {/* Hint */}
      <div
        style={{
          fontFamily: "var(--font-game)",
          fontSize: 11,
          color: "var(--color-text-muted)",
          letterSpacing: "0.12em",
          textAlign: "center",
          maxWidth: 260,
          lineHeight: 1.6,
        }}
      >
        Tilt your device for an immersive<br />gyroscope camera effect
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [gameStarted, setGameStarted] = useState(false);
  const [gyroEnabled, setGyroEnabled] = useState(false);

  const handleStart = useCallback((gyro: boolean) => {
    setGyroEnabled(gyro);
    setGameStarted(true);
  }, []);

  return (
    <main
      style={{
        position: "relative",
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        backgroundColor: "#080c12",
      }}
    >
      {/* 3D world is always mounted so assets preload behind the start screen */}
      <View3D gyroEnabled={gyroEnabled} gameStarted={gameStarted} />

      {/* Overlay fades away once the user taps start */}
      {!gameStarted && <StartScreen onStart={handleStart} />}
    </main>
  );
}
