"use client";

import { useEffect, useMemo, type JSX } from "react";
import { gameConfig } from "../../config";
import { useGameSettings } from "../../hooks";
import { createRockGeometry } from "./rockGeometry";

const { arena } = gameConfig;

/** The rock stays this far inside the smallest (fully crumbled) island. */
const EDGE_MARGIN = 0.15;
/** Its flat top is tucked this far up into the dirt slab. */
const TOP_OVERLAP = 0.1;
/** How far the rock hangs below its top. */
const ROCK_DEPTH = 7.2;

/** Smallest walkable radius the island ever shrinks to. */
function smallestIslandRadius(): number {
  let radius: number = arena.radius;
  for (const step of arena.crumble.steps) radius = Math.min(radius, step.radius);
  return radius;
}

/**
 * The underside of the floating island: faceted rock and earth tapering to a point,
 * dark earth under the slab fading to ink blue at the tip. One static mesh.
 *
 * Swappable asset: replace the geometry with a Blender-made rock (keep it inside the
 * smallest island radius so nothing is left hanging in the air after the crumble).
 */
export function IslandRock(): JSX.Element {
  const { qualityLevel } = useGameSettings();
  const lowDetail = qualityLevel === "low";

  const geometry = useMemo(
    () =>
      createRockGeometry({
        topY: -arena.slabThickness + TOP_OVERLAP,
        maxRadius: smallestIslandRadius() - EDGE_MARGIN,
        depth: ROCK_DEPTH,
        lowDetail,
      }),
    [lowDetail],
  );
  // Geometries made in useMemo are not disposed by R3F.
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh name="island-rock" geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  );
}
