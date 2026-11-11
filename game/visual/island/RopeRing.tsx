"use client";

import { useEffect, useMemo, type JSX } from "react";
import { useFrame } from "@react-three/fiber";
import { useGameEvent, useGameSettings, useRuntime } from "../../hooks";
import { RopeRingRig } from "./ropeRig";

/** Longest frame the crumble animation will advance in one go (matches the physics clamp). */
const MAX_FRAME_SECONDS = 0.1;

/**
 * The tawara: a ring of half-buried straw bales marking the edge of the dohyo.
 * ONE InstancedMesh. It shakes and drops, bale by bale, when the first crumble takes
 * the outer ring away; after that the island has no rope until the next match.
 *
 * Swappable asset: replace the rig's bale geometry with a Blender-made bale.
 */
export function RopeRing(): JSX.Element {
  const runtime = useRuntime();
  const { quality, qualityLevel, reduceMotion } = useGameSettings();

  const lowDetail = qualityLevel === "low";
  const castShadow = quality.shadows;
  const rig = useMemo(() => new RopeRingRig({ lowDetail, castShadow }), [lowDetail, castShadow]);
  // Freed GPU resources are simply re-uploaded if StrictMode replays this effect.
  useEffect(() => () => rig.dispose(), [rig]);

  // Mounting (or changing quality) mid-match: start from the island as it is right now.
  useEffect(() => {
    rig.syncTo(runtime.arenaRadius);
  }, [rig, runtime]);

  useGameEvent("crumbleWarn", (e) => rig.warn(e.radius, e.seconds));
  useGameEvent("crumble", (e) => rig.crumble(e.radius));
  useGameEvent("phase", (e) => {
    if (e.phase === "intro" || e.phase === "lobby") rig.reset();
  });

  useFrame((_, delta) => {
    if (!rig.active) return;
    rig.update(Math.min(delta, MAX_FRAME_SECONDS) * runtime.timeScale, reduceMotion);
  });

  return <primitive object={rig.mesh} />;
}
