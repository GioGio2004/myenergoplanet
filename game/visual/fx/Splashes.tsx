"use client";

import { useEffect, useMemo, type JSX } from "react";
import { useFrame } from "@react-three/fiber";
import { useGameEvent, useGameSettings, useRuntime } from "../../hooks";
import { SplashRig } from "./splashRig";

/** Longest frame the effects will simulate in one go (matches the physics clamp). */
const MAX_FRAME_SECONDS = 0.1;

/**
 * Splash particles and impact effects: droplets for hits, landings, dashes, knockouts,
 * respawns and braces, plus ground shockwave rings on heavy impacts.
 *
 * Two draw calls (instanced droplets, instanced rings), three with droplet shadows.
 * Purely visual: reads the runtime and its events, never touches the physics.
 * Render inside the <Canvas>, under <GameProvider>.
 */
export function Splashes(): JSX.Element {
  const runtime = useRuntime();
  const { quality, qualityLevel, reduceMotion } = useGameSettings();

  // One rig per quality setting: the pool size is fixed for its lifetime.
  const particles = quality.particles;
  const lowDetail = qualityLevel === "low";
  const castShadow = quality.shadows;
  const rig = useMemo(
    () => new SplashRig({ particles, lowDetail, castShadow }),
    [particles, lowDetail, castShadow],
  );
  // three's dispose() only frees GPU memory, so StrictMode's effect replay is safe:
  // the same rig simply re-uploads on its next render.
  useEffect(() => () => rig.dispose(), [rig]);

  useGameEvent("hit", (e) => rig.hit(e, runtime));
  useGameEvent("land", (e) => rig.land(e, runtime));
  useGameEvent("dash", (e) => rig.dash(e, runtime));
  useGameEvent("knockout", (e) => rig.knockout(e, runtime));
  useGameEvent("respawn", (e) => rig.respawn(e, runtime));
  useGameEvent("brace", (e) => rig.brace(e, runtime));
  useGameEvent("phase", (e) => {
    if (e.phase === "lobby") rig.clear();
  });

  useFrame((_, delta) => {
    // Scaled time: droplets hang in the air with the knockout slow motion.
    const dt = Math.min(delta, MAX_FRAME_SECONDS) * runtime.timeScale;
    rig.update(dt, runtime.arenaRadius, reduceMotion);
  });

  return (
    <>
      <primitive object={rig.droplets.mesh} />
      <primitive object={rig.shockwaves.mesh} />
    </>
  );
}
