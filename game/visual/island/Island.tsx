"use client";

import type { JSX } from "react";
import { DirtTiles } from "./DirtTiles";
import { IslandRock } from "./IslandRock";
import { RingMarks } from "./RingMarks";
import { RopeRing } from "./RopeRing";

/**
 * The arena: a small round floating island laid out as a dohyo.
 *
 * Purely visual (the physics floor is a separate module): the tile tops sit at y = 0
 * and the island centre is the origin. Four draw calls in total, one per part, and
 * each part is its own component so it can later be swapped for a Blender-made asset:
 *
 * - <IslandRock/>  the rock and earth hanging below the slab
 * - <DirtTiles/>   the packed-dirt floor; its outer rings crack and fall in the final stretch
 * - <RopeRing/>    the tawara straw-rope ring on the outermost tiles; it falls with them
 * - <RingMarks/>   the two starting lines at the centre
 *
 * Render inside the <Canvas>, under <GameProvider>.
 */
export function Island(): JSX.Element {
  return (
    <group name="island">
      <IslandRock />
      <DirtTiles />
      <RopeRing />
      <RingMarks />
    </group>
  );
}
