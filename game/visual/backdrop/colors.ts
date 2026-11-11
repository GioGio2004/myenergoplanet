import * as THREE from "three";
import { inverseAcesFilmic } from "./tone";

/**
 * The linear working-space colour to hand to an UNLIT backdrop shader (or the scene fog)
 * so that the pixel on screen ends up as `hex`.
 *
 * - No post-processing: backdrop materials are `toneMapped: false` and three.js applies
 *   fog in output space, so the plain colour is already exact.
 * - Post-processing: the composer tone maps the whole frame with ACES filmic, so the
 *   colour is pushed through the inverse curve first.
 */
export function sceneColor(
  hex: string,
  postProcessing: boolean,
  target: THREE.Color = new THREE.Color(),
): THREE.Color {
  target.set(hex);
  return postProcessing ? inverseAcesFilmic(target, target) : target;
}

/** `sceneColor` of a mix between two palette colours (mixed in display space). */
export function sceneColorMix(
  hexA: string,
  hexB: string,
  t: number,
  postProcessing: boolean,
  target: THREE.Color = new THREE.Color(),
): THREE.Color {
  target.set(hexA).lerp(SCRATCH.set(hexB), t);
  return postProcessing ? inverseAcesFilmic(target, target) : target;
}

const SCRATCH = new THREE.Color();
