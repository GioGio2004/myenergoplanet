// Pure animation curves for cracking and falling island pieces. No three.js.
//
// A pose is an offset from the piece's resting place: a translation, one rotation
// about the item's tumble axis, a uniform scale and two colour blends.

import { clamp } from "../../math";

const TAU = Math.PI * 2;

export type CrumblePose = {
  dx: number;
  dy: number;
  dz: number;
  /** Rotation about the item's tumble axis, radians. */
  angle: number;
  scale: number;
  /** 0..1 blend from the resting colour toward the "cracked" colour. */
  shade: number;
  /** 0..1 blend toward the "dissolved into ink" colour. */
  fade: number;
};

export function createPose(): CrumblePose {
  return { dx: 0, dy: 0, dz: 0, angle: 0, scale: 1, shade: 0, fade: 0 };
}

/** Random numbers stored per item (see `R_*` offsets). */
export const CRUMBLE_RAND_STRIDE = 8;
const R_PHASE_X = 0;
const R_PHASE_Z = 1;
const R_PHASE_Y = 2;
const R_PHASE_TILT = 3;
const R_DELAY = 4;
const R_DRIFT = 5;
const R_SPIN = 6;
const R_SHADE = 7;

// ── warning shake ────────────────────────────────────────────────────────────
/** Sideways shake amplitude at full intensity, world units (about the gap between tiles). */
const SHAKE_AMPLITUDE = 0.045;
/** Tilt amplitude at full intensity, radians (≈ 2.5 cm at a tile's edge). */
const SHAKE_TILT = 0.034;
/** Cracking pieces sag by this much, so a tilted edge never pokes above the floor. */
const SHAKE_SINK = 0.028;
/** ...and bob further down by up to this much. */
const SHAKE_BOB = 0.02;
/** Shake speed, radians per second, at the start and at the end of the warning. */
const SHAKE_FREQ_START = 15;
const SHAKE_FREQ_END = 34;

// ── fall ─────────────────────────────────────────────────────────────────────
/** Pieces let go one after another over this long. */
export const FALL_MAX_DELAY = 0.35;
/** Floatier than the wrestlers' gravity so the collapse reads from across a room. */
const FALL_GRAVITY = 16;
/** Depth below the resting place at which a piece has shrunk to nothing. */
export const FALL_DEPTH = 12;
const FALL_SHRINK_START = 4;
/** Never exactly zero: a zero scale would put NaNs into the instance normal matrix. */
export const MIN_SCALE = 1e-4;
/** Reduced motion: pieces sink a little and shrink away instead of tumbling. */
const CALM_FALL_SECONDS = 0.7;
const CALM_FALL_SINK = 1.2;

/** Seconds after a drop by which every piece of the group has vanished. */
export const FALL_SECONDS = FALL_MAX_DELAY + Math.sqrt((2 * FALL_DEPTH) / FALL_GRAVITY) + 0.05;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Shake speed (radians per second) for a warning that is `level` (0..1) of the way through. */
export function shakeFrequency(level: number): number {
  return SHAKE_FREQ_START + (SHAKE_FREQ_END - SHAKE_FREQ_START) * clamp(level, 0, 1);
}

/**
 * Pose of a cracking piece. `level` is 0..1 through the warning, `phase` the accumulated
 * shake phase of its group (radians), `rand[o ..]` the item's random numbers.
 * Overwrites every field of `out`.
 */
export function writeWarnPose(
  out: CrumblePose,
  level: number,
  phase: number,
  rand: Float32Array,
  o: number,
  reduceMotion: boolean,
): void {
  const t = clamp(level, 0, 1);
  out.scale = 1;
  out.fade = 0;

  if (t <= 0) {
    out.dx = 0;
    out.dy = 0;
    out.dz = 0;
    out.angle = 0;
    out.shade = 0;
    return;
  }

  // The colour change carries the warning on its own when motion is reduced.
  const baseShade = 0.16 + 0.44 * t + 0.08 * (rand[o + R_SHADE] - 0.5);
  if (reduceMotion) {
    out.dx = 0;
    out.dz = 0;
    out.dy = -SHAKE_SINK * t;
    out.angle = 0;
    out.shade = clamp(baseShade + 0.05, 0, 1);
    return;
  }

  // A small jolt right away, then building: the eye catches the start and the urgency.
  const intensity = 0.2 + 0.8 * t * t;
  out.dx = SHAKE_AMPLITUDE * intensity * Math.sin(phase + rand[o + R_PHASE_X] * TAU);
  out.dz = SHAKE_AMPLITUDE * intensity * Math.sin(phase * 1.31 + rand[o + R_PHASE_Z] * TAU);
  // Only ever downward, so wrestlers never appear to sink into a risen tile.
  out.dy =
    -intensity *
    (SHAKE_SINK + SHAKE_BOB * (0.5 + 0.5 * Math.sin(phase * 0.77 + rand[o + R_PHASE_Y] * TAU)));
  out.angle = SHAKE_TILT * intensity * Math.sin(phase * 0.9 + rand[o + R_PHASE_TILT] * TAU);
  const pulse = 0.5 + 0.5 * Math.sin(phase * 0.5 + rand[o + R_PHASE_Y] * TAU);
  out.shade = clamp(baseShade + 0.12 * intensity * pulse, 0, 1);
}

/**
 * Turn a warning pose into a falling one, `t` seconds after its group dropped.
 * Until the item's own delay has passed the pose is left alone (it keeps shaking),
 * so the hand-over from shake to fall is continuous.
 * `outX`/`outZ` is the item's unit drift direction.
 */
export function applyFall(
  out: CrumblePose,
  t: number,
  rand: Float32Array,
  o: number,
  outX: number,
  outZ: number,
  reduceMotion: boolean,
): void {
  if (reduceMotion) {
    const p = smoothstep(0, CALM_FALL_SECONDS, t);
    out.dy -= CALM_FALL_SINK * p;
    out.scale = Math.max(MIN_SCALE, 1 - p);
    out.fade = p;
    out.shade = Math.max(out.shade, 0.6 * p);
    return;
  }

  const tf = t - rand[o + R_DELAY] * FALL_MAX_DELAY;
  if (tf <= 0) return;

  // The shake dies away as the piece lets go.
  const settle = Math.exp(-8 * tf);
  out.dx *= settle;
  out.dy *= settle;
  out.dz *= settle;
  out.angle *= settle;

  const depth = 0.5 * FALL_GRAVITY * tf * tf;
  const drift = (0.5 + 0.9 * rand[o + R_DRIFT]) * tf;
  out.dx += outX * drift;
  out.dz += outZ * drift;
  out.dy -= depth;
  // Eases in from rest, then spins at a steady rate.
  const spin = 0.8 + 2.4 * rand[o + R_SPIN];
  out.angle += (spin * tf * tf) / (tf + 0.25);
  out.scale = Math.max(MIN_SCALE, 1 - smoothstep(FALL_SHRINK_START, FALL_DEPTH, depth));
  out.fade = smoothstep(1.5, FALL_DEPTH * 0.8, depth);
  out.shade = Math.max(out.shade, 0.6 * Math.min(1, tf * 6));
}
