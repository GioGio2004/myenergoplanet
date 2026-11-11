"use client";

import { useEffect, useMemo, type JSX } from "react";
import { useFrame } from "@react-three/fiber";
import { useGameEvent, useGameSettings, useRuntime } from "../../hooks";
import { DirtTilesRig } from "./tilesRig";

/** Longest frame the crumble animation will advance in one go (matches the physics clamp). */
const MAX_FRAME_SECONDS = 0.1;

/**
 * The packed-dirt floor of the dohyo: a centre pad and concentric rings of tiles,
 * all in ONE InstancedMesh (one draw call). In the final stretch the rings outside
 * the shrinking arena crack, shake and fall away.
 *
 * Swappable asset: replace the rig's unit prism / layout with a Blender-made tile set
 * without touching the rest of the island.
 */
export function DirtTiles(): JSX.Element {
  const runtime = useRuntime();
  const { reduceMotion } = useGameSettings();

  const rig = useMemo(() => new DirtTilesRig(), []);
  // dispose() only frees GPU memory, so StrictMode replaying this effect is safe:
  // the same rig simply re-uploads on its next render.
  useEffect(() => () => rig.dispose(), [rig]);

  // Mounting (or hot-reloading) mid-match: start from the island as it is right now.
  useEffect(() => {
    rig.syncTo(runtime.arenaRadius);
  }, [rig, runtime]);

  useGameEvent("crumbleWarn", (e) => rig.warn(e.radius, e.seconds));
  useGameEvent("crumble", (e) => rig.crumble(e.radius));
  useGameEvent("phase", (e) => {
    // A new match (or back to the lobby) always starts on a whole island.
    if (e.phase === "intro" || e.phase === "lobby") rig.reset();
  });

  useFrame((_, delta) => {
    if (!rig.active) return; // nothing cracking or falling: no per-frame work
    rig.update(Math.min(delta, MAX_FRAME_SECONDS) * runtime.timeScale, reduceMotion);
  });

  return <primitive object={rig.mesh} />;
}
