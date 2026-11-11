// ─────────────────────────────────────────────────────────────────────────────
// Liquid Sumo — pure movement / combat maths.
//
// No React, no three.js, no Rapier: everything here works on plain numbers and
// caller-owned scratch objects, so it never allocates and can be unit-tested in Node.
// The physics driver (driver.ts) feeds these helpers and applies their results to
// the Rapier bodies.
//
// Knockback is expressed as a change of VELOCITY (Δv). The matching impulse is
// `body mass × Δv`; working in Δv keeps "a braced wrestler takes 25 % of the
// knockback" true no matter how heavy bracing makes the body.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp, type Vec2 } from "../math";

// ── tuning that is local to the physics layer ────────────────────────────────
// (Everything a designer would normally touch lives in game/config.ts.)

export const PHYSICS_TUNING = {
  /** Share of the ground acceleration available while airborne. */
  airControl: 0.25,
  /** Share of the steering available in the middle of a dash. */
  dashSteering: 0.15,
  /**
   * Share of the stick acceleration spent on killing sideways drift. 0 = pure ice
   * (old velocity never turns), 1 = car-like grip. Low on purpose: sumo should slide.
   */
  lateralGrip: 0.4,
  /** Extra knockback a wrestler takes for dashing into a braced opponent. */
  braceReboundMultiplier: 1.6,
  /** Share of the knockback a dasher takes when it hits somebody who is not braced. */
  dashWinnerRecoil: 0.2,
  /** Upward pop on a hit, as a share of the horizontal knockback Δv … */
  hopFraction: 0.12,
  /** … capped here (units/s). 2.2 lifts a wrestler about 0.1 units: juice, never a launch. */
  hopMaxSpeed: 2.2,
  /** How far above / below its resting height a body still counts as standing. */
  groundTolerance: 0.07,
  /** A body rising faster than this (units/s) has left the ground even if it is still low. */
  groundMaxRiseSpeed: 1,
  /** A body whose centre is this far past the rim is already tipping off. */
  rimGrace: 0.05,
} as const;

// ── stepping ─────────────────────────────────────────────────────────────────

/**
 * Number of equal sub-steps for one rendered frame of `scaledDt` simulated seconds:
 * the fewest steps that keep each one at or below `1 / hz`, capped at `maxSteps`.
 * Returns 0 when no time passes (hit-stop, a zero delta).
 */
export function substepCount(scaledDt: number, hz: number, maxSteps: number): number {
  if (!(scaledDt > 1e-7) || !Number.isFinite(scaledDt)) return 0;
  // The small epsilon keeps a frame of exactly n/hz seconds from rounding up to n + 1.
  const n = Math.ceil(scaledDt * hz - 1e-6);
  return clamp(n, 1, Math.max(1, maxSteps));
}

/** Length of each of `count` sub-steps. Never longer than `1 / hz`: when the cap bites, time is dropped. */
export function substepDt(scaledDt: number, count: number, hz: number): number {
  if (count <= 0) return 0;
  return Math.min(scaledDt / count, 1 / hz);
}

// ── stick ────────────────────────────────────────────────────────────────────

export type Stick = { x: number; y: number };

/**
 * Radial deadzone with rescale: magnitudes up to `deadzone` read as zero, the rest is
 * stretched back onto 0..1 so the stick starts gently right past the deadzone. Keeps the
 * direction, clamps the magnitude to 1. Writes into `out` and returns the new magnitude.
 */
export function applyDeadzone(x: number, y: number, deadzone: number, out: Stick): number {
  const magnitude = Math.sqrt(x * x + y * y);
  if (!Number.isFinite(magnitude) || magnitude <= deadzone || magnitude <= 0) {
    out.x = 0;
    out.y = 0;
    return 0;
  }
  const scaled = Math.min(1, (magnitude - deadzone) / Math.max(1 - deadzone, 1e-6));
  const k = scaled / magnitude;
  out.x = x * k;
  out.y = y * k;
  return scaled;
}

// ── steering ─────────────────────────────────────────────────────────────────

export type SteerTuning = {
  readonly moveAcceleration: number;
  readonly maxSpeed: number;
};

/** How much of the stick acceleration a wrestler gets in its current state. */
export function steeringControl(grounded: boolean, dashing: boolean): number {
  return (grounded ? 1 : PHYSICS_TUNING.airControl) * (dashing ? PHYSICS_TUNING.dashSteering : 1);
}

/**
 * Velocity change for one step of steering.
 *
 * - Accelerates along the stick, but only until the velocity component ALONG the stick
 *   reaches `maxSpeed × tilt`. Speed beyond that (knockback, a dash) is left alone:
 *   the cap stops adding speed, it never removes any.
 * - Pushing against the current motion always gets the full acceleration (braking).
 * - A share of the acceleration (`lateralGrip`) bleeds off sideways drift, never past zero.
 *
 * `stickX/Z` is the world-space stick (magnitude 0..1 = tilt). `control` scales the
 * acceleration (air control, dash). Writes the Δv into `out` and returns it.
 */
export function steerDeltaV(
  vx: number,
  vz: number,
  stickX: number,
  stickZ: number,
  tuning: SteerTuning,
  control: number,
  dt: number,
  out: Vec2,
): Vec2 {
  out.x = 0;
  out.z = 0;
  const magnitude = Math.sqrt(stickX * stickX + stickZ * stickZ);
  if (!(magnitude > 1e-6) || !(control > 0) || !(dt > 0)) return out;

  const tilt = magnitude > 1 ? 1 : magnitude;
  const dirX = stickX / magnitude;
  const dirZ = stickZ / magnitude;
  const budget = tuning.moveAcceleration * tilt * control * dt;

  const along = vx * dirX + vz * dirZ;
  const room = tuning.maxSpeed * tilt - along;
  const push = room > 0 ? Math.min(budget, room) : 0;

  const sideX = vx - along * dirX;
  const sideZ = vz - along * dirZ;
  const side = Math.sqrt(sideX * sideX + sideZ * sideZ);
  const grip = side > 1e-6 ? Math.min(budget * PHYSICS_TUNING.lateralGrip, side) / side : 0;

  out.x = dirX * push - sideX * grip;
  out.z = dirZ * push - sideZ * grip;
  return out;
}

// ── dash / brace state machine ───────────────────────────────────────────────

/** The action fields of a `WrestlerRuntime` (which is structurally an `ActionState`). */
export type ActionState = {
  dashing: boolean;
  dashTimeLeft: number;
  dashCooldownLeft: number;
  bracing: boolean;
  braceTimeLeft: number;
  braceCooldownLeft: number;
};

/** What the state machine remembers between steps besides the public action fields. */
export type ActionMemory = {
  /** The dash button was down on the previous step (for press-edge detection). */
  dashHeld: boolean;
};

export type ActionTuning = {
  readonly dash: { readonly durationSeconds: number; readonly cooldownSeconds: number };
  readonly brace: { readonly maxHoldSeconds: number; readonly cooldownSeconds: number };
};

/** Bit flags returned by `stepActions`. */
export const ACTION_DASH_STARTED = 1;
export const ACTION_DASH_ENDED = 2;
export const ACTION_BRACE_ON = 4;
export const ACTION_BRACE_OFF = 8;

/**
 * Advance one wrestler's dash / brace state by `dt` and react to the held buttons.
 *
 * Rules:
 * - Timers tick first, so an action that starts this step keeps its full duration.
 * - BRACE: active while the button is held, for at most `maxHoldSeconds`. Needs footing
 *   (`canBrace`), cannot start during a dash or its own cooldown. Letting go, running out
 *   of time or losing footing ends it and starts the cooldown.
 * - DASH: fires on the PRESS edge only (holding does not repeat), never while bracing or
 *   cooling down. A press that is refused is not remembered.
 * - Brace is resolved before dash: pressing both on the same step roots the wrestler.
 *
 * Mutates `state` and `memory`; returns a combination of the `ACTION_*` flags.
 */
export function stepActions(
  state: ActionState,
  memory: ActionMemory,
  dashHeld: boolean,
  braceHeld: boolean,
  canBrace: boolean,
  dt: number,
  tuning: ActionTuning,
): number {
  let flags = 0;

  // Timers.
  if (state.dashCooldownLeft > 0) state.dashCooldownLeft = Math.max(0, state.dashCooldownLeft - dt);
  if (state.braceCooldownLeft > 0) state.braceCooldownLeft = Math.max(0, state.braceCooldownLeft - dt);
  if (state.dashing) {
    state.dashTimeLeft -= dt;
    if (state.dashTimeLeft <= 1e-9) {
      state.dashing = false;
      state.dashTimeLeft = 0;
      flags |= ACTION_DASH_ENDED;
    }
  }

  // Brace.
  if (state.bracing) {
    state.braceTimeLeft -= dt;
    if (!braceHeld || !canBrace || state.braceTimeLeft <= 1e-9) {
      state.bracing = false;
      state.braceTimeLeft = 0;
      state.braceCooldownLeft = tuning.brace.cooldownSeconds;
      flags |= ACTION_BRACE_OFF;
    }
  } else if (braceHeld && canBrace && !state.dashing && state.braceCooldownLeft <= 0) {
    state.bracing = true;
    state.braceTimeLeft = tuning.brace.maxHoldSeconds;
    flags |= ACTION_BRACE_ON;
  }

  // Dash.
  if (dashHeld && !memory.dashHeld && !state.bracing && !state.dashing && state.dashCooldownLeft <= 0) {
    state.dashing = true;
    state.dashTimeLeft = tuning.dash.durationSeconds;
    state.dashCooldownLeft = tuning.dash.cooldownSeconds;
    flags |= ACTION_DASH_STARTED;
  }
  memory.dashHeld = dashHeld;

  return flags;
}

/** Back to "nothing happening, nothing cooling down" (spawn, respawn, parked). */
export function resetActions(state: ActionState, memory: ActionMemory): void {
  state.dashing = false;
  state.dashTimeLeft = 0;
  state.dashCooldownLeft = 0;
  state.bracing = false;
  state.braceTimeLeft = 0;
  state.braceCooldownLeft = 0;
  memory.dashHeld = false;
}

export type DashTuning = {
  readonly speedMultiplier: number;
  readonly durationSeconds: number;
};

/**
 * Horizontal velocity multiplier for one step of an uninterrupted dash.
 *
 * A dash launches at `maxSpeed × speedMultiplier`. Left to the body's ordinary damping
 * it would still be far above walking speed when the dash ends and carry the wrestler
 * off the island. This extra drag, together with the damping the body currently has
 * (`bodyDamping`, 0 in the air), eases the lunge out so it arrives back at `maxSpeed`
 * exactly when the dash timer runs out: a quick weighted pounce, not a runaway slide.
 */
export function dashDragFactor(dash: DashTuning, bodyDamping: number, dt: number): number {
  if (!(dash.durationSeconds > 0) || !(dash.speedMultiplier > 1)) return 1;
  const totalRate = Math.log(dash.speedMultiplier) / dash.durationSeconds;
  const extraRate = totalRate - bodyDamping;
  return extraRate > 0 ? Math.exp(-extraRate * dt) : 1;
}

// ── standing on the island ───────────────────────────────────────────────────

/**
 * True when a body is standing on the island: its centre is over the walkable disc,
 * at resting height, and it is not on its way up.
 * `radial` is the horizontal distance from the island centre.
 */
export function isGrounded(
  y: number,
  vy: number,
  radial: number,
  arenaRadius: number,
  bodyRadius: number,
): boolean {
  return (
    radial <= arenaRadius + PHYSICS_TUNING.rimGrace &&
    y <= bodyRadius + PHYSICS_TUNING.groundTolerance &&
    y >= bodyRadius - PHYSICS_TUNING.groundTolerance * 2 &&
    vy <= PHYSICS_TUNING.groundMaxRiseSpeed
  );
}

/** Heading (radians, `atan2(x, z)`) that looks from (x, z) at the island centre. */
export function headingToCentre(x: number, z: number, fallback: number): number {
  return x * x + z * z > 1e-8 ? Math.atan2(-x, -z) : fallback;
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  let a = angle % turn;
  if (a > Math.PI) a -= turn;
  else if (a <= -Math.PI) a += turn;
  return a;
}

// ── impacts ──────────────────────────────────────────────────────────────────

/** Index of the unordered slot pair (a, b), a ≠ b, in a table of `pairCount(slots)` entries. */
export function pairIndex(a: number, b: number, slots: number): number {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return (lo * (2 * slots - lo - 1)) / 2 + (hi - lo - 1);
}

export function pairCount(slots: number): number {
  return (slots * (slots - 1)) / 2;
}

export type KnockbackTuning = {
  readonly dash: { readonly knockbackMultiplier: number };
  readonly brace: { readonly knockbackTaken: number };
};

/**
 * How much of the base knockback one wrestler (the receiver) takes from an impact.
 *
 * | receiver \ other | plain              | dashing             | bracing            |
 * |------------------|--------------------|---------------------|--------------------|
 * | plain            | 1                  | × dash multiplier   | 1                  |
 * | dashing          | × winner recoil    | × dash multiplier   | × brace rebound    |
 * | bracing          | × brace taken      | × both              | × brace taken      |
 *
 * So: a dasher sends a plain opponent flying and barely recoils itself (it wins the
 * exchange); a dasher that runs into a braced opponent bounces off harder than the
 * bracer moves; two dashers clash and both fly.
 */
export function knockbackScale(
  receiverDashing: boolean,
  receiverBracing: boolean,
  otherDashing: boolean,
  otherBracing: boolean,
  tuning: KnockbackTuning,
): number {
  let scale = 1;
  if (otherDashing) scale *= tuning.dash.knockbackMultiplier;
  if (receiverBracing) scale *= tuning.brace.knockbackTaken;
  if (receiverDashing) {
    if (otherBracing) scale *= PHYSICS_TUNING.braceReboundMultiplier;
    else if (!otherDashing) scale *= PHYSICS_TUNING.dashWinnerRecoil;
  }
  return scale;
}

export type ImpactTuning = KnockbackTuning & {
  readonly restitution: number;
  readonly hit: {
    readonly knockbackPerSpeed: number;
    readonly popImpulse: number;
    readonly bigImpactSpeed: number;
  };
};

/** One fresh impact between wrestlers A and B. Reused scratch object, filled by the driver. */
export type ImpactInput = {
  /** Unit contact normal pointing from A's centre to B's centre. */
  nx: number;
  ny: number;
  nz: number;
  /** Closing speed along the normal BEFORE this step's solve (> 0 = approaching). */
  approach: number;
  /** Closing speed along the normal AFTER this step's solve (≤ 0 once the solver has bounced them). */
  closing: number;
  /** Current masses (a braced wrestler is heavier). */
  massA: number;
  massB: number;
  aDashing: boolean;
  aBracing: boolean;
  bDashing: boolean;
  bBracing: boolean;
};

/** Velocity changes to apply to A and B, plus the 0..1 strength for the `hit` event. */
export type ImpactOutput = {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  strength: number;
};

/**
 * Response to a fresh wrestler-vs-wrestler impact, on top of the physics engine's own.
 *
 * 1. If the bodies are still closing after the step (they overlapped inside this step and
 *    the solver has not seen the contact yet), apply the ordinary restitution bounce now.
 *    Otherwise the knockback below would turn them around first and the engine's bounce
 *    would silently be skipped — a hit would feel different depending on sub-step timing.
 * 2. Add the game's knockback: `popImpulse + knockbackPerSpeed × approach` (the approach
 *    speed saturates at `bigImpactSpeed`, where `strength` reaches 1), scaled per receiver
 *    by `knockbackScale`. It pushes horizontally, away from the other wrestler.
 * 3. Add a small upward pop to whoever is not braced.
 */
export function resolveImpact(input: ImpactInput, tuning: ImpactTuning, out: ImpactOutput): ImpactOutput {
  const { nx, ny, nz } = input;
  let ax = 0;
  let ay = 0;
  let az = 0;
  let bx = 0;
  let by = 0;
  let bz = 0;

  if (input.closing > 0 && input.massA > 0 && input.massB > 0) {
    const j = ((1 + tuning.restitution) * input.closing) / (1 / input.massA + 1 / input.massB);
    const da = j / input.massA;
    const db = j / input.massB;
    ax -= nx * da;
    ay -= ny * da;
    az -= nz * da;
    bx += nx * db;
    by += ny * db;
    bz += nz * db;
  }

  const hit = tuning.hit;
  const speed = clamp(input.approach, 0, hit.bigImpactSpeed);
  const base = hit.popImpulse + hit.knockbackPerSpeed * speed;
  const ka = base * knockbackScale(input.aDashing, input.aBracing, input.bDashing, input.bBracing, tuning);
  const kb = base * knockbackScale(input.bDashing, input.bBracing, input.aDashing, input.aBracing, tuning);
  // Horizontal part of the normal only: a wrestler landing on top of another must not
  // drive it into the floor or launch itself.
  ax -= nx * ka;
  az -= nz * ka;
  bx += nx * kb;
  bz += nz * kb;

  const flat = Math.sqrt(nx * nx + nz * nz);
  if (!input.aBracing) ay += Math.min(PHYSICS_TUNING.hopMaxSpeed, PHYSICS_TUNING.hopFraction * ka * flat);
  if (!input.bBracing) by += Math.min(PHYSICS_TUNING.hopMaxSpeed, PHYSICS_TUNING.hopFraction * kb * flat);

  out.ax = ax;
  out.ay = ay;
  out.az = az;
  out.bx = bx;
  out.by = by;
  out.bz = bz;
  out.strength = hit.bigImpactSpeed > 0 ? clamp(input.approach / hit.bigImpactSpeed, 0, 1) : 1;
  return out;
}
