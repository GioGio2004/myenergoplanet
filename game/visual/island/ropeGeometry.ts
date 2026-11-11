// One tawara (rice-straw bale) of the rope ring: a rounded bale lying along X with
// twisted straw strands painted (and lightly embossed) on it and two dark bindings.
// A single merged geometry with vertex colours, so the whole ring is one draw call.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ISLAND_COLORS } from "./palette";

const TAU = Math.PI * 2;

export type BaleGeometryOptions = {
  /** Tip-to-tip length along X. */
  length: number;
  radius: number;
  /** Fewer triangles (Low preset). */
  lowDetail: boolean;
};

/** How far the strands stand proud of the bale, as a fraction of its radius. */
const STRAND_RELIEF = 0.06;
/** Turns the strands make along one bale. */
const STRAND_TWIST = 1.25;
/** Bindings sit this far from the middle, as a fraction of the length. */
const BINDING_OFFSET = 0.27;

function paint(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function createBaleBody(
  length: number,
  radius: number,
  lowDetail: boolean,
): THREE.BufferGeometry {
  const radialSegments = lowDetail ? 8 : 12;
  const strands = lowDetail ? 2 : 3;
  const body = new THREE.CapsuleGeometry(
    radius,
    Math.max(length - radius * 2, 0.01),
    lowDetail ? 2 : 3,
    radialSegments,
    lowDetail ? 3 : 6,
  );
  body.rotateZ(Math.PI / 2); // capsule axis Y → X

  const light = new THREE.Color(ISLAND_COLORS.strawLight);
  const dark = new THREE.Color(ISLAND_COLORS.strawDark);
  const position = body.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Helical strands: bands of light and dark straw winding around the bale.
    const around = Math.atan2(z, y);
    const strand = Math.sin(strands * around + (x / length) * TAU * STRAND_TWIST);
    // Emboss them a little. The capsule's smooth normals are kept on purpose: the
    // relief only has to break up the silhouette, the colour does the rest.
    const relief = 1 + STRAND_RELIEF * strand;
    position.setXYZ(i, x, y * relief, z * relief);
    const t = 0.5 + 0.5 * strand;
    colors[i * 3] = dark.r + (light.r - dark.r) * t;
    colors[i * 3 + 1] = dark.g + (light.g - dark.g) * t;
    colors[i * 3 + 2] = dark.b + (light.b - dark.b) * t;
  }
  body.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return body;
}

function createBinding(x: number, radius: number, lowDetail: boolean): THREE.BufferGeometry {
  const binding = new THREE.TorusGeometry(
    radius * 1.05,
    radius * 0.2,
    4,
    lowDetail ? 8 : 10,
  );
  binding.rotateY(Math.PI / 2); // torus axis Z → X: it wraps around the bale
  binding.translate(x, 0, 0);
  paint(binding, new THREE.Color(ISLAND_COLORS.strawBinding));
  return binding;
}

/** A bale centred on the origin, lying along X. Indexed; attributes: position, normal, color. */
export function createBaleGeometry(options: BaleGeometryOptions): THREE.BufferGeometry {
  const { length, radius, lowDetail } = options;
  const parts = [
    createBaleBody(length, radius, lowDetail),
    createBinding(-length * BINDING_OFFSET, radius, lowDetail),
    createBinding(length * BINDING_OFFSET, radius, lowDetail),
  ];
  for (const part of parts) part.deleteAttribute("uv"); // unused, and all parts must match
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}
