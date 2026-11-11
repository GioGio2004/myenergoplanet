// ─────────────────────────────────────────────────────────────────────────────
// Liquid wrestler pose: every spring, squash/stretch factor and state blend that
// drives the body shader. Pure numbers (no three.js, no DOM) so it can be unit
// tested, and allocation-free per step.
//
// Space conventions: "world" is the game world (Y up); "local" is the character's
// own space, rotated by the visual facing so +Z is forward and +X is its left-hand
// side as seen from the front. The body shader deforms vertices in local space.
// ─────────────────────────────────────────────────────────────────────────────

import { gameConfig } from "../../config";
import { clamp, damp, dampAngle } from "../../math";
import type { WrestlerRuntime } from "../../types";

/** Radius of the physics sphere: the body rests with its centre this far above the floor. */
export const BODY_RADIUS = gameConfig.wrestler.radius;

// ── tuning ───────────────────────────────────────────────────────────────────

/** Seconds for the visual heading to catch up with the simulated one. */
const FACING_SMOOTH = 0.07;
/** Smoothing of the velocity that drives the stretch (hides fixed-step noise). */
const VELOCITY_SMOOTH = 0.055;
const GROUND_SMOOTH = 0.05;
const EDGE_SMOOTH = 0.15;
const DASH_SMOOTH = 0.05;

/** Vertical squash spring (landing, brace). ~4.3 Hz, a little overshoot. */
const SQUASH_OMEGA = 27;
const SQUASH_ZETA = 0.45;
/** Hit-normal squash spring. 5 Hz, livelier, settles in about half a second. */
const HIT_OMEGA = 31.4;
const HIT_ZETA = 0.32;
/** Top-of-the-body sway spring (the jelly lag). */
const SWAY_OMEGA = 21;
const SWAY_ZETA = 0.3;

/** Log-scale height while bracing: exp(-0.36) ≈ 0.70 tall, 1.19 wide. */
const BRACE_SQUASH = -0.36;
const SQUASH_MIN = -0.75;
const SQUASH_MAX = 0.5;
const HIT_MIN = -0.45;
const HIT_MAX = 0.32;

/** Stretch along the velocity at the self-propelled speed cap. */
const STRETCH_RUN = 0.16;
/** Extra stretch per multiple of the speed cap beyond it (knockback, falling). */
const STRETCH_FAST = 0.07;
/** Extra stretch while the dash is active. */
const STRETCH_DASH = 0.14;
const STRETCH_MAX = 0.5;
/** Share of the height lost to a horizontal stretch that is given back (as an exponent). */
const HEIGHT_KEPT = 0.25;

/** Sway impulse per unit of velocity change (the top lags behind the base). */
const SWAY_GAIN = 0.34;
/** Sway impulse away from a hit, at strength 1. */
const SWAY_HIT = 3.2;
const SWAY_MAX = 0.2;

/** Noise wobble amplitudes, world units. */
const AMP_BASE = 0.06;
const AMP_IDLE = 0.05;
const AMP_EDGE = 0.045;
const AMP_JIGGLE = 0.11;
/** Seconds for the jiggle energy to fall to 1/e. */
const JIGGLE_DECAY = 0.17;
const FLASH_DECAY = 0.09;

const RIM_BASE = 0.55;
const RIM_DASH = 1.1;
const RIM_INVULNERABLE = 0.55;
const RIM_BRACE = 0.2;

/** Seconds per ground-ring pulse while bracing. */
const BRACE_PULSE_SECONDS = 0.7;

/** Motion scale applied to wobble, jiggle and stretch when reduce-motion is on. */
const REDUCED_MOTION = 0.4;
/** Springs are integrated in sub-steps no longer than this, so they stay stable. */
const MAX_SPRING_STEP = 1 / 120;

// ── small helpers ────────────────────────────────────────────────────────────

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export type Spring = { x: number; v: number };

/**
 * Damped harmonic spring toward `target` (semi-implicit Euler, sub-stepped).
 * `omega` is the natural frequency in rad/s, `zeta` the damping ratio.
 */
export function stepSpring(
  spring: Spring,
  target: number,
  omega: number,
  zeta: number,
  dt: number,
): void {
  if (dt <= 0) return;
  let steps = Math.ceil(dt / MAX_SPRING_STEP);
  if (steps > 16) steps = 16;
  const h = dt / steps;
  const k = omega * omega;
  const c = 2 * zeta * omega;
  for (let i = 0; i < steps; i++) {
    spring.v += (-k * (spring.x - target) - c * spring.v) * h;
    spring.x += spring.v * h;
  }
}

/** 3×3 matrices are flat, column-major (three.js `Matrix3.elements` layout). */
export type Mat3 = Float32Array | number[];

/**
 * Volume-preserving stretch by factor `k` along the unit axis (dx, dy, dz):
 * `k` along the axis, `1/√k` across it. Symmetric, determinant 1.
 */
export function stretchMatrix(out: Mat3, dx: number, dy: number, dz: number, k: number): Mat3 {
  const across = 1 / Math.sqrt(k);
  const g = k - across;
  out[0] = across + g * dx * dx;
  out[1] = g * dx * dy;
  out[2] = g * dx * dz;
  out[3] = out[1];
  out[4] = across + g * dy * dy;
  out[5] = g * dy * dz;
  out[6] = out[2];
  out[7] = out[5];
  out[8] = across + g * dz * dz;
  return out;
}

/** out = a · b. `out` must not alias `a` or `b`. */
export function multiplyMat3(out: Mat3, a: Mat3, b: Mat3): Mat3 {
  for (let col = 0; col < 3; col++) {
    const b0 = b[col * 3];
    const b1 = b[col * 3 + 1];
    const b2 = b[col * 3 + 2];
    out[col * 3] = a[0] * b0 + a[3] * b1 + a[6] * b2;
    out[col * 3 + 1] = a[1] * b0 + a[4] * b1 + a[7] * b2;
    out[col * 3 + 2] = a[2] * b0 + a[5] * b1 + a[8] * b2;
  }
  return out;
}

export function determinantMat3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

// ── pose ─────────────────────────────────────────────────────────────────────

/** Animation state of one wrestler plus the values the renderer reads back. */
export type Pose = {
  // state ───────────────────────────────────────────────────────────────────
  /** False until the first step after a reset: that step snaps instead of easing. */
  started: boolean;
  /** Phase offset so wrestlers never wobble or breathe in sync. */
  seed: number;
  /** Local animation clock (scaled seconds) for pulses and breathing. */
  clock: number;
  /** Smoothed world velocity that drives the stretch. */
  svx: number;
  svy: number;
  svz: number;
  /** Previous horizontal velocity, to turn accelerations into sway. */
  pvx: number;
  pvz: number;
  /** Log-scale height: exp(x) is the vertical scale. */
  squash: Spring;
  /** Log-scale length along the hit normal. */
  hit: Spring;
  /** World-space unit normal of the latest hit (points from the contact into the body). */
  hitNx: number;
  hitNy: number;
  hitNz: number;
  /** World-space sway of the top of the body. */
  swayX: Spring;
  swayZ: Spring;
  /** 0..1 wobble energy from recent hits and landings. */
  jiggle: number;
  /** 0..1 blends. */
  ground: number;
  edge: number;
  dash: number;
  brace: number;

  // outputs ─────────────────────────────────────────────────────────────────
  /** Visual heading, radians. */
  facing: number;
  /** Wobble clock for the noise (runs faster while jiggling). */
  time: number;
  /** Wobble amplitude, world units. */
  amp: number;
  /** Local-space squash & stretch matrix (column-major). */
  deform: Float32Array;
  /** Vertical offset that keeps the foot on the floor while grounded. */
  shift: number;
  /** Sway of the top of the body in local space. */
  swayLocalX: number;
  swayLocalZ: number;
  rim: number;
  opacity: number;
  beltGlow: number;
  /** 0..1 white flash right after an impact. */
  flash: number;
  /** Ground-ring pulse phase 0..1 while bracing, -1 when there is none. */
  pulse: number;
  /** Mean horizontal scale (for the blob shadow). */
  width: number;
  /** Vertical scale of the body. */
  height: number;
};

export function createPose(seed = 0): Pose {
  return {
    started: false,
    seed,
    clock: 0,
    svx: 0,
    svy: 0,
    svz: 0,
    pvx: 0,
    pvz: 0,
    squash: { x: 0, v: 0 },
    hit: { x: 0, v: 0 },
    hitNx: 0,
    hitNy: 0,
    hitNz: 1,
    swayX: { x: 0, v: 0 },
    swayZ: { x: 0, v: 0 },
    jiggle: 0,
    ground: 1,
    edge: 0,
    dash: 0,
    brace: 0,
    facing: 0,
    time: seed * 7.3,
    amp: AMP_BASE,
    deform: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    shift: 0,
    swayLocalX: 0,
    swayLocalZ: 0,
    rim: RIM_BASE,
    opacity: 1,
    beltGlow: 0,
    flash: 0,
    pulse: -1,
    width: 1,
    height: 1,
  };
}

/** Forget all motion (after a teleport, a respawn or while hidden). Keeps the clocks. */
export function resetPose(pose: Pose): void {
  pose.started = false;
  pose.svx = pose.svy = pose.svz = 0;
  pose.pvx = pose.pvz = 0;
  pose.squash.x = pose.squash.v = 0;
  pose.hit.x = pose.hit.v = 0;
  pose.swayX.x = pose.swayX.v = 0;
  pose.swayZ.x = pose.swayZ.v = 0;
  pose.jiggle = 0;
  pose.ground = 1;
  pose.edge = 0;
  pose.dash = 0;
  pose.brace = 0;
  pose.amp = AMP_BASE;
  pose.deform.fill(0);
  pose.deform[0] = pose.deform[4] = pose.deform[8] = 1;
  pose.shift = 0;
  pose.swayLocalX = pose.swayLocalZ = 0;
  pose.rim = RIM_BASE;
  pose.opacity = 1;
  pose.beltGlow = 0;
  pose.flash = 0;
  pose.pulse = -1;
  pose.width = 1;
  pose.height = 1;
}

// Scratch matrices for `stepPose` (module scope: nothing is allocated per frame).
const _vertical = new Float32Array(9);
const _stretch = new Float32Array(9);
const _hit = new Float32Array(9);
const _tmp = new Float32Array(9);

/**
 * Advance one wrestler's pose by `dt` scaled seconds from its runtime record and
 * refresh every output field.
 */
export function stepPose(
  pose: Pose,
  w: WrestlerRuntime,
  invulnerable: boolean,
  dt: number,
  reduceMotion: boolean,
): void {
  const motion = reduceMotion ? REDUCED_MOTION : 1;
  const idle = w.status === "idle";
  // A parked lobby body may carry stale velocities: an idle wrestler just stands.
  const vx = idle ? 0 : w.vx;
  const vy = idle ? 0 : w.vy;
  const vz = idle ? 0 : w.vz;
  const grounded = idle || w.grounded;

  pose.clock += dt;

  if (!pose.started) {
    pose.started = true;
    pose.facing = w.facing;
    pose.svx = vx;
    pose.svy = vy;
    pose.svz = vz;
    pose.pvx = vx;
    pose.pvz = vz;
    pose.ground = grounded ? 1 : 0;
    pose.opacity = invulnerable ? 0.6 : 1;
  } else {
    pose.facing = dampAngle(pose.facing, w.facing, FACING_SMOOTH, dt);
  }

  // ── blends ──────────────────────────────────────────────────────────────
  pose.svx = damp(pose.svx, vx, VELOCITY_SMOOTH, dt);
  pose.svy = damp(pose.svy, vy, VELOCITY_SMOOTH, dt);
  pose.svz = damp(pose.svz, vz, VELOCITY_SMOOTH, dt);
  pose.ground = damp(pose.ground, grounded ? 1 : 0, GROUND_SMOOTH, dt);
  pose.edge = damp(pose.edge, w.onEdge && !idle ? 1 : 0, EDGE_SMOOTH, dt);
  pose.dash = damp(pose.dash, w.dashing ? 1 : 0, DASH_SMOOTH, dt);
  pose.brace = damp(pose.brace, w.bracing ? 1 : 0, DASH_SMOOTH, dt);
  pose.jiggle *= Math.exp(-dt / JIGGLE_DECAY);
  pose.flash *= Math.exp(-dt / FLASH_DECAY);

  // ── sway: the base accelerates, the top of the drop follows late ────────
  if (!reduceMotion) {
    pose.swayX.v -= (vx - pose.pvx) * SWAY_GAIN;
    pose.swayZ.v -= (vz - pose.pvz) * SWAY_GAIN;
  }
  pose.pvx = vx;
  pose.pvz = vz;
  stepSpring(pose.swayX, 0, SWAY_OMEGA, SWAY_ZETA, dt);
  stepSpring(pose.swayZ, 0, SWAY_OMEGA, SWAY_ZETA, dt);
  const swayLength = Math.hypot(pose.swayX.x, pose.swayZ.x);
  if (swayLength > SWAY_MAX) {
    const s = SWAY_MAX / swayLength;
    pose.swayX.x *= s;
    pose.swayZ.x *= s;
  }

  // ── vertical squash: brace flattens, idle breathes, landings kick it ────
  let squashTarget = 0;
  if (w.bracing) squashTarget = BRACE_SQUASH;
  else if (idle && !reduceMotion) squashTarget = Math.sin(pose.clock * 1.9 + pose.seed * 2.4) * 0.024;
  stepSpring(pose.squash, squashTarget, SQUASH_OMEGA, SQUASH_ZETA, dt);
  pose.squash.x = clamp(pose.squash.x, SQUASH_MIN, SQUASH_MAX);
  stepSpring(pose.hit, 0, HIT_OMEGA, HIT_ZETA, dt);
  pose.hit.x = clamp(pose.hit.x, HIT_MIN, HIT_MAX);

  // ── stretch along the (smoothed) velocity: run, dash, knockback, drip ───
  const speed = Math.hypot(pose.svx, pose.svy, pose.svz);
  const u = speed / gameConfig.wrestler.maxSpeed;
  let stretch =
    STRETCH_RUN * Math.min(u, 1) + STRETCH_FAST * clamp(u - 1, 0, 2.5) + STRETCH_DASH * pose.dash * Math.min(u, 1);
  stretch = Math.min(stretch, STRETCH_MAX) * (reduceMotion ? 0.5 : 1);
  // A rooted wrestler does not smear, whatever shoves it.
  stretch *= 1 - 0.8 * pose.brace;

  // World → local rotation (by -facing about Y).
  const sin = Math.sin(pose.facing);
  const cos = Math.cos(pose.facing);

  const stretching = stretch > 1e-4 && speed > 1e-4;
  const wx = stretching ? pose.svx / speed : 0;
  const wy = stretching ? pose.svy / speed : 0;
  const wz = stretching ? pose.svz / speed : 0;

  let sy = Math.exp(pose.squash.x);
  // A drop smeared along the floor thins sideways more than it flattens (a torpedo,
  // not a pancake): give back part of the height the stretch takes, the more
  // horizontal the motion is. A vertical drip stays perfectly round in section.
  if (stretching) sy *= Math.pow(1 + stretch, HEIGHT_KEPT * (1 - wy * wy));
  const sxz = 1 / Math.sqrt(sy);
  _vertical.fill(0);
  _vertical[0] = sxz;
  _vertical[4] = sy;
  _vertical[8] = sxz;

  let deform: Mat3 = _vertical;
  if (stretching) {
    stretchMatrix(_stretch, wx * cos - wz * sin, wy, wx * sin + wz * cos, 1 + stretch);
    deform = multiplyMat3(_tmp, _stretch, _vertical);
  }
  if (Math.abs(pose.hit.x) > 1e-4) {
    stretchMatrix(
      _hit,
      pose.hitNx * cos - pose.hitNz * sin,
      pose.hitNy,
      pose.hitNx * sin + pose.hitNz * cos,
      Math.exp(pose.hit.x),
    );
    // `deform` is _vertical or _tmp here, never the output array.
    multiplyMat3(pose.deform, _hit, deform);
  } else {
    pose.deform.set(deform);
  }

  // ── derived outputs ─────────────────────────────────────────────────────
  const m = pose.deform;
  // A sphere of radius r mapped by M reaches r·|row_y(M)| below its centre.
  const reach = Math.hypot(m[1], m[4], m[7]);
  pose.shift = -BODY_RADIUS * (1 - reach) * pose.ground;
  pose.height = reach;
  pose.width = 0.5 * (Math.hypot(m[0], m[3], m[6]) + Math.hypot(m[2], m[5], m[8]));

  pose.swayLocalX = (pose.swayX.x * cos - pose.swayZ.x * sin) * motion;
  pose.swayLocalZ = (pose.swayX.x * sin + pose.swayZ.x * cos) * motion;

  const calm = idle ? AMP_IDLE : AMP_BASE;
  pose.amp = (calm + AMP_EDGE * pose.edge + AMP_JIGGLE * pose.jiggle) * motion * (1 - 0.45 * pose.brace);
  pose.time += dt * (1 + 0.9 * pose.edge + 2.2 * pose.jiggle);

  const rimTarget =
    RIM_BASE + RIM_DASH * pose.dash + RIM_BRACE * pose.brace + (invulnerable ? RIM_INVULNERABLE : 0);
  pose.rim = damp(pose.rim, rimTarget, 0.07, dt);

  let opacityTarget = 1;
  if (invulnerable) {
    opacityTarget = reduceMotion ? 0.62 : 0.56 + 0.16 * Math.sin(pose.clock * 9);
  }
  pose.opacity = damp(pose.opacity, opacityTarget, 0.09, dt);
  if (!invulnerable && pose.opacity > 0.995) pose.opacity = 1;

  const glowTarget = w.bracing ? (reduceMotion ? 0.9 : 0.85 + 0.3 * Math.sin(pose.clock * 11)) : 0;
  pose.beltGlow = damp(pose.beltGlow, glowTarget, 0.07, dt);

  if (w.bracing && !reduceMotion) {
    pose.pulse = pose.pulse < 0 ? 0 : (pose.pulse + dt / BRACE_PULSE_SECONDS) % 1;
  } else if (pose.pulse >= 0) {
    // Let the ring in flight finish instead of popping off.
    pose.pulse += dt / BRACE_PULSE_SECONDS;
    if (pose.pulse >= 1) pose.pulse = -1;
  }
}

// ── event kicks ──────────────────────────────────────────────────────────────

/**
 * An impact. (nx, ny, nz) is the world-space direction from the contact point into
 * this wrestler's body (need not be normalised); `strength` is 0..1.
 */
export function kickHit(
  pose: Pose,
  nx: number,
  ny: number,
  nz: number,
  strength: number,
  braced: boolean,
  reduceMotion: boolean,
): void {
  const length = Math.hypot(nx, ny, nz);
  if (length > 1e-5) {
    pose.hitNx = nx / length;
    pose.hitNy = ny / length;
    pose.hitNz = nz / length;
  }
  const s = clamp(strength, 0, 1);
  // A braced body is heavy: it barely gives.
  const give = (braced ? 0.4 : 1) * (reduceMotion ? REDUCED_MOTION : 1);
  pose.hit.v -= (4.5 + 13 * s) * give;
  pose.jiggle = Math.min(1, pose.jiggle + (0.3 + 0.7 * s) * give);
  if (!reduceMotion) {
    pose.flash = Math.max(pose.flash, (0.25 + 0.75 * s) * (braced ? 0.5 : 1));
    pose.swayX.v += pose.hitNx * SWAY_HIT * s * give;
    pose.swayZ.v += pose.hitNz * SWAY_HIT * s * give;
  }
}

/** Touchdown at `speed` units/s: squash flat, then spring back with an overshoot. */
export function kickLand(pose: Pose, speed: number, reduceMotion: boolean): void {
  const scale = reduceMotion ? REDUCED_MOTION : 1;
  pose.squash.v -= clamp(speed * 1.6, 5, 24) * scale;
  pose.jiggle = Math.min(1, pose.jiggle + 0.55 * scale);
}

/** Dash launch: a small shiver on top of the stretch. */
export function kickDash(pose: Pose, reduceMotion: boolean): void {
  if (reduceMotion) return;
  pose.jiggle = Math.min(1, pose.jiggle + 0.3);
}

/** Brace pressed / released: drop with weight, pop back up on release. */
export function kickBrace(pose: Pose, on: boolean, reduceMotion: boolean): void {
  if (on) {
    pose.squash.v -= reduceMotion ? 1 : 3.5;
    if (!reduceMotion) pose.pulse = 0;
  } else {
    pose.squash.v += reduceMotion ? 0.8 : 2.5;
    pose.jiggle = Math.min(1, pose.jiggle + (reduceMotion ? 0.1 : 0.3));
  }
}
