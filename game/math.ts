// Small allocation-free math helpers shared by every game layer.

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 * `smoothTime` ≈ seconds to cover ~63% of the remaining distance.
 */
export function damp(current: number, target: number, smoothTime: number, dt: number): number {
  if (smoothTime <= 0) return target;
  return target + (current - target) * Math.exp(-dt / smoothTime);
}

/** Shortest signed difference between two angles, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current: number, target: number, smoothTime: number, dt: number): number {
  return current + angleDelta(current, target) * (1 - Math.exp(-dt / Math.max(smoothTime, 1e-5)));
}

export type Vec2 = { x: number; z: number };

/**
 * Convert a screen-relative stick sample into a world-space XZ direction.
 *
 * The camera sits at (sin yaw, ·, cos yaw) × distance looking at the island centre, so
 * screen-right is (cos yaw, 0, -sin yaw) and "up the screen" is (-sin yaw, 0, -cos yaw).
 * Writes into `out` and returns it. Magnitude is preserved (not normalised).
 */
export function inputToWorld(inputX: number, inputY: number, cameraYaw: number, out: Vec2): Vec2 {
  const s = Math.sin(cameraYaw);
  const c = Math.cos(cameraYaw);
  out.x = c * inputX - s * inputY;
  out.z = -s * inputX - c * inputY;
  return out;
}

/** Deterministic 0..1 hash of an integer (for per-tile / per-particle variation). */
export function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
