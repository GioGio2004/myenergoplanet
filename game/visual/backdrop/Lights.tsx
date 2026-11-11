"use client";

import { useLayoutEffect, useRef, type JSX } from "react";
import type * as THREE from "three";
import { useGameSettings } from "../../hooks";
import {
  KEY_POSITION,
  KEY_SHADOW_FRUSTUM,
  RIM_POSITION,
  shadowTuning,
} from "./lighting";
import { BACKDROP_COLORS } from "./palette";

/** Warm key: the one light that models the wrestlers and casts their shadows. */
const KEY_INTENSITY = 2.5;
/** Cool sky/ground fill: keeps shaded sides readable and colourful instead of black. */
const FILL_INTENSITY = 0.95;
/** Weak cool back light: a thin edge on the side facing away from the key. */
const RIM_INTENSITY = 0.6;

/**
 * Scene lighting, three lights in total:
 * - a warm directional KEY (low lantern-sun, fixed world direction ~46° up) that casts
 *   the only shadows, through an orthographic shadow camera fitted tightly to the island;
 * - a cool hemisphere FILL (stone-blue sky over deep-blue ground);
 * - a weak cool RIM opposite the key, without shadows.
 *
 * Shadows follow the quality preset live: the map is resized in place when the preset
 * changes and freed when shadows are switched off.
 * Render inside the <Canvas>, under <GameProvider>.
 */
export function Lights(): JSX.Element {
  const { quality } = useGameSettings();
  const castShadow = quality.shadows;
  const mapSize = quality.shadowMapSize;
  const keyRef = useRef<THREE.DirectionalLight>(null);

  useLayoutEffect(() => {
    const key = keyRef.current;
    if (!key) return;
    const shadow = key.shadow;

    if (!castShadow) {
      // Free the depth target; three.js allocates a fresh one if shadows come back.
      // (Same teardown WebGLShadowMap performs itself when the shadow type changes.)
      if (shadow.map) {
        shadow.map.depthTexture?.dispose();
        shadow.map.dispose();
        shadow.map = null;
      }
      return;
    }

    const camera = shadow.camera;
    camera.left = KEY_SHADOW_FRUSTUM.left;
    camera.right = KEY_SHADOW_FRUSTUM.right;
    camera.top = KEY_SHADOW_FRUSTUM.top;
    camera.bottom = KEY_SHADOW_FRUSTUM.bottom;
    camera.near = KEY_SHADOW_FRUSTUM.near;
    camera.far = KEY_SHADOW_FRUSTUM.far;
    camera.updateProjectionMatrix();

    // WebGLShadowMap compares the map with `mapSize` every frame and resizes it in
    // place, so a preset change needs nothing more than the new size.
    shadow.mapSize.set(mapSize, mapSize);
    const tuning = shadowTuning(KEY_SHADOW_FRUSTUM, mapSize);
    shadow.bias = tuning.bias;
    shadow.normalBias = tuning.normalBias;
    shadow.radius = tuning.radius;
  }, [castShadow, mapSize]);

  return (
    <>
      <hemisphereLight
        args={[BACKDROP_COLORS.fillSky, BACKDROP_COLORS.fillGround, FILL_INTENSITY]}
      />
      <directionalLight
        ref={keyRef}
        position={KEY_POSITION}
        color={BACKDROP_COLORS.keyLight}
        intensity={KEY_INTENSITY}
        castShadow={castShadow}
      />
      <directionalLight
        position={RIM_POSITION}
        color={BACKDROP_COLORS.rimLight}
        intensity={RIM_INTENSITY}
      />
    </>
  );
}
