// The underside of the floating island: a faceted, tapering cluster of rock and earth
// hanging below the dirt slab, with a few loose shards drifting beside it.
// One non-indexed (flat-shaded) geometry with vertex colours: one draw call.
//
// It is built to stay inside `maxRadius`, so it is still hidden under the slab after
// the island has crumbled to its smallest size.

import * as THREE from "three";
import { clamp, hash01 } from "../../math";
import { ISLAND_COLORS } from "./palette";

const TAU = Math.PI * 2;

export type RockOptions = {
  /** Y of the rock's flat top (tucked just inside the slab). */
  topY: number;
  /** Nothing reaches further from the island's axis than this. */
  maxRadius: number;
  /** How far the main body hangs below `topY`. */
  depth: number;
  /** Fewer facets (Low preset). */
  lowDetail: boolean;
};

export type RockArrays = {
  /** 9 floats per triangle. */
  positions: Float32Array;
  /** Linear rgb per vertex. */
  colors: Float32Array;
  /** Triangle ranges of the separate lumps (main body, stalactites, shards), in build order. */
  parts: { firstTriangle: number; triangleCount: number }[];
};

type Spike = {
  /** Axis position at the top. */
  cx: number;
  cz: number;
  topY: number;
  topRadius: number;
  depth: number;
  /** Sideways offset of the tip relative to the top. */
  leanX: number;
  leanZ: number;
  /** Rings of vertices between the top and the tip, and vertices per ring. */
  levels: number;
  segments: number;
  /** > 1 pinches the body in early, < 1 keeps it bulky. */
  power: number;
  lobes: number;
  seed: number;
};

type Builder = {
  positions: number[];
  colors: number[];
  /** Vertical extent of the whole rock, for the colour gradient. */
  topY: number;
  bottomY: number;
  maxRadius: number;
  faceCount: number;
  parts: { firstTriangle: number; triangleCount: number }[];
};

/** Record everything pushed since `firstTriangle` as one lump. */
function closePart(b: Builder, firstTriangle: number): void {
  b.parts.push({ firstTriangle, triangleCount: b.faceCount - firstTriangle });
}

const _earth = new THREE.Color(ISLAND_COLORS.rockEarth);
const _stone = new THREE.Color(ISLAND_COLORS.rockStone);
const _deep = new THREE.Color(ISLAND_COLORS.rockDeep);
const _tip = new THREE.Color(ISLAND_COLORS.rockTip);
const _color = new THREE.Color();

/** Earth just under the slab → stone → ink blue at the tip. `t` is 0 at the top, 1 at the bottom. */
function rockColor(t: number, out: THREE.Color): THREE.Color {
  if (t < 0.3) return out.copy(_earth).lerp(_stone, t / 0.3);
  if (t < 0.68) return out.copy(_stone).lerp(_deep, (t - 0.3) / 0.38);
  return out.copy(_deep).lerp(_tip, clamp((t - 0.68) / 0.32, 0, 1));
}

function pushVertex(b: Builder, x: number, y: number, z: number, faceShade: number): void {
  // Hard guarantee that nothing sticks out from under the smallest island.
  const r = Math.hypot(x, z);
  if (r > b.maxRadius) {
    x *= b.maxRadius / r;
    z *= b.maxRadius / r;
  }
  b.positions.push(x, y, z);

  const t = clamp((b.topY - y) / (b.topY - b.bottomY), 0, 1);
  rockColor(t, _color);
  // Baked occlusion: the slab overhangs the top of the rock, so it sits in shade.
  const below = clamp((b.topY - y) / 1.6, 0, 1);
  const shade = faceShade * (0.5 + 0.5 * below * below * (3 - 2 * below));
  b.colors.push(_color.r * shade, _color.g * shade, _color.b * shade);
}

/** One flat-shaded triangle, counter-clockwise seen from outside. */
function pushTriangle(
  b: Builder,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): void {
  // Each facet a touch lighter or darker than its neighbours, like chipped stone.
  const faceShade = 0.9 + 0.22 * hash01(b.faceCount * 13 + 5);
  b.faceCount++;
  pushVertex(b, ax, ay, az, faceShade);
  pushVertex(b, bx, by, bz, faceShade);
  pushVertex(b, cx, cy, cz, faceShade);
}

/** A noisy inverted cone: flat cap on top, tapering to a point. */
function pushSpike(b: Builder, s: Spike): void {
  const { levels, segments } = s;
  const firstTriangle = b.faceCount;
  // Vertex grid: `levels` rings of `segments` points (xyz), then the tip.
  const ring = new Float32Array(levels * segments * 3);
  for (let j = 0; j < levels; j++) {
    const t = j / levels;
    const taper = Math.pow(1 - t, s.power);
    // No noise on the top ring: it must meet the slab cleanly.
    const rough = Math.min(1, t * 4);
    for (let i = 0; i < segments; i++) {
      const h = (s.seed * 977 + j * 61 + i) * 3;
      // Every other ring is turned half a step, so facets become diamonds.
      const theta =
        ((i + (j % 2) * 0.5 + (hash01(h) - 0.5) * 0.45 * rough) / segments) * TAU;
      const lobe = 1 + 0.15 * rough * Math.sin(s.lobes * theta + s.seed * 1.7 + t * 2.4);
      const noise = 1 + (hash01(h + 1) - 0.5) * 0.3 * rough;
      const r = s.topRadius * taper * lobe * noise;
      const o = (j * segments + i) * 3;
      ring[o] = s.cx + s.leanX * t * t + Math.sin(theta) * r;
      ring[o + 1] =
        s.topY - s.depth * t + (hash01(h + 2) - 0.5) * 0.55 * rough * (s.depth / levels);
      ring[o + 2] = s.cz + s.leanZ * t * t + Math.cos(theta) * r;
    }
  }
  const tipX = s.cx + s.leanX;
  const tipY = s.topY - s.depth;
  const tipZ = s.cz + s.leanZ;

  for (let i = 0; i < segments; i++) {
    const n = (i + 1) % segments;

    // Cap (faces up).
    const a = i * 3;
    const c = n * 3;
    pushTriangle(
      b,
      s.cx,
      s.topY,
      s.cz,
      ring[a],
      ring[a + 1],
      ring[a + 2],
      ring[c],
      ring[c + 1],
      ring[c + 2],
    );

    // Side bands. With the half-step turn, the triangle split alternates per ring.
    for (let j = 0; j < levels - 1; j++) {
      const p00 = (j * segments + i) * 3; // upper ring, this column
      const p01 = (j * segments + n) * 3; // upper ring, next column
      const p10 = ((j + 1) * segments + i) * 3; // lower ring, this column
      const p11 = ((j + 1) * segments + n) * 3; // lower ring, next column
      if (j % 2 === 0) {
        // The lower ring is turned half a step forward.
        pushTriangle(
          b,
          ring[p00],
          ring[p00 + 1],
          ring[p00 + 2],
          ring[p10],
          ring[p10 + 1],
          ring[p10 + 2],
          ring[p01],
          ring[p01 + 1],
          ring[p01 + 2],
        );
        pushTriangle(
          b,
          ring[p01],
          ring[p01 + 1],
          ring[p01 + 2],
          ring[p10],
          ring[p10 + 1],
          ring[p10 + 2],
          ring[p11],
          ring[p11 + 1],
          ring[p11 + 2],
        );
      } else {
        // The upper ring is the one turned forward.
        pushTriangle(
          b,
          ring[p00],
          ring[p00 + 1],
          ring[p00 + 2],
          ring[p10],
          ring[p10 + 1],
          ring[p10 + 2],
          ring[p11],
          ring[p11 + 1],
          ring[p11 + 2],
        );
        pushTriangle(
          b,
          ring[p00],
          ring[p00 + 1],
          ring[p00 + 2],
          ring[p11],
          ring[p11 + 1],
          ring[p11 + 2],
          ring[p01],
          ring[p01 + 1],
          ring[p01 + 2],
        );
      }
    }

    // Tip fan.
    const l0 = ((levels - 1) * segments + i) * 3;
    const l1 = ((levels - 1) * segments + n) * 3;
    pushTriangle(
      b,
      ring[l0],
      ring[l0 + 1],
      ring[l0 + 2],
      tipX,
      tipY,
      tipZ,
      ring[l1],
      ring[l1 + 1],
      ring[l1 + 2],
    );
  }
  closePart(b, firstTriangle);
}

/** A loose shard: a squat bipyramid with an uneven waist. */
function pushShard(
  b: Builder,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
  sides: number,
  seed: number,
): void {
  const firstTriangle = b.faceCount;
  const waist = new Float32Array(sides * 3);
  for (let i = 0; i < sides; i++) {
    const h = seed * 409 + i * 3;
    const theta = ((i + (hash01(h) - 0.5) * 0.4) / sides) * TAU;
    const r = radius * (0.75 + 0.5 * hash01(h + 1));
    waist[i * 3] = cx + Math.sin(theta) * r;
    waist[i * 3 + 1] = cy + (hash01(h + 2) - 0.5) * height * 0.25;
    waist[i * 3 + 2] = cz + Math.cos(theta) * r;
  }
  const topY = cy + height * 0.42;
  const bottomY = cy - height * 0.58;
  for (let i = 0; i < sides; i++) {
    const a = i * 3;
    const c = ((i + 1) % sides) * 3;
    pushTriangle(
      b,
      cx,
      topY,
      cz,
      waist[a],
      waist[a + 1],
      waist[a + 2],
      waist[c],
      waist[c + 1],
      waist[c + 2],
    );
    pushTriangle(
      b,
      waist[a],
      waist[a + 1],
      waist[a + 2],
      cx,
      bottomY,
      cz,
      waist[c],
      waist[c + 1],
      waist[c + 2],
    );
  }
  closePart(b, firstTriangle);
}

/** Raw triangle soup; exported so the shape can be tested without WebGL. */
export function buildRockArrays(options: RockOptions): RockArrays {
  const { topY, maxRadius, depth, lowDetail } = options;
  const b: Builder = {
    positions: [],
    colors: [],
    topY,
    bottomY: topY - depth,
    maxRadius,
    faceCount: 0,
    parts: [],
  };
  // Everything is laid out for a unit-radius top and scaled by `R`.
  const R = maxRadius * 0.96;

  // Main body: wide under the slab, leaning a little as it tapers to a point.
  pushSpike(b, {
    cx: 0,
    cz: 0,
    topY,
    topRadius: R,
    depth,
    leanX: 0.14 * R,
    leanZ: -0.09 * R,
    levels: lowDetail ? 5 : 7,
    segments: lowDetail ? 10 : 15,
    power: 1.12,
    lobes: 3,
    seed: 1,
  });

  // Smaller stalactites growing out of its flanks: the cluster silhouette.
  const spikeSegments = lowDetail ? 6 : 8;
  const spikeLevels = lowDetail ? 3 : 4;
  pushSpike(b, {
    cx: 0.5 * R,
    cz: 0.26 * R,
    topY: topY - 0.11 * depth,
    topRadius: 0.33 * R,
    depth: 0.47 * depth,
    leanX: 0.05 * R,
    leanZ: 0.04 * R,
    levels: spikeLevels,
    segments: spikeSegments,
    power: 0.95,
    lobes: 2,
    seed: 2,
  });
  pushSpike(b, {
    cx: -0.46 * R,
    cz: -0.36 * R,
    topY: topY - 0.15 * depth,
    topRadius: 0.27 * R,
    depth: 0.38 * depth,
    leanX: -0.04 * R,
    leanZ: 0.02 * R,
    levels: spikeLevels,
    segments: spikeSegments,
    power: 1,
    lobes: 2,
    seed: 3,
  });
  pushSpike(b, {
    cx: -0.2 * R,
    cz: 0.56 * R,
    topY: topY - 0.08 * depth,
    topRadius: 0.24 * R,
    depth: 0.31 * depth,
    leanX: 0,
    leanZ: 0.05 * R,
    levels: spikeLevels,
    segments: spikeSegments,
    power: 1.05,
    lobes: 2,
    seed: 4,
  });

  // Loose shards that broke away and hang in the air beside the rock.
  pushShard(b, 0.7 * R, topY - 0.56 * depth, -0.24 * R, 0.1 * R, 0.085 * depth, 5, 5);
  pushShard(b, -0.62 * R, topY - 0.45 * depth, 0.42 * R, 0.075 * R, 0.07 * depth, 5, 6);
  pushShard(b, 0.3 * R, topY - 0.86 * depth, 0.4 * R, 0.06 * R, 0.06 * depth, 4, 7);
  pushShard(b, -0.34 * R, topY - 0.72 * depth, -0.5 * R, 0.085 * R, 0.075 * depth, 5, 8);

  return {
    positions: new Float32Array(b.positions),
    colors: new Float32Array(b.colors),
    parts: b.parts,
  };
}

/** Attributes: position, normal (one per face: flat shading), color. */
export function createRockGeometry(options: RockOptions): THREE.BufferGeometry {
  const { positions, colors } = buildRockArrays(options);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); // non-indexed → per-face normals
  geometry.computeBoundingSphere();
  return geometry;
}
