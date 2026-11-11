// ─────────────────────────────────────────────────────────────────────────────
// The wrestler as ONE mesh: gourd-shaped liquid body (belly + head bump in a single
// continuous surface), mawashi belt, topknot and eyes, all in character space
// (origin = centre of the physics sphere, +Y up, +Z forward).
//
// Everything is merged into one geometry on purpose: the body shader deforms
// positions in character space, so the belt and the topknot squash, stretch and
// wobble with the body for free, and a wrestler costs a single draw call.
// A per-vertex `aPart` attribute tells the fragment shader which colour to use.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { BeltPattern, PlayerStyle, TopknotStyle } from "../../config";
import { BODY_RADIUS } from "./deform";

/** Values of the `aPart` vertex attribute. The shader relies on this order. */
export const PART = {
  body: 0,
  belt: 1,
  accent: 2,
  hair: 3,
  eye: 4,
} as const;
export type Part = (typeof PART)[keyof typeof PART];

// ── body profile ─────────────────────────────────────────────────────────────

/** Head bump: a sphere of this radius centred this high on the body's axis. */
export const HEAD_RADIUS = 0.29;
export const HEAD_CENTER_Y = 0.58;
/** Top of the head above the body centre. */
export const HEAD_TOP_Y = HEAD_CENTER_Y + HEAD_RADIUS;
/** Width of the smooth blend between belly and head (the "neck" of the drop). */
const NECK_BLEND = 0.075;

/** Polynomial smooth maximum: like max(a, b) with a rounded join of width k. */
function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/**
 * Distance from the body centre to the surface along the direction that makes the
 * polar angle `theta` with +Y (0 = top of the head, π = the foot on the floor).
 * A slightly pear-shaped belly smoothly united with the head bump.
 */
export function bodyRadius(theta: number): number {
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  // Belly: the physics sphere, a touch wider below the waist, exact at the foot.
  const belly = BODY_RADIUS * (1 + 0.06 * sin * sin * (0.35 - cos));
  // Head: far intersection of the ray with the head sphere (0 depth outside its cone).
  const inside = HEAD_RADIUS * HEAD_RADIUS - HEAD_CENTER_Y * HEAD_CENTER_Y * sin * sin;
  const head = HEAD_CENTER_Y * cos + Math.sqrt(Math.max(inside, 0));
  return smoothMax(belly, head, NECK_BLEND);
}

/** Polar angle at which the body surface is at height `y` on the belly (below the neck). */
function thetaAtHeight(y: number): number {
  let lo = 0.9; // just under the neck
  let hi = Math.PI;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (bodyRadius(mid) * Math.cos(mid) > y) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ── mesh builder ─────────────────────────────────────────────────────────────

class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly parts: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /**
   * Surface of revolution about Y. `profile` holds (rho, y) pairs from top to bottom and
   * `profileNormals` the matching outward 2D normals. φ = 0 is +Z (the front).
   */
  lathe(profile: number[], profileNormals: number[], radialSegments: number, part: Part): void {
    const rows = profile.length / 2;
    const base = this.vertexCount;
    const cols = radialSegments + 1;
    for (let i = 0; i < rows; i++) {
      const rho = profile[i * 2];
      const y = profile[i * 2 + 1];
      const nRho = profileNormals[i * 2];
      const nY = profileNormals[i * 2 + 1];
      for (let j = 0; j < cols; j++) {
        // The seam is at the back; its two columns share bit-identical positions.
        const phi = Math.PI + ((j % radialSegments) / radialSegments) * Math.PI * 2;
        const s = Math.sin(phi);
        const c = Math.cos(phi);
        this.positions.push(rho * s, y, rho * c);
        this.normals.push(nRho * s, nY, nRho * c);
        this.parts.push(part);
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      const topPole = profile[i * 2] < 1e-6;
      const bottomPole = profile[(i + 1) * 2] < 1e-6;
      for (let j = 0; j < radialSegments; j++) {
        const a = base + i * cols + j;
        const b = base + (i + 1) * cols + j;
        const c = base + (i + 1) * cols + j + 1;
        const d = base + i * cols + j + 1;
        if (!bottomPole) this.indices.push(a, b, c);
        if (!topPole) this.indices.push(a, c, d);
      }
    }
  }

  /** Append an indexed geometry transformed by `matrix` (which must not mirror). */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, part: Part): void {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    if (!index) throw new Error("character geometry: parts must be indexed");
    const base = this.vertexCount;
    _normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i++) {
      _v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.positions.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(normal, i).applyMatrix3(_normalMatrix).normalize();
      this.normals.push(_v.x, _v.y, _v.z);
      this.parts.push(part);
    }
    for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    geometry.dispose();
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("aPart", new THREE.Float32BufferAttribute(this.parts, 1));
    geometry.setIndex(this.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const _v = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const _m = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/** Translate · rotate (XYZ euler) · scale, into the shared scratch matrix. */
function trs(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  sx: number,
  sy: number,
  sz: number,
): THREE.Matrix4 {
  _position.set(x, y, z);
  _quaternion.setFromEuler(_euler.set(rx, ry, rz));
  _scale.set(sx, sy, sz);
  return _m.compose(_position, _quaternion, _scale);
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _axis = new THREE.Vector3();

/**
 * Translate · rotate local +Z onto the axis (ax, ay, az) · scale, into the shared
 * scratch matrix. For rings (a torus lies in its XY plane, around its Z axis).
 */
function aim(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Matrix4 {
  _position.set(x, y, z);
  _quaternion.setFromUnitVectors(Z_AXIS, _axis.set(ax, ay, az).normalize());
  _scale.set(sx, sy, sz);
  return _m.compose(_position, _quaternion, _scale);
}

/** Unit sphere to be scaled into blobs. Detail follows the body's. */
function ball(detail: number): THREE.SphereGeometry {
  return new THREE.SphereGeometry(1, detail, Math.max(6, Math.round(detail * 0.6)));
}

// ── body ─────────────────────────────────────────────────────────────────────

function addBody(builder: MeshBuilder, segments: number): void {
  // Sample the profile finely, then resample it evenly by arc length so the small,
  // steep head bump gets as many rows per unit of surface as the big belly.
  const FINE = 720;
  const arc = new Float64Array(FINE + 1);
  let prevRho = 0;
  let prevY = bodyRadius(0);
  for (let i = 1; i <= FINE; i++) {
    const theta = (i / FINE) * Math.PI;
    const r = bodyRadius(theta);
    const rho = r * Math.sin(theta);
    const y = r * Math.cos(theta);
    arc[i] = arc[i - 1] + Math.hypot(rho - prevRho, y - prevY);
    prevRho = rho;
    prevY = y;
  }
  const total = arc[FINE];

  // The body sphere gets `segments / 2` rows as the quality preset asks; the head
  // bump adds a few of its own on top.
  const rows = Math.round(segments / 2) + Math.max(6, Math.round(segments / 6));
  const profile: number[] = [];
  const normals: number[] = [];
  let cursor = 0;
  for (let row = 0; row <= rows; row++) {
    let theta: number;
    if (row === 0) theta = 0;
    else if (row === rows) theta = Math.PI;
    else {
      const target = (row / rows) * total;
      while (cursor < FINE - 1 && arc[cursor + 1] < target) cursor++;
      const span = arc[cursor + 1] - arc[cursor];
      const t = span > 0 ? (target - arc[cursor]) / span : 0;
      theta = ((cursor + t) / FINE) * Math.PI;
    }
    const r = bodyRadius(theta);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    if (row === 0 || row === rows) {
      profile.push(0, r * cos);
      normals.push(0, row === 0 ? 1 : -1);
      continue;
    }
    profile.push(r * sin, r * cos);
    // Normal of a polar curve r(θ): r·e_r − r′·e_θ, with e_r = (sin, cos), e_θ = (cos, −sin).
    const h = 1e-4;
    const dr = (bodyRadius(theta + h) - bodyRadius(theta - h)) / (2 * h);
    const nRho = r * sin - dr * cos;
    const nY = r * cos + dr * sin;
    const length = Math.hypot(nRho, nY);
    normals.push(nRho / length, nY / length);
  }
  builder.lathe(profile, normals, segments, PART.body);
}

// ── belt ─────────────────────────────────────────────────────────────────────

/**
 * A band hugging the body between the heights `yTop` and `yBottom`, standing
 * `thickness` proud of the surface with rounded edges that sink back into it.
 */
function addBand(
  builder: MeshBuilder,
  segments: number,
  yTop: number,
  yBottom: number,
  thickness: number,
  part: Part,
): void {
  const ROWS = 8;
  const SINK = 0.012;
  const thetaTop = thetaAtHeight(yTop);
  const thetaBottom = thetaAtHeight(yBottom);
  const profile: number[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const s = i / ROWS;
    const theta = thetaTop + (thetaBottom - thetaTop) * s;
    const lift = -SINK + (thickness + SINK) * Math.pow(Math.sin(Math.PI * s), 0.45);
    const r = bodyRadius(theta) + lift;
    profile.push(r * Math.sin(theta), r * Math.cos(theta));
  }
  // Normals from the polyline's tangent (central differences): outward = (−dy, dρ).
  const normals: number[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const a = Math.max(i - 1, 0);
    const b = Math.min(i + 1, ROWS);
    const dRho = profile[b * 2] - profile[a * 2];
    const dY = profile[b * 2 + 1] - profile[a * 2 + 1];
    const length = Math.hypot(dRho, dY) || 1;
    normals.push(-dY / length, dRho / length);
  }
  builder.lathe(profile, normals, segments, part);
}

/** Height of the belt's centre line and the body's radius there. */
const BELT_Y = -0.1;

function addBelt(builder: MeshBuilder, pattern: BeltPattern, segments: number): void {
  switch (pattern) {
    case "plain":
      // One broad solid band.
      addBand(builder, segments, BELT_Y + 0.13, BELT_Y - 0.13, 0.042, PART.belt);
      break;
    case "stripe":
      // The broad band with a bright raised stripe down its middle.
      addBand(builder, segments, BELT_Y + 0.13, BELT_Y - 0.13, 0.04, PART.belt);
      addBand(builder, segments, BELT_Y + 0.055, BELT_Y - 0.055, 0.06, PART.accent);
      break;
    case "double":
      // Two thin bands with a clear gap of body colour between them.
      addBand(builder, segments, BELT_Y + 0.165, BELT_Y + 0.065, 0.04, PART.belt);
      addBand(builder, segments, BELT_Y - 0.065, BELT_Y - 0.165, 0.04, PART.belt);
      break;
    case "knot": {
      // A band tied in a big bow on the belly.
      addBand(builder, segments, BELT_Y + 0.11, BELT_Y - 0.11, 0.04, PART.belt);
      const detail = Math.max(12, Math.round(segments / 3));
      const front = bodyRadius(thetaAtHeight(BELT_Y)) * Math.sin(thetaAtHeight(BELT_Y)) + 0.04;
      for (const side of [-1, 1]) {
        // Bow loops, fanned out and wrapped slightly around the belly.
        builder.add(
          ball(detail),
          trs(side * 0.2, BELT_Y + 0.04, front - 0.04, 0, side * 0.45, side * 0.4, 0.19, 0.12, 0.075),
          PART.belt,
        );
        // Hanging tails, laid back against the belly as it curves in.
        builder.add(
          ball(detail),
          trs(side * 0.085, BELT_Y - 0.19, front - 0.06, 0.5, 0, side * 0.3, 0.055, 0.13, 0.042),
          PART.belt,
        );
      }
      // The knot itself, in the bright accent.
      builder.add(ball(detail), trs(0, BELT_Y, front + 0.015, 0, 0, 0, 0.095, 0.095, 0.075), PART.accent);
      break;
    }
  }
}

// ── topknot ──────────────────────────────────────────────────────────────────

/**
 * Ginkgo-leaf fan (oicho): narrow at the root, flaring wide towards a rounded tip,
 * gently cupped. Built upright in the XY plane with its root at the origin, thin along Z.
 */
function fanGeometry(detail: number): THREE.BufferGeometry {
  const sphere = new THREE.SphereGeometry(1, detail, Math.max(8, Math.round(detail * 0.7)));
  sphere.deleteAttribute("uv");
  sphere.deleteAttribute("normal");
  // Weld the seam and the poles so recomputed normals are smooth all the way round.
  const fan = mergeVertices(sphere, 1e-5);
  sphere.dispose();
  const position = fan.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    _v.fromBufferAttribute(position, i);
    const t = (_v.y + 1) * 0.5; // 0 at the root, 1 at the tip
    const flare = t * t * (3 - 2 * t);
    const x = _v.x * (0.1 + 0.34 * flare);
    // Cupping (the edges curl towards +Z) keeps it from ever being seen as a mere line.
    position.setXYZ(i, x, t * 0.44, _v.z * (0.08 - 0.03 * flare) + 0.9 * x * x);
  }
  fan.computeVertexNormals();
  return fan;
}

function addTopknot(builder: MeshBuilder, style: TopknotStyle, segments: number): void {
  const detail = Math.max(14, Math.round(segments / 2.5));
  switch (style) {
    case "bun": {
      // Classic chonmage: one round bun sitting on the crown, tied with a cord.
      builder.add(ball(detail), trs(0, HEAD_TOP_Y + 0.105, -0.02, 0, 0, 0, 0.165, 0.15, 0.165), PART.hair);
      const cord = new THREE.TorusGeometry(0.095, 0.034, 8, Math.max(16, detail));
      builder.add(cord, aim(0, HEAD_TOP_Y - 0.005, -0.01, 0, 1, 0), PART.accent);
      break;
    }
    case "fan": {
      // Oicho: a wide flat fan laid back over the crown, rising towards the rear. Nearly
      // horizontal on purpose: the game camera looks down, so the leaf shows its full
      // face from every side instead of turning edge-on.
      builder.add(fanGeometry(detail), trs(0, HEAD_TOP_Y - 0.06, 0.11, -1.02, 0, 0, 1, 1, 1), PART.hair);
      const cord = new THREE.TorusGeometry(0.085, 0.03, 8, Math.max(16, detail));
      builder.add(cord, aim(0, HEAD_TOP_Y - 0.02, 0.05, 0, 1, 0.45, 1.2, 0.85, 1), PART.accent);
      break;
    }
    case "twin": {
      // Two small buns on either side of the head.
      for (const side of [-1, 1]) {
        builder.add(
          ball(detail),
          trs(side * 0.235, HEAD_CENTER_Y + 0.235, -0.02, 0, 0, 0, 0.14, 0.14, 0.14),
          PART.hair,
        );
        const cord = new THREE.TorusGeometry(0.075, 0.026, 8, Math.max(14, detail));
        // The cord rings the root of the bun, so its axis points out along the bun.
        builder.add(cord, aim(side * 0.165, HEAD_CENTER_Y + 0.165, -0.015, side, 1, 0), PART.accent);
      }
      break;
    }
    case "loop": {
      // An upright ring: the hole reads from the front and the back.
      const ring = new THREE.TorusGeometry(0.165, 0.064, 10, Math.max(20, detail * 2));
      builder.add(ring, trs(0, HEAD_TOP_Y + 0.15, -0.01, 0, 0, 0, 1, 1, 1), PART.hair);
      builder.add(ball(detail), trs(0, HEAD_TOP_Y - 0.005, -0.01, 0, 0, 0, 0.09, 0.06, 0.09), PART.accent);
      break;
    }
  }
}

// ── eyes ─────────────────────────────────────────────────────────────────────

function addEyes(builder: MeshBuilder, segments: number): void {
  const detail = Math.max(10, Math.round(segments / 4));
  const YAW = 0.46;
  const PITCH = 0.3;
  for (const side of [-1, 1]) {
    const dx = Math.sin(side * YAW) * Math.cos(PITCH);
    const dy = Math.sin(PITCH);
    const dz = Math.cos(side * YAW) * Math.cos(PITCH);
    // Two glossy ink beads, half sunk into the front of the head.
    const reach = HEAD_RADIUS - 0.008;
    builder.add(
      ball(detail),
      trs(dx * reach, HEAD_CENTER_Y + dy * reach, dz * reach, 0, 0, 0, 0.058, 0.07, 0.05),
      PART.eye,
    );
  }
}

// ── public ───────────────────────────────────────────────────────────────────

/**
 * Build the complete character mesh for one player style.
 * `segments` is the quality preset's `sphereSegments` (width segments of the body).
 * The caller owns the geometry and must dispose it.
 */
export function buildCharacterGeometry(
  style: Pick<PlayerStyle, "topknot" | "beltPattern">,
  segments: number,
): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  // Draw order matters while the body is translucent (depth is written): the small
  // outer parts go first so the body never shows through them back to front.
  addEyes(builder, segments);
  addBelt(builder, style.beltPattern, segments);
  addTopknot(builder, style.topknot, segments);
  addBody(builder, segments);
  return builder.build();
}
