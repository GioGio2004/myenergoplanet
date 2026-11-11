// Pure camera maths for the CameraDirector: springs, framing/fit distances, bounding
// circles, shake noise and blend envelopes. No three.js, no React, no allocations
// (every function writes into caller-owned scratch objects).

import { clamp } from "../math";

export const DEG2RAD = Math.PI / 180;

export type Vec2Like = { x: number; z: number };
export type Vec3Like = { x: number; y: number; z: number };
export type Circle = { x: number; z: number; radius: number };

// ── critically damped spring ────────────────────────────────────────────────

/** Scalar spring state, mutated in place by `stepSpring`. */
export type Spring = { value: number; velocity: number };

export function createSpring(value = 0): Spring {
  return { value, velocity: 0 };
}

export function snapSpring(spring: Spring, value: number): void {
  spring.value = value;
  spring.velocity = 0;
}

/**
 * ω·smoothTime for the spring below. With 4 the spring has covered ~91% of a step
 * change after `smoothTime` seconds ("seconds to mostly settle" in config.camera).
 */
const SETTLE_FACTOR = 4;

/**
 * Advance a critically damped spring toward `target` (exact closed-form solution, so
 * the result does not depend on the frame rate). Unlike plain exponential damping the
 * velocity is continuous: a target that jumps makes the value ease in AND out, which
 * is what keeps phase changes from reading as cuts.
 */
export function stepSpring(spring: Spring, target: number, smoothTime: number, dt: number): number {
  if (smoothTime <= 1e-5) {
    spring.value = target;
    spring.velocity = 0;
    return target;
  }
  if (dt <= 0) return spring.value;
  const omega = SETTLE_FACTOR / smoothTime;
  const offset = spring.value - target;
  const k = (spring.velocity + omega * offset) * dt;
  const decay = Math.exp(-omega * dt);
  spring.value = target + (offset + k) * decay;
  spring.velocity = (spring.velocity - omega * k) * decay;
  return spring.value;
}

// ── orbit geometry ──────────────────────────────────────────────────────────

/**
 * Offset of the camera from its look-at target: (sin yaw, ·, cos yaw) × distance,
 * raised by `pitch` (radians above the horizon, i.e. how far the camera looks down).
 * This is the definition `inputToWorld` in game/math.ts relies on.
 */
export function orbitOffset(yaw: number, pitch: number, distance: number, out: Vec3Like): Vec3Like {
  const horizontal = Math.cos(pitch) * distance;
  out.x = Math.sin(yaw) * horizontal;
  out.y = Math.sin(pitch) * distance;
  out.z = Math.cos(yaw) * horizontal;
  return out;
}

/** Heading (yaw) of a camera that sits at offset (x, ·, z) from its target. */
export function headingFromOffset(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  let a = angle % turn;
  if (a > Math.PI) a -= turn;
  if (a <= -Math.PI) a += turn;
  return a;
}

// ── field of view / fit distances ───────────────────────────────────────────

const MIN_ASPECT = 0.2;

function tanHalfVertical(fovDegrees: number): number {
  return Math.tan((fovDegrees * DEG2RAD) / 2);
}

/** Horizontal half field of view (radians) of a camera with vertical `fovDegrees`. */
export function horizontalHalfFov(fovDegrees: number, aspect: number): number {
  return Math.atan(tanHalfVertical(fovDegrees) * Math.max(aspect, MIN_ASPECT));
}

/** The smaller of the vertical and horizontal half fields of view, in radians. */
export function minHalfFov(fovDegrees: number, aspect: number): number {
  return Math.min((fovDegrees * DEG2RAD) / 2, horizontalHalfFov(fovDegrees, aspect));
}

/** Distance at which a sphere of `radius` around the target fits the narrower fov. */
export function fitSphereDistance(radius: number, fovDegrees: number, aspect: number): number {
  return radius / Math.sin(minHalfFov(fovDegrees, aspect));
}

/**
 * Distance at which a disc of `radius` lying on the ground around the look-at target
 * exactly fits the frame of a camera looking down at `pitch` radians.
 *
 * Derivation (camera space, h = ground-forward, tv/th = tan of the half fovs):
 * a ground point at lateral s and forward f projects to
 *   x = s / (d + f·cos p),   y = f·sin p / (d + f·cos p).
 * - vertical: the nearest point (f = -R) is the binding one  → d ≥ R (sin p / tv + cos p)
 * - horizontal: maximise over the circle (s, f) = R (cos θ, sin θ)
 *                                                            → d ≥ R √(1/th² + cos² p)
 * The larger of the two wins, so narrow (portrait) windows automatically back off.
 */
export function fitGroundDistance(
  radius: number,
  fovDegrees: number,
  aspect: number,
  pitch: number,
): number {
  const tv = tanHalfVertical(fovDegrees);
  const th = tv * Math.max(aspect, MIN_ASPECT);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const vertical = sp / tv + cp;
  const horizontal = Math.sqrt(1 / (th * th) + cp * cp);
  return radius * Math.max(vertical, horizontal);
}

/**
 * ≥ 1. How much farther than in a wide window the camera must be to fit the same
 * ground disc. It is 1 whenever the vertical fov is the binding one (any landscape
 * window) and grows for portrait-ish windows. Used to scale the distance clamps.
 */
export function aspectDistanceScale(fovDegrees: number, aspect: number, pitch: number): number {
  const vertical = Math.sin(pitch) / tanHalfVertical(fovDegrees) + Math.cos(pitch);
  if (vertical <= 1e-6) return 1;
  return Math.max(1, fitGroundDistance(1, fovDegrees, aspect, pitch) / vertical);
}

/**
 * Camera distance for a group of wrestlers enclosed by a circle of `groupRadius`:
 * fits the circle plus `padding`, clamped to [minDistance, maxDistance] (the clamps
 * are widened for portrait windows so the island still fits).
 */
export function frameDistance(
  groupRadius: number,
  padding: number,
  fovDegrees: number,
  aspect: number,
  pitch: number,
  minDistance: number,
  maxDistance: number,
): number {
  const scale = aspectDistanceScale(fovDegrees, aspect, pitch);
  const fit = fitGroundDistance(Math.max(0, groupRadius) + padding, fovDegrees, aspect, pitch);
  return clamp(fit, minDistance * scale, maxDistance * scale);
}

// ── bounding circle ─────────────────────────────────────────────────────────

function containsAll(
  xs: ArrayLike<number>,
  zs: ArrayLike<number>,
  count: number,
  cx: number,
  cz: number,
  radiusSq: number,
): boolean {
  const limit = radiusSq * (1 + 1e-7) + 1e-9;
  for (let i = 0; i < count; i++) {
    const dx = xs[i] - cx;
    const dz = zs[i] - cz;
    if (dx * dx + dz * dz > limit) return false;
  }
  return true;
}

/**
 * Smallest circle enclosing the first `count` points (xs[i], zs[i]). Brute force over
 * every pair (as a diameter) and triple (circumcircle): exact, allocation-free and
 * plenty fast for the ≤ 4 wrestlers it is used for. The minimal circle moves
 * continuously with the points, so the camera target never pops.
 */
export function enclosingCircle(
  xs: ArrayLike<number>,
  zs: ArrayLike<number>,
  count: number,
  out: Circle,
): Circle {
  if (count <= 0) {
    out.x = 0;
    out.z = 0;
    out.radius = 0;
    return out;
  }
  if (count === 1) {
    out.x = xs[0];
    out.z = zs[0];
    out.radius = 0;
    return out;
  }

  let bestSq = Infinity;
  let bestX = 0;
  let bestZ = 0;

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const cx = (xs[i] + xs[j]) / 2;
      const cz = (zs[i] + zs[j]) / 2;
      const dx = xs[i] - cx;
      const dz = zs[i] - cz;
      const rSq = dx * dx + dz * dz;
      if (rSq < bestSq && containsAll(xs, zs, count, cx, cz, rSq)) {
        bestSq = rSq;
        bestX = cx;
        bestZ = cz;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      for (let k = j + 1; k < count; k++) {
        // Circumcentre relative to point i.
        const bx = xs[j] - xs[i];
        const bz = zs[j] - zs[i];
        const cx = xs[k] - xs[i];
        const cz = zs[k] - zs[i];
        const d = 2 * (bx * cz - bz * cx);
        if (Math.abs(d) < 1e-9) continue; // collinear: a pair circle already covers it
        const bSq = bx * bx + bz * bz;
        const cSq = cx * cx + cz * cz;
        const ux = (cz * bSq - bz * cSq) / d;
        const uz = (bx * cSq - cx * bSq) / d;
        const rSq = ux * ux + uz * uz;
        if (rSq < bestSq && containsAll(xs, zs, count, xs[i] + ux, zs[i] + uz, rSq)) {
          bestSq = rSq;
          bestX = xs[i] + ux;
          bestZ = zs[i] + uz;
        }
      }
    }
  }

  if (bestSq === Infinity) {
    // Numerically degenerate input: fall back to the bounding-box centre.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, xs[i]);
      maxX = Math.max(maxX, xs[i]);
      minZ = Math.min(minZ, zs[i]);
      maxZ = Math.max(maxZ, zs[i]);
    }
    bestX = (minX + maxX) / 2;
    bestZ = (minZ + maxZ) / 2;
    bestSq = 0;
    for (let i = 0; i < count; i++) {
      const dx = xs[i] - bestX;
      const dz = zs[i] - bestZ;
      bestSq = Math.max(bestSq, dx * dx + dz * dz);
    }
  }

  out.x = bestX;
  out.z = bestZ;
  out.radius = Math.sqrt(bestSq);
  return out;
}

/**
 * Distance from (cx, cz) to the farthest of the first `count` points (0 for no points).
 * The look-at target is not always the centre of the group (it is clamped toward the
 * island and leans toward the edge), so the fit must also cover this.
 */
export function farthestDistance(
  xs: ArrayLike<number>,
  zs: ArrayLike<number>,
  count: number,
  cx: number,
  cz: number,
): number {
  let maxSq = 0;
  for (let i = 0; i < count; i++) {
    const dx = xs[i] - cx;
    const dz = zs[i] - cz;
    const dSq = dx * dx + dz * dz;
    if (dSq > maxSq) maxSq = dSq;
  }
  return Math.sqrt(maxSq);
}

/** Clamp the point (x, z) to a disc of `maxRadius` around the origin. */
export function clampToRadius(x: number, z: number, maxRadius: number, out: Vec2Like): Vec2Like {
  const lenSq = x * x + z * z;
  const max = Math.max(0, maxRadius);
  if (lenSq > max * max && lenSq > 0) {
    const s = max / Math.sqrt(lenSq);
    out.x = x * s;
    out.z = z * s;
  } else {
    out.x = x;
    out.z = z;
  }
  return out;
}

// ── shake noise ─────────────────────────────────────────────────────────────

/**
 * Cheap deterministic noise in [-1, 1] for camera shake: two incommensurate sines
 * (~5 Hz and ~8.5 Hz, a heavy thud rather than a buzz). `channel` (0, 1, 2 …)
 * decorrelates the axes. Smooth in `t`, so the shake never jitters frame to frame.
 */
export function shakeNoise(t: number, channel: number): number {
  const phase = channel * 12.9898;
  return 0.6 * Math.sin(t * 31 + phase) + 0.4 * Math.sin(t * 53.3 + phase * 1.7 + 1.3);
}

// ── easing and blend envelopes ──────────────────────────────────────────────

/** Hermite smoothstep on u ∈ [0, 1] (clamped). */
export function smoothstep01(u: number): number {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(u: number): number {
  const t = clamp(u, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) * (1 - t) * (1 - t);
}

/** Eased 0 → 1 blend weight of a timed move (the intro fly-in) `elapsed` seconds in. */
export function blendProgress(elapsed: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return easeInOutCubic(elapsed / seconds);
}

/**
 * Angular-rate profile of a sweep: the derivative of smoothstep. Zero at both ends,
 * peaks at 1.5 in the middle and integrates to exactly 1 over u ∈ [0, 1], so
 * `total × sweepRate(t / T) / T` rad/s turns the camera by `total` radians in T seconds.
 */
export function sweepRate(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return 6 * u * (1 - u);
}

/**
 * 0 → 1 → 0 weight for a temporary blend (knockout follow): eases in over the first
 * `attack` fraction, holds, then eases out over the last `release` fraction.
 */
export function bumpEnvelope(u: number, attack: number, release: number): number {
  if (u <= 0 || u >= 1) return 0;
  const rise = attack > 0 ? smoothstep01(u / attack) : 1;
  const fall = release > 0 ? smoothstep01((1 - u) / release) : 1;
  return rise * fall;
}

/** 1 → 0 recovery curve of the punch-in: starts at full strength and eases out to rest. */
export function punchEnvelope(u: number): number {
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  const r = 1 - u;
  return r * r;
}
