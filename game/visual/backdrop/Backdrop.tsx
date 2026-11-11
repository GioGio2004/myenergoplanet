"use client";

import { useEffect, useMemo, type JSX } from "react";
import { useFrame } from "@react-three/fiber";
import { useGameSettings, useRuntime } from "../../hooks";
import { BackdropRig } from "./backdropRig";
import { FOG_FAR, FOG_NEAR, MAX_FRAME_DELTA, REDUCED_MOTION_SCALE } from "./palette";

/**
 * Everything behind and below the island: the ink-to-egyptian-blue sky, the drifting
 * sea of clouds with its auspicious cloud scrolls, three ridges of ink-wash mountains
 * on the horizon, a few floating paper lanterns, and the scene fog.
 *
 * Seven draw calls, no textures from the network, nothing updated per frame on the CPU
 * except one clock uniform. Purely visual: reads the runtime, never touches physics.
 * Render inside the <Canvas>, under <GameProvider>.
 */
export function Backdrop(): JSX.Element {
  const runtime = useRuntime();
  const { quality, qualityLevel, reduceMotion } = useGameSettings();

  // One rig per look: instance counts and tone-mapping compensation are baked in.
  const clouds = quality.clouds;
  const postProcessing = quality.postProcessing;
  const lowDetail = qualityLevel === "low";
  const rig = useMemo(
    () => new BackdropRig({ clouds, postProcessing, lowDetail }),
    [clouds, postProcessing, lowDetail],
  );
  // dispose() only frees GPU memory, so StrictMode's effect replay is safe: the same
  // rig simply re-uploads on its next render.
  useEffect(() => () => rig.dispose(), [rig]);

  useFrame((_, delta) => {
    // Scaled time: the clouds hang with the knockout slow motion like everything else.
    const dt = Math.min(delta, MAX_FRAME_DELTA) * runtime.timeScale;
    rig.update(reduceMotion ? dt * REDUCED_MOTION_SCALE : dt);
  });

  return (
    <>
      <fog attach="fog" args={[rig.fogColor, FOG_NEAR, FOG_FAR]} />
      <primitive object={rig.group} />
    </>
  );
}
