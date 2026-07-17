"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { PCFSoftShadowMap } from "three";
import { Arena } from "@/components/simulation/Arena";
import { Player } from "@/components/simulation/Player";
import { Targets } from "@/components/simulation/Targets";
import { initEffects, updateEffects } from "@/components/simulation/effects";
import { useSimState } from "@/components/simulation/store";
import { TouchControls } from "@/components/simulation/TouchControls";

// Runs the imperative fire-effects system (tracers/sparks/muzzle flash).
function EffectsRunner() {
  const { scene } = useThree();
  useEffect(() => {
    initEffects(scene);
  }, [scene]);
  useFrame((_, dt) => updateEffects(dt));
  return null;
}

// ── DOM HUD pieces (read the sim store reactively) ───────────────────────────
function AmmoCounter({ raised = false }: { raised?: boolean }) {
  const { ammo, magSize, reloading } = useSimState();
  return (
    <div
      className="hud-panel"
      style={{
        position: "absolute",
        // On touch layouts the fire/jump cluster owns the bottom-right corner —
        // the ammo readout moves above it so nothing overlaps.
        bottom: raised ? 210 : 16,
        right: 16,
        minWidth: 130,
        textAlign: "right",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-hud)",
          fontSize: 24,
          fontWeight: 700,
          color: reloading ? "var(--color-text-muted)" : ammo === 0 ? "#ef4444" : "var(--color-accent)",
          letterSpacing: "0.08em",
        }}
      >
        {reloading ? "RELOADING…" : `${ammo} / ${magSize}`}
      </div>
      <div
        style={{
          fontFamily: "var(--font-game)",
          fontSize: 10,
          color: "var(--color-text-muted)",
          letterSpacing: "0.12em",
          marginTop: 2,
        }}
      >
        SCAR-H · R TO RELOAD
      </div>
    </div>
  );
}

function ScoreCounter() {
  const { score } = useSimState();
  return (
    <div
      className="hud-panel"
      style={{ position: "absolute", top: 16, right: 16, textAlign: "right" }}
    >
      <div
        style={{
          fontFamily: "var(--font-hud)",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--color-text)",
          letterSpacing: "0.1em",
        }}
      >
        ✕ {score}
      </div>
      <div
        style={{
          fontFamily: "var(--font-game)",
          fontSize: 10,
          color: "var(--color-text-muted)",
          letterSpacing: "0.12em",
        }}
      >
        TARGETS DOWN
      </div>
    </div>
  );
}

// Crosshair with a hit-marker flick (orange X) for ~120 ms after a confirmed hit.
function Crosshair() {
  const { hitAt } = useSimState();

  // The hit marker is pure CSS: re-keying the ✕ on every new hit restarts a
  // fade-out animation — no state, no timers, no re-render loops.
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
      }}
    >
      <style>{`@keyframes hitfade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }`}</style>
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          border: "1.5px solid rgba(249,115,22,0.9)",
        }}
      />
      {hitAt > 0 && (
        <div
          key={hitAt}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontFamily: "var(--font-hud)",
            fontSize: 18,
            fontWeight: 900,
            color: "#f97316",
            textShadow: "0 0 6px rgba(249,115,22,0.9)",
            opacity: 0,
            animation: "hitfade 160ms ease-out forwards",
          }}
        >
          ✕
        </div>
      )}
    </div>
  );
}

// ─── Root: canvas + pointer-lock flow + HUD ──────────────────────────────────
export default function Simulation() {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const canvasWrap = useRef<HTMLDivElement>(null);

  // Touch devices don't have pointer lock — they get virtual controls instead,
  // and "started" state replaces "locked". Safe to read window here: this
  // component is only ever loaded with ssr:false.
  const [isTouch] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window),
  );

  useEffect(() => {
    const onChange = () => {
      const isLocked = !!document.pointerLockElement;
      lockedRef.current = isLocked;
      setLocked(isLocked);
    };
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  const start = () => {
    if (isTouch) {
      // No pointer lock on touch — just flip the gate the Player checks.
      lockedRef.current = true;
      setLocked(true);
      return;
    }
    const canvas = canvasWrap.current?.querySelector("canvas");
    canvas?.requestPointerLock();
  };

  return (
    <div
      ref={canvasWrap}
      style={{ position: "relative", width: "100%", height: "100%" }}
      onClick={() => {
        if (!lockedRef.current) start();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        shadows={{ type: PCFSoftShadowMap }}
        dpr={isTouch ? [1, 1.5] : [1, 2]}
        gl={{ antialias: !isTouch, powerPreference: "high-performance" }}
        camera={{ fov: 55, near: 0.1, far: 300, position: [0, 2.2, -4] }}
        style={{ background: "#0a1420" }}
      >
        <fog attach="fog" args={["#0a1420", 55, 110]} />

        <hemisphereLight args={["#bcd3ff", "#3a4a5a", 0.95]} />
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[18, 26, 12]}
          intensity={1.6}
          color="#fff2df"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-35}
          shadow-camera-right={35}
          shadow-camera-top={35}
          shadow-camera-bottom={-35}
          shadow-bias={-0.0004}
        />

        <Suspense fallback={null}>
          <Arena />
          <Targets />
          <Player locked={lockedRef} />
        </Suspense>
        <EffectsRunner />
      </Canvas>

      {/* ── HUD ─────────────────────────────────────────────────────────── */}
      <div
        className="hud-panel"
        style={{ position: "absolute", top: 16, left: 16, pointerEvents: "none" }}
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
          ENERGO<span style={{ color: "var(--color-text)" }}>SIM</span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-game)",
            fontSize: 11,
            color: "var(--color-text-muted)",
            marginTop: 2,
          }}
        >
          TRAINING GROUND · PHASE B
        </div>
      </div>

      <ScoreCounter />

      {locked && isTouch && <TouchControls />}

      {locked && (
        <>
          {!isTouch && (
          <div
            className="hud-panel"
            style={{ position: "absolute", bottom: 16, left: 16, pointerEvents: "none" }}
          >
            <div
              style={{
                fontFamily: "var(--font-hud)",
                fontSize: 10,
                color: "var(--color-text-muted)",
                letterSpacing: "0.1em",
                lineHeight: 1.8,
              }}
            >
              WASD · MOVE&nbsp;&nbsp;LMB · FIRE&nbsp;&nbsp;RMB · AIM
              <br />
              R · RELOAD&nbsp;&nbsp;SPACE · JUMP&nbsp;&nbsp;SHIFT · SPRINT&nbsp;&nbsp;ESC · MOUSE
            </div>
          </div>
          )}
          <Crosshair />
          <AmmoCounter raised={isTouch} />
        </>
      )}

      {/* ── Click-to-play overlay ──────────────────────────────────────── */}
      {!locked && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            background: "rgba(8, 12, 18, 0.55)",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-hud)",
              fontSize: "clamp(20px, 4vw, 32px)",
              fontWeight: 900,
              letterSpacing: "0.25em",
              color: "var(--color-accent)",
              textShadow: "0 0 24px rgba(249,115,22,0.6)",
            }}
          >
            TRAINING GROUND
          </div>
          <div
            style={{
              fontFamily: "var(--font-game)",
              fontSize: 13,
              color: "var(--color-text)",
              letterSpacing: "0.2em",
              border: "1.5px solid var(--color-accent)",
              borderRadius: 8,
              padding: "12px 28px",
              background: "rgba(249,115,22,0.08)",
              boxShadow: "var(--glow-sm)",
            }}
          >
            {isTouch ? "TAP TO START" : "CLICK TO ENTER"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-game)",
              fontSize: 11,
              color: "var(--color-text-muted)",
              letterSpacing: "0.12em",
            }}
          >
            {isTouch
              ? "left stick move · drag right side to look · FIRE button shoots"
              : "WASD move · LMB fire · RMB aim · R reload · Space jump"}
          </div>
        </div>
      )}
    </div>
  );
}
