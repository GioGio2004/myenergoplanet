"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import { useSettings } from "@/lib/settings";
import { PLAYER_STYLES, gameConfig } from "./config";
import { GameProvider, makeGameSettings, useGame, type GameContextValue } from "./hooks";
import { GameRuntime } from "./runtime";
import type { InputSource, PlayerSetup } from "./types";
import { createMatch } from "./sim/match";
import { createInputSource } from "./input";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { Wrestlers } from "./visual/wrestlers/Wrestlers";
import { Island } from "./visual/island/Island";
import { Backdrop } from "./visual/backdrop/Backdrop";
import { Lights } from "./visual/backdrop/Lights";
import { Splashes } from "./visual/fx/Splashes";
import { PostFx } from "./visual/PostFx";
import { CameraDirector } from "./camera/CameraDirector";
import { Hud } from "./hud/Hud";

/** Two players on one keyboard until phones are connected. */
const DEFAULT_SETUPS: PlayerSetup[] = [
  { slot: 0, name: PLAYER_STYLES[0].label, control: "keyboardA" },
  { slot: 1, name: PLAYER_STYLES[1].label, control: "keyboardB" },
];

const DPR_STEP = 0.25;

/**
 * The whole game on the host screen: one runtime, the 3D scene and the HUD on top.
 * Heavy (three.js + Rapier): load it with `next/dynamic` and `ssr: false`.
 */
export type GameScreenProps = {
  /** Leave the game screen. */
  onExit: () => void;
  /**
   * A fixed roster (e.g. the players of an online room). When given, the local lobby
   * is hidden and these players are used instead of the keyboard/bot setup.
   */
  roster?: PlayerSetup[] | null;
  /** Extra UI rendered inside the game context, on top of the HUD. */
  overlay?: ReactNode;
  /**
   * Builds the input source for a player. Return undefined to use the default for the
   * player's `control` (keyboard / bot). Must be a stable function (useCallback).
   */
  inputFactory?: (setup: PlayerSetup) => InputSource | null | undefined;
};

export default function GameScreen({
  onExit,
  roster = null,
  overlay,
  inputFactory,
}: GameScreenProps) {
  const [game] = useState(() => {
    const runtime = new GameRuntime();
    return { runtime, match: createMatch(runtime) };
  });
  const { runtime, match } = game;

  const [userSettings] = useSettings();
  const systemReducedMotion = useReducedMotion();
  const reduceMotion = userSettings.reduceMotion || systemReducedMotion === true;
  const settings = useMemo(
    () => makeGameSettings(userSettings.quality, reduceMotion),
    [userSettings.quality, reduceMotion],
  );
  const context = useMemo<GameContextValue>(
    () => ({ runtime, match, settings }),
    [runtime, match, settings],
  );

  // ── players and their input sources ──────────────────────────────────────
  const [localSetups, setLocalSetups] = useState<PlayerSetup[]>(DEFAULT_SETUPS);
  const setups = roster ?? localSetups;

  useEffect(() => {
    // The roster can only change in the lobby; a match keeps the players it started with.
    if (runtime.phase !== "lobby") return;
    runtime.setPlayers(setups);
    for (let slot = 0; slot < runtime.inputs.length; slot++) {
      const setup = setups.find((s) => s.slot === slot);
      const source = setup ? (inputFactory?.(setup) ?? createInputSource(setup.control)) : null;
      runtime.setInput(slot, source);
    }
  }, [runtime, setups, inputFactory]);

  // Input sources hold window listeners: drop them when the screen goes away.
  useEffect(() => () => runtime.clearInputs(), [runtime]);

  // ── adaptive resolution: step the DPR cap down when the frame rate sags ──
  const maxDpr = settings.quality.maxDpr;
  const [dprDrop, setDprDrop] = useState(0);
  const dprCap = Math.max(1, maxDpr - dprDrop);

  // ── debug overlay (toggle with the ~ key) ────────────────────────────────
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Backquote") setDebug((d) => !d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink select-none">
      <Canvas
        className="absolute inset-0"
        shadows={settings.quality.shadows ? "percentage" : false}
        dpr={[1, dprCap]}
        camera={{ fov: gameConfig.camera.fov, near: 0.1, far: 400, position: [0, 14, 18] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <GameProvider value={context}>
          <PerformanceMonitor
            onDecline={() => setDprDrop((d) => Math.min(d + DPR_STEP, maxDpr - 1))}
            onIncline={() => setDprDrop((d) => Math.max(d - DPR_STEP, 0))}
            flipflops={4}
            onFallback={() => setDprDrop(maxDpr - 1)}
          />
          <Lights />
          <Backdrop />
          <Island />
          {/* Rapier's wasm initialises asynchronously; the scenery shows meanwhile. */}
          <Suspense fallback={null}>
            <PhysicsWorld debug={debug} />
          </Suspense>
          <Wrestlers />
          <Splashes />
          <CameraDirector />
          <PostFx enabled={settings.quality.postProcessing} />
        </GameProvider>
      </Canvas>

      <GameProvider value={context}>
        <Hud
          setups={setups}
          onSetupsChange={setLocalSetups}
          onExit={onExit}
          showLobby={roster === null}
        />
        {overlay}
        {debug && <DebugReadout />}
      </GameProvider>
    </div>
  );
}

/** Tiny dev readout (phase, clock, wrestler states), refreshed 4 times a second. */
function DebugReadout() {
  const { runtime } = useGame();
  const [text, setText] = useState("");
  useEffect(() => {
    const describe = () => {
      const head =
        `phase ${runtime.phase}  t ${runtime.simTime.toFixed(1)}s  ` +
        `scale ${runtime.timeScale.toFixed(2)}  radius ${runtime.arenaRadius}  ` +
        `yaw ${runtime.cameraYaw.toFixed(2)}`;
      const rows = runtime.wrestlers.map(
        (w) =>
          `${w.style.label.padEnd(13)} ${w.status.padEnd(5)} ` +
          `(${w.x.toFixed(1)}, ${w.y.toFixed(1)}, ${w.z.toFixed(1)})` +
          `${w.dashing ? " DASH" : ""}${w.bracing ? " BRACE" : ""}`,
      );
      return [head, ...rows].join("\n");
    };
    const id = window.setInterval(() => setText(describe()), 250);
    return () => window.clearInterval(id);
  }, [runtime]);
  return (
    <pre className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-ink/80 px-3 py-2 font-mono text-xs leading-relaxed text-stone-blue">
      {text}
    </pre>
  );
}
