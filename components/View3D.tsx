"use client";

import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { Hero } from "@/components/Hero";
import { Terrain } from "@/components/Terrain";
import { House } from "@/components/House";
import { useEffect, useState, useRef, Suspense } from "react";
import { PCFShadowMap } from "three";

// ─── Lighting Rig ─────────────────────────────────────────────────────────────
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.5} color="#c8d4e8" />
      <directionalLight
        position={[15, 25, 10]}
        intensity={1.8}
        color="#fff8ef"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.001}
      />
    </>
  );
}

// ─── Suppress THREE.Clock deprecation warning ──────────────────────────────────
function useSuppressClockWarning() {
  useEffect(() => {
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      if (
        typeof args[0] === "string" &&
        args[0].includes("THREE.Clock: This module has been deprecated")
      )
        return;
      orig.apply(console, args);
    };
    return () => {
      console.warn = orig;
    };
  }, []);
}

// ─── Detect mobile (touch-primary device) ─────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () =>
      setIsMobile(
        window.matchMedia("(pointer: coarse)").matches ||
          "ontouchstart" in window,
      );
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// ─── Detect landscape orientation on mobile ───────────────────────────────────
// Returns true only when a coarse-pointer (touch) device is held horizontally.
// We combine pointer-coarse with an orientation/aspect check so it doesn't
// fire on wide desktop monitors.
function useIsLandscapeMobile() {
  const [isLandscapeMobile, setIsLandscapeMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      const isTouch =
        window.matchMedia("(pointer: coarse)").matches ||
        "ontouchstart" in window;
      const isLandscape = window.innerWidth > window.innerHeight;
      setIsLandscapeMobile(isTouch && isLandscape);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  return isLandscapeMobile;
}

// ─── Analog Virtual Joystick ──────────────────────────────────────────────────
function Joystick({
  onChange,
  onEnd,
}: {
  onChange: (x: number, z: number) => void;
  onEnd: () => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handlePointerMove(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !baseRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;

    const distance = Math.hypot(dx, dy);
    const maxRadius = rect.width / 2 - 25; // 25 is half the knob width

    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }

    setKnobPos({ x: dx, y: dy });

    // Normalize to [-1, 1] for movement — never saturate to full 1.0
    // so joystick always reads as walk (not sprint)
    const normX = dx / maxRadius;
    const normY = dy / maxRadius; // maps to Z in 3D
    onChange(normX, normY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setKnobPos({ x: 0, y: 0 });
    onEnd();
  };

  return (
    <div
      ref={baseRef}
      style={{
        width: 140,
        height: 140,
        borderRadius: "50%",
        background: "rgba(15, 22, 35, 0.6)",
        border: "2px solid var(--color-border)",
        position: "relative",
        touchAction: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 50,
          height: 50,
          borderRadius: "50%",
          background: "var(--color-accent)",
          boxShadow: "var(--glow-sm)",
          transform: `translate(calc(-50% + ${knobPos.x}px), calc(-50% + ${knobPos.y}px))`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────
export default function View3D({
  gyroEnabled = false,
  gameStarted = false,
}: {
  gyroEnabled?: boolean;
  gameStarted?: boolean;
}) {
  useSuppressClockWarning();

  // ── Background Music ───────────────────────────────────────────────────────
  // Start looping bg music the moment the user taps "TAP TO START".
  // Browsers block autoplay until a user gesture fires — gameStarted becoming
  // true is always triggered by a click, so this is safe on iOS/Android.
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!gameStarted) return; // wait for user gesture

    const audio = new Audio("/gameassets/game-sounds/bgguitarmusic.mp3");
    audio.loop = true;
    audio.volume = 0.3;
    bgMusicRef.current = audio;
    audio.play().catch(() => {
      // Fallback: if play was still blocked, retry on next user interaction
      const retry = () => {
        audio.play().catch(() => {});
        window.removeEventListener("pointerdown", retry);
        window.removeEventListener("keydown", retry);
      };
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    });

    return () => {
      audio.pause();
      audio.src = "";
      bgMusicRef.current = null;
    };
  }, [gameStarted]);

  const [energy] = useState(42);
  const mobileDirRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const isMobile = useIsMobile();
  const isLandscapeMobile = useIsLandscapeMobile();

  // Narrow FOV on mobile landscape so the character fills ~2× more screen.
  // tan(30°)/tan(17°) ≈ 1.9 — nearly double the apparent size.
  // Portrait mobile and desktop keep the standard 60° wide-angle feel.
  const cameraFov = isLandscapeMobile ? 34 : 60;

  const handleJoystickChange = (x: number, z: number) => {
    mobileDirRef.current = { x, z };
  };
  const handleJoystickEnd = () => {
    mobileDirRef.current = { x: 0, z: 0 };
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        // Extend the canvas into the safe-area zone so the background colour
        // fills the home-indicator / nav-bar gap instead of leaving a black bar.
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxSizing: "border-box",
      }}
    >
      {/* ── 3D Canvas ──────────────────────────────────────────────────── */}
      <Canvas
        shadows={{ type: PCFShadowMap }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        style={{ background: "#080c12" }}
      >
        {/* Start camera already behind the character — Hero.tsx will lerp from here */}
        <PerspectiveCamera
          makeDefault
          fov={cameraFov}
          near={0.1}
          far={300}
          position={[0, 5, 20]}
        />

        <Lighting />
        <Suspense fallback={null}>
          <Terrain />
          <House position={[-8, 0, -8]} rotation={[0, Math.PI / 4, 0]} />

          {/* Character Controller — Spawn outside the gate at Z=12 */}
          <Hero
            position={[0, 0, 12]}
            mobileDirRef={mobileDirRef}
            gyroEnabled={gyroEnabled}
          />
        </Suspense>
      </Canvas>

      {/* ── HUD — title badge ─────────────────────────────────────────── */}
      <div
        id="hud-title"
        className="hud-panel"
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-hud)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-accent)",
            letterSpacing: "0.15em",
          }}
        >
          ENERGO<span style={{ color: "var(--color-text)" }}>PLANET</span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-game)",
            fontSize: 11,
            color: "var(--color-text-muted)",
            marginTop: 2,
          }}
        >
          GEORGIA · REGION SELECT
        </div>
      </div>

      {/* ── HUD — energy bar ──────────────────────────────────────────── */}
      <div
        id="hud-energy"
        className="hud-panel"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          pointerEvents: "none",
          minWidth: 180,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-game)",
              fontSize: 12,
              color: "var(--color-text-muted)",
              letterSpacing: "0.08em",
            }}
          >
            ⚡ ENERGY
          </span>
          <span className="hud-badge">{energy} MW</span>
        </div>
        <div className="energy-bar-track">
          <div className="energy-bar-fill" style={{ width: `${energy}%` }} />
        </div>
        <div
          style={{
            fontFamily: "var(--font-game)",
            fontSize: 10,
            color: "var(--color-text-muted)",
            marginTop: 4,
          }}
        >
          CAPACITY · 100 MW
        </div>
      </div>

      {/* ── HUD — controls hint (desktop only) ────────────────────────── */}
      {!isMobile && (
        <div
          id="hud-controls"
          className="hud-panel"
          style={{
            position: "absolute",
            bottom: "max(16px, calc(16px + env(safe-area-inset-bottom, 0px)))",
            left: 16,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-hud)",
              fontSize: 10,
              color: "var(--color-text-muted)",
              letterSpacing: "0.1em",
            }}
          >
            WASD / ARROWS · MOVE
          </div>
          <div
            style={{
              fontFamily: "var(--font-hud)",
              fontSize: 10,
              color: "var(--color-text-muted)",
              marginTop: 2,
              letterSpacing: "0.1em",
            }}
          >
            SHIFT · SPRINT
          </div>
        </div>
      )}

      {/* ── HUD — mobile Joystick (touch screens only) ────────────────── */}
      {isMobile && (
        <div
          id="hud-joystick"
          style={{
            position: "absolute",
            bottom: "max(24px, calc(24px + env(safe-area-inset-bottom, 0px)))",
            right: "max(24px, calc(24px + env(safe-area-inset-right, 0px)))",
          }}
        >
          <Joystick onChange={handleJoystickChange} onEnd={handleJoystickEnd} />
        </div>
      )}
    </div>
  );
}
