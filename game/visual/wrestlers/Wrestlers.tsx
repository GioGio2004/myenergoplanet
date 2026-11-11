"use client";

import { useEffect, useMemo, type JSX } from "react";
import { useFrame } from "@react-three/fiber";
import { useGameEvent, useGameSettings, usePlayers, useRuntime } from "../../hooks";
import type { WrestlerRuntime } from "../../types";
import { WrestlerRig } from "./wrestlerRig";

/** Longest frame the animation will simulate in one go (matches the physics clamp). */
const MAX_FRAME_SECONDS = 0.1;

/**
 * The liquid sumo wrestlers: one glossy drop per player, each with its own colour,
 * topknot silhouette and belt pattern, a ground ring in its colour and a name tag.
 *
 * Purely visual: positions and states are read from the WrestlerRuntime records the
 * physics layer writes; nothing here touches Rapier.
 * Render inside the <Canvas>, under <GameProvider>.
 */
export function Wrestlers(): JSX.Element {
  const players = usePlayers();
  return (
    <group name="wrestlers">
      {players.map((wrestler) => (
        // Keyed by slot: a slot keeps its GPU resources when the roster is edited.
        <WrestlerView key={wrestler.slot} wrestler={wrestler} />
      ))}
    </group>
  );
}

function WrestlerView({ wrestler }: { wrestler: WrestlerRuntime }): JSX.Element {
  const runtime = useRuntime();
  const { quality, reduceMotion } = useGameSettings();
  const { slot, style, name } = wrestler;
  const segments = quality.sphereSegments;
  const shadows = quality.shadows;

  // One rig per slot and quality setting. The style object of a slot is stable
  // (PLAYER_STYLES[slot]), so replacing the roster does not rebuild anything.
  const rig = useMemo(
    () => new WrestlerRig(style, slot, { segments, shadows }),
    [style, slot, segments, shadows],
  );
  // three's dispose() only frees GPU memory, so StrictMode's effect replay is safe:
  // the same rig simply re-uploads on its next render.
  useEffect(() => () => rig.dispose(), [rig]);

  // A new runtime record (roster change) starts from a clean pose.
  useEffect(() => {
    rig.reset();
  }, [rig, wrestler]);

  useEffect(() => {
    rig.setName(name);
  }, [rig, name]);

  useGameEvent("hit", (e) => {
    if (e.a !== slot && e.b !== slot) return;
    rig.onHit(e, wrestler, runtime.wrestler(e.a === slot ? e.b : e.a), reduceMotion);
  });
  useGameEvent("land", (e) => {
    if (e.slot === slot) rig.onLand(e, reduceMotion);
  });
  useGameEvent("dash", (e) => {
    if (e.slot === slot) rig.onDash(reduceMotion);
  });
  useGameEvent("brace", (e) => {
    if (e.slot === slot) rig.onBrace(e, reduceMotion);
  });
  // Teleports: the body jumps, so springs and velocity history must not react to it.
  useGameEvent("respawn", (e) => {
    if (e.slot === slot) rig.reset();
  });
  useGameEvent("phase", (e) => {
    if (e.phase === "intro" || e.phase === "lobby") rig.reset();
  });

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_FRAME_SECONDS) * runtime.timeScale;
    rig.update(wrestler, runtime, state.camera, dt, reduceMotion);
  });

  return <primitive object={rig.root} />;
}
