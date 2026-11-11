// Everything the backdrop draws, assembled into one group. Plain three.js (no React),
// so the component only ever calls methods on it.
//
// Draw calls: sky 1 + mountains 1 + mist floor 1 + island glow 1 + clouds 1
//             + lantern bodies 1 + lantern halos 1 = 7.
//
// Draw order (all translucent layers use `depthWrite: false` and negative render orders,
// so they are blended back-to-front and before any other translucent object of the game):
//   sky (-1000, opaque queue) → mountains (-90) → mist floor (-80) → island glow (-70)
//   → clouds (-60) → lantern halos (-50). Lantern bodies are ordinary opaque meshes.

import * as THREE from "three";
import { createClouds } from "./clouds";
import { sceneColor } from "./colors";
import { createLanterns } from "./lanterns";
import { lanternCountFor } from "./layout";
import { createIslandGlow, createMistFloor } from "./mist";
import { createMountains } from "./mountains";
import { BACKDROP_COLORS } from "./palette";
import { createSharedUniforms, type BackdropPart, type SharedUniforms } from "./shaderChunks";
import { createSky } from "./sky";

export type BackdropOptions = {
  /** Number of drifting cloud scrolls (`quality.clouds`). */
  clouds: number;
  /** True when the frame goes through the post-processing composer (`quality.postProcessing`). */
  postProcessing: boolean;
  /** Cheaper mist shader for the Low preset. */
  lowDetail: boolean;
};

/**
 * The clock restarts after ten hours so 32-bit float error can never make the drift
 * stutter. The restart is a single-frame jump of the scenery, once per ten hours.
 */
const CLOCK_WRAP_SECONDS = 36000;

export class BackdropRig {
  /** Add this to the scene (`<primitive object={rig.group} />`). */
  readonly group = new THREE.Group();
  /** Colour for the scene fog, matched to the sky just below the horizon. */
  readonly fogColor: THREE.Color;

  private readonly shared: SharedUniforms;
  private readonly parts: BackdropPart[];

  constructor(options: BackdropOptions) {
    const { clouds, postProcessing, lowDetail } = options;
    this.shared = createSharedUniforms(postProcessing);
    this.fogColor = sceneColor(BACKDROP_COLORS.sky, postProcessing);

    const lanterns = createLanterns(this.shared, postProcessing, lanternCountFor(clouds));
    this.parts = [
      createSky(this.shared, postProcessing),
      createMountains(this.shared, postProcessing),
      createMistFloor(this.shared, postProcessing, lowDetail),
      createIslandGlow(this.shared, postProcessing),
      createClouds(this.shared, postProcessing, clouds),
      lanterns.bodies,
      lanterns.halos,
    ];

    this.group.name = "Backdrop";
    this.group.matrixAutoUpdate = false;
    for (const part of this.parts) this.group.add(part.object);
  }

  /**
   * Advance the drift. `dt` is already scaled (slow motion, reduced motion).
   * One float written per frame; every material reads the same uniform object.
   */
  update(dt: number): void {
    const time = this.shared.uTime;
    time.value += dt;
    if (time.value > CLOCK_WRAP_SECONDS) time.value -= CLOCK_WRAP_SECONDS;
  }

  /**
   * Free every GPU resource. three.js re-uploads on the next render if the rig is used
   * again, so this is safe under React StrictMode's effect replay.
   */
  dispose(): void {
    for (const part of this.parts) part.dispose();
  }
}
