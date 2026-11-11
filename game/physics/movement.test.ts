import { describe, expect, it } from "vitest";
import { gameConfig } from "../config";
import {
  ACTION_BRACE_OFF,
  ACTION_BRACE_ON,
  ACTION_DASH_ENDED,
  ACTION_DASH_STARTED,
  PHYSICS_TUNING,
  applyDeadzone,
  dashDragFactor,
  headingToCentre,
  isGrounded,
  knockbackScale,
  pairCount,
  pairIndex,
  resetActions,
  resolveImpact,
  steerDeltaV,
  steeringControl,
  stepActions,
  substepCount,
  substepDt,
  wrapAngle,
  type ActionMemory,
  type ActionState,
  type ImpactInput,
  type ImpactOutput,
} from "./movement";

const W = gameConfig.wrestler;
const DT = 1 / 60;

function freshState(): ActionState & ActionMemory {
  return {
    dashing: false,
    dashTimeLeft: 0,
    dashCooldownLeft: 0,
    bracing: false,
    braceTimeLeft: 0,
    braceCooldownLeft: 0,
    dashHeld: false,
  };
}

/** Step the state machine with constant buttons for `seconds`; returns every flag seen, OR-ed. */
function hold(
  s: ActionState & ActionMemory,
  seconds: number,
  dash: boolean,
  brace: boolean,
  canBrace = true,
): number {
  let seen = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) seen |= stepActions(s, s, dash, brace, canBrace, DT, W);
  return seen;
}

describe("substepCount / substepDt", () => {
  it("uses the fewest steps that keep each one at or below 1/hz", () => {
    expect(substepCount(1 / 60, 60, 5)).toBe(1);
    expect(substepCount(1 / 144, 60, 5)).toBe(1);
    expect(substepCount(1 / 60 + 0.001, 60, 5)).toBe(2);
    expect(substepCount(1 / 30, 60, 5)).toBe(2);
    expect(substepCount(0.05, 60, 5)).toBe(3);
  });

  it("returns 0 when no time passes", () => {
    expect(substepCount(0, 60, 5)).toBe(0);
    expect(substepCount(-1, 60, 5)).toBe(0);
    expect(substepCount(Number.NaN, 60, 5)).toBe(0);
  });

  it("caps the number of steps and then drops time instead of taking long steps", () => {
    expect(substepCount(0.1, 60, 5)).toBe(5);
    expect(substepDt(0.1, 5, 60)).toBeCloseTo(1 / 60, 10);
    expect(substepDt(1 / 30, 2, 60)).toBeCloseTo(1 / 60, 10);
    expect(substepDt(0.02, 2, 60)).toBeCloseTo(0.01, 10);
    expect(substepDt(0.02, 0, 60)).toBe(0);
  });

  it("splits slow motion into one short step", () => {
    const scaled = (1 / 60) * 0.3;
    expect(substepCount(scaled, 60, 5)).toBe(1);
    expect(substepDt(scaled, 1, 60)).toBeCloseTo(scaled, 12);
  });
});

describe("applyDeadzone", () => {
  const out = { x: 0, y: 0 };

  it("zeroes everything inside the deadzone", () => {
    expect(applyDeadzone(0.1, 0.05, 0.15, out)).toBe(0);
    expect(out).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(0, 0, 0.15, out)).toBe(0);
  });

  it("starts near zero just past the deadzone and reaches 1 at full tilt", () => {
    expect(applyDeadzone(0.16, 0, 0.15, out)).toBeCloseTo(0.01 / 0.85, 6);
    expect(out.x).toBeCloseTo(0.01 / 0.85, 6);
    expect(applyDeadzone(0, 1, 0.15, out)).toBeCloseTo(1, 10);
    expect(out.y).toBeCloseTo(1, 10);
    expect(applyDeadzone(0, -0.575, 0.15, out)).toBeCloseTo(0.5, 10);
    expect(out.y).toBeCloseTo(-0.5, 10);
  });

  it("keeps the direction and clamps the magnitude to 1", () => {
    // Keyboard diagonal: (1, 1) has magnitude √2.
    expect(applyDeadzone(1, 1, 0.15, out)).toBe(1);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1, 10);
    expect(out.x).toBeCloseTo(out.y, 10);
    applyDeadzone(-0.3, 0.4, 0.15, out);
    expect(Math.atan2(out.y, out.x)).toBeCloseTo(Math.atan2(0.4, -0.3), 10);
  });

  it("treats non-finite input as neutral", () => {
    expect(applyDeadzone(Number.NaN, 1, 0.15, out)).toBe(0);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});

describe("steerDeltaV", () => {
  const out = { x: 0, z: 0 };

  it("accelerates along the stick at moveAcceleration", () => {
    steerDeltaV(0, 0, 1, 0, W, 1, DT, out);
    expect(out.x).toBeCloseTo(W.moveAcceleration * DT, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it("does nothing without stick input, control or time", () => {
    expect(steerDeltaV(3, 2, 0, 0, W, 1, DT, out)).toEqual({ x: 0, z: 0 });
    expect(steerDeltaV(3, 2, 1, 0, W, 0, DT, out)).toEqual({ x: 0, z: 0 });
    expect(steerDeltaV(3, 2, 1, 0, W, 1, 0, out)).toEqual({ x: 0, z: 0 });
  });

  it("never pushes the speed along the stick past maxSpeed", () => {
    let vx = 0;
    for (let i = 0; i < 600; i++) {
      steerDeltaV(vx, 0, 1, 0, W, 1, DT, out);
      vx += out.x;
      expect(vx).toBeLessThanOrEqual(W.maxSpeed + 1e-9);
    }
    expect(vx).toBeCloseTo(W.maxSpeed, 9);
  });

  it("lands exactly on the cap instead of overshooting it", () => {
    steerDeltaV(W.maxSpeed - 0.1, 0, 1, 0, W, 1, DT, out);
    expect(out.x).toBeCloseTo(0.1, 10);
  });

  it("does not clamp knockback: speed above the cap is left alone", () => {
    const knockback = W.maxSpeed * 4;
    steerDeltaV(knockback, 0, 1, 0, W, 1, DT, out);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
  });

  it("brakes with the full acceleration when pushing against the motion", () => {
    steerDeltaV(20, 0, -1, 0, W, 1, DT, out);
    expect(out.x).toBeCloseTo(-W.moveAcceleration * DT, 10);
  });

  it("scales the top speed with the stick tilt", () => {
    let vx = 0;
    for (let i = 0; i < 600; i++) {
      steerDeltaV(vx, 0, 0.5, 0, W, 1, DT, out);
      vx += out.x;
    }
    expect(vx).toBeCloseTo(W.maxSpeed * 0.5, 9);
  });

  it("bleeds sideways drift with only a share of the acceleration, never past zero", () => {
    // Sliding along +z, steering along +x.
    steerDeltaV(0, 4, 1, 0, W, 1, DT, out);
    expect(out.x).toBeCloseTo(W.moveAcceleration * DT, 10);
    expect(out.z).toBeCloseTo(-W.moveAcceleration * DT * PHYSICS_TUNING.lateralGrip, 10);
    // A tiny drift is removed exactly, not reversed.
    steerDeltaV(0, 0.01, 1, 0, W, 1, DT, out);
    expect(out.z).toBeCloseTo(-0.01, 10);
  });

  it("turning is slidey: the old velocity outlives a 90° turn for several steps", () => {
    let vx = 0;
    let vz = W.maxSpeed;
    for (let i = 0; i < 6; i++) {
      steerDeltaV(vx, vz, 1, 0, W, 1, DT, out);
      vx += out.x;
      vz += out.z;
    }
    expect(vz).toBeGreaterThan(W.maxSpeed * 0.7);
    expect(vx).toBeGreaterThan(0);
  });

  it("gives reduced control in the air and during a dash", () => {
    expect(steeringControl(true, false)).toBe(1);
    expect(steeringControl(false, false)).toBe(PHYSICS_TUNING.airControl);
    expect(steeringControl(true, true)).toBe(PHYSICS_TUNING.dashSteering);
    expect(steeringControl(false, true)).toBeCloseTo(PHYSICS_TUNING.airControl * PHYSICS_TUNING.dashSteering, 12);
    steerDeltaV(0, 0, 1, 0, W, steeringControl(false, false), DT, out);
    expect(out.x).toBeCloseTo(W.moveAcceleration * DT * PHYSICS_TUNING.airControl, 10);
  });
});

describe("dash", () => {
  it("fires on the press edge and runs for durationSeconds", () => {
    const s = freshState();
    expect(stepActions(s, s, true, false, true, DT, W) & ACTION_DASH_STARTED).toBeTruthy();
    expect(s.dashing).toBe(true);
    expect(s.dashTimeLeft).toBeCloseTo(W.dash.durationSeconds, 10);
    expect(s.dashCooldownLeft).toBeCloseTo(W.dash.cooldownSeconds, 10);

    const seen = hold(s, W.dash.durationSeconds - 2 * DT, false, false);
    expect(seen & ACTION_DASH_ENDED).toBe(0);
    expect(s.dashing).toBe(true);

    expect(hold(s, 3 * DT, false, false) & ACTION_DASH_ENDED).toBeTruthy();
    expect(s.dashing).toBe(false);
    expect(s.dashTimeLeft).toBe(0);
  });

  it("is edge-triggered: holding the button never dashes again", () => {
    const s = freshState();
    stepActions(s, s, true, false, true, DT, W);
    const seen = hold(s, W.dash.cooldownSeconds * 3, true, false);
    expect(seen & ACTION_DASH_STARTED).toBe(0);
    expect(s.dashCooldownLeft).toBe(0);
  });

  it("refuses a press during the cooldown and does not buffer it", () => {
    const s = freshState();
    stepActions(s, s, true, false, true, DT, W);
    hold(s, 0.5, false, false);
    expect(s.dashCooldownLeft).toBeGreaterThan(0);

    // Press and keep holding through the end of the cooldown: nothing happens.
    expect(hold(s, W.dash.cooldownSeconds, true, false) & ACTION_DASH_STARTED).toBe(0);
    // Release and press again: now it fires.
    stepActions(s, s, false, false, true, DT, W);
    expect(stepActions(s, s, true, false, true, DT, W) & ACTION_DASH_STARTED).toBeTruthy();
  });

  it("is available again exactly when the cooldown has run out", () => {
    const s = freshState();
    stepActions(s, s, true, false, true, DT, W);
    hold(s, W.dash.cooldownSeconds - 3 * DT, false, false);
    expect(stepActions(s, s, true, false, true, DT, W) & ACTION_DASH_STARTED).toBe(0);
    hold(s, 4 * DT, false, false);
    expect(s.dashCooldownLeft).toBe(0);
    expect(stepActions(s, s, true, false, true, DT, W) & ACTION_DASH_STARTED).toBeTruthy();
  });

  it("cannot start while bracing", () => {
    const s = freshState();
    hold(s, 0.2, false, true);
    expect(s.bracing).toBe(true);
    expect(stepActions(s, s, true, true, true, DT, W) & ACTION_DASH_STARTED).toBe(0);
    expect(s.dashing).toBe(false);
    expect(s.dashCooldownLeft).toBe(0);
  });

  it("loses to brace when both are pressed on the same step", () => {
    const s = freshState();
    const flags = stepActions(s, s, true, true, true, DT, W);
    expect(flags & ACTION_BRACE_ON).toBeTruthy();
    expect(flags & ACTION_DASH_STARTED).toBe(0);
  });
});

describe("brace", () => {
  it("is on while held and off, with a cooldown, on release", () => {
    const s = freshState();
    expect(stepActions(s, s, false, true, true, DT, W) & ACTION_BRACE_ON).toBeTruthy();
    expect(s.bracing).toBe(true);
    expect(s.braceTimeLeft).toBeCloseTo(W.brace.maxHoldSeconds, 10);

    expect(hold(s, 0.5, false, true) & (ACTION_BRACE_ON | ACTION_BRACE_OFF)).toBe(0);
    expect(s.braceTimeLeft).toBeCloseTo(W.brace.maxHoldSeconds - 0.5, 6);

    expect(stepActions(s, s, false, false, true, DT, W) & ACTION_BRACE_OFF).toBeTruthy();
    expect(s.bracing).toBe(false);
    expect(s.braceTimeLeft).toBe(0);
    expect(s.braceCooldownLeft).toBeCloseTo(W.brace.cooldownSeconds, 10);
  });

  it("ends by itself after maxHoldSeconds and then cools down", () => {
    const s = freshState();
    stepActions(s, s, false, true, true, DT, W);
    expect(hold(s, W.brace.maxHoldSeconds - 3 * DT, false, true) & ACTION_BRACE_OFF).toBe(0);
    expect(s.bracing).toBe(true);
    expect(hold(s, 4 * DT, false, true) & ACTION_BRACE_OFF).toBeTruthy();
    expect(s.bracing).toBe(false);
    expect(s.braceCooldownLeft).toBeGreaterThan(W.brace.cooldownSeconds - 4 * DT);
  });

  it("cannot restart during its cooldown, and can afterwards", () => {
    const s = freshState();
    stepActions(s, s, false, true, true, DT, W);
    stepActions(s, s, false, false, true, DT, W);
    expect(hold(s, W.brace.cooldownSeconds - 3 * DT, false, true) & ACTION_BRACE_ON).toBe(0);
    expect(s.bracing).toBe(false);
    expect(hold(s, 5 * DT, false, true) & ACTION_BRACE_ON).toBeTruthy();
    expect(s.bracing).toBe(true);
    expect(s.braceTimeLeft).toBeGreaterThan(W.brace.maxHoldSeconds - 5 * DT);
  });

  it("cannot start in the middle of a dash, but starts once the dash is over", () => {
    const s = freshState();
    stepActions(s, s, true, false, true, DT, W);
    expect(stepActions(s, s, true, true, true, DT, W) & ACTION_BRACE_ON).toBe(0);
    expect(s.bracing).toBe(false);
    expect(hold(s, W.dash.durationSeconds + DT, false, true) & ACTION_BRACE_ON).toBeTruthy();
    expect(s.dashing).toBe(false);
    expect(s.bracing).toBe(true);
  });

  it("needs footing to start and ends when footing is lost", () => {
    const s = freshState();
    expect(stepActions(s, s, false, true, false, DT, W) & ACTION_BRACE_ON).toBe(0);
    expect(s.bracing).toBe(false);
    expect(s.braceCooldownLeft).toBe(0);

    stepActions(s, s, false, true, true, DT, W);
    expect(s.bracing).toBe(true);
    expect(stepActions(s, s, false, true, false, DT, W) & ACTION_BRACE_OFF).toBeTruthy();
    expect(s.braceCooldownLeft).toBeCloseTo(W.brace.cooldownSeconds, 10);
  });
});

describe("resetActions", () => {
  it("clears every timer, flag and the remembered button", () => {
    const s = freshState();
    stepActions(s, s, true, false, true, DT, W);
    hold(s, 0.3, true, true);
    resetActions(s, s);
    expect(s).toEqual(freshState());
    // The button is still physically down, yet a reset forgets it: the next sample is a new press.
    expect(stepActions(s, s, true, false, true, DT, W) & ACTION_DASH_STARTED).toBeTruthy();
  });
});

describe("dashDragFactor", () => {
  it("together with the body's damping brings a dash back to maxSpeed when it ends", () => {
    for (const bodyDamping of [W.linearDamping, 0]) {
      let speed = W.maxSpeed * W.dash.speedMultiplier;
      const steps = Math.round(W.dash.durationSeconds / DT);
      for (let i = 0; i < steps; i++) {
        speed *= dashDragFactor(W.dash, bodyDamping, DT);
        speed *= Math.exp(-bodyDamping * DT); // the physics engine's own damping
      }
      expect(speed).toBeCloseTo(W.maxSpeed, 6);
    }
  });

  it("is a pure slow-down, independent of how the time is sliced", () => {
    const whole = dashDragFactor(W.dash, W.linearDamping, 0.1);
    const sliced = dashDragFactor(W.dash, W.linearDamping, 0.05) * dashDragFactor(W.dash, W.linearDamping, 0.05);
    expect(whole).toBeLessThan(1);
    expect(whole).toBeGreaterThan(0);
    expect(sliced).toBeCloseTo(whole, 12);
    expect(dashDragFactor(W.dash, W.linearDamping, 0)).toBe(1);
  });

  it("adds nothing when the body's own damping already slows the dash enough", () => {
    expect(dashDragFactor({ speedMultiplier: 3, durationSeconds: 0.25 }, 50, DT)).toBe(1);
    expect(dashDragFactor({ speedMultiplier: 1, durationSeconds: 0.25 }, 1, DT)).toBe(1);
    expect(dashDragFactor({ speedMultiplier: 3, durationSeconds: 0 }, 1, DT)).toBe(1);
  });
});

describe("knockbackScale", () => {
  const dashX = W.dash.knockbackMultiplier;
  const braceX = W.brace.knockbackTaken;

  it("is 1 for two plain wrestlers", () => {
    expect(knockbackScale(false, false, false, false, W)).toBe(1);
  });

  it("a dasher sends a plain wrestler flying and barely recoils itself", () => {
    const victim = knockbackScale(false, false, true, false, W);
    const dasher = knockbackScale(true, false, false, false, W);
    expect(victim).toBeCloseTo(dashX, 12);
    expect(dasher).toBeCloseTo(PHYSICS_TUNING.dashWinnerRecoil, 12);
    expect(dasher).toBeLessThan(victim / 4);
  });

  it("a braced wrestler takes only a fraction of a plain bump", () => {
    expect(knockbackScale(false, true, false, false, W)).toBeCloseTo(braceX, 12);
    // …while whoever bumped into it takes the ordinary amount.
    expect(knockbackScale(false, false, false, true, W)).toBe(1);
  });

  it("a dasher that hits a braced wrestler takes the larger recoil", () => {
    const bracer = knockbackScale(false, true, true, false, W);
    const dasher = knockbackScale(true, false, false, true, W);
    expect(bracer).toBeCloseTo(dashX * braceX, 12);
    expect(dasher).toBeCloseTo(PHYSICS_TUNING.braceReboundMultiplier, 12);
    expect(dasher).toBeGreaterThan(bracer);
    expect(dasher).toBeGreaterThan(1);
  });

  it("two dashers clash symmetrically and both fly", () => {
    expect(knockbackScale(true, false, true, false, W)).toBeCloseTo(dashX, 12);
  });
});

describe("resolveImpact", () => {
  const out: ImpactOutput = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, strength: 0 };
  const hit = W.hit;

  function impact(patch: Partial<ImpactInput>): ImpactInput {
    return {
      nx: 1,
      ny: 0,
      nz: 0,
      approach: 4,
      closing: 0,
      massA: W.mass,
      massB: W.mass,
      aDashing: false,
      aBracing: false,
      bDashing: false,
      bBracing: false,
      ...patch,
    };
  }

  it("pushes both wrestlers apart along the normal by pop + per-speed knockback", () => {
    resolveImpact(impact({ approach: 4 }), W, out);
    const expected = hit.popImpulse + hit.knockbackPerSpeed * 4;
    expect(out.ax).toBeCloseTo(-expected, 10);
    expect(out.bx).toBeCloseTo(expected, 10);
    expect(out.az).toBeCloseTo(0, 10);
    expect(out.bz).toBeCloseTo(0, 10);
    expect(out.strength).toBeCloseTo(4 / hit.bigImpactSpeed, 10);
  });

  it("saturates knockback and strength at bigImpactSpeed", () => {
    resolveImpact(impact({ approach: hit.bigImpactSpeed * 3 }), W, out);
    expect(out.bx).toBeCloseTo(hit.popImpulse + hit.knockbackPerSpeed * hit.bigImpactSpeed, 10);
    expect(out.strength).toBe(1);
  });

  it("adds a small upward pop, capped, and none for a braced wrestler", () => {
    resolveImpact(impact({ approach: 4 }), W, out);
    expect(out.ay).toBeGreaterThan(0);
    expect(out.ay).toBeLessThanOrEqual(PHYSICS_TUNING.hopMaxSpeed);
    expect(out.by).toBeCloseTo(out.ay, 10);

    // The hardest hit there is (a dash at saturated speed) still only hops.
    resolveImpact(impact({ approach: 30, aDashing: true }), W, out);
    expect(out.by).toBeCloseTo(Math.min(PHYSICS_TUNING.hopMaxSpeed, PHYSICS_TUNING.hopFraction * out.bx), 10);
    expect(out.by).toBeLessThanOrEqual(PHYSICS_TUNING.hopMaxSpeed);
    expect((out.by * out.by) / (2 * Math.abs(gameConfig.sim.gravity))).toBeLessThan(0.15);

    resolveImpact(impact({ approach: 30, aDashing: true, bBracing: true, massB: W.mass * W.brace.massMultiplier }), W, out);
    expect(out.by).toBe(0);
    expect(out.ay).toBeGreaterThan(0);
  });

  it("dasher vs plain: the victim takes far more than the dasher", () => {
    resolveImpact(impact({ approach: 10, aDashing: true }), W, out);
    expect(out.bx).toBeGreaterThan(Math.abs(out.ax) * 5);
    expect(out.ax).toBeLessThan(0);
  });

  it("dasher vs bracer: the dasher takes far more than the bracer", () => {
    resolveImpact(impact({ approach: 10, aDashing: true, bBracing: true, massB: W.mass * W.brace.massMultiplier }), W, out);
    expect(Math.abs(out.ax)).toBeGreaterThan(out.bx * 2);
    expect(out.bx).toBeGreaterThan(0);
  });

  it("finishes the bounce itself when the solver has not seen the contact yet", () => {
    // Equal masses, head-on, still closing at 6 after the step.
    resolveImpact(impact({ approach: 6, closing: 6 }), W, out);
    const extra = hit.popImpulse + hit.knockbackPerSpeed * 6;
    const bounce = ((1 + W.restitution) * 6) / 2;
    expect(out.ax).toBeCloseTo(-(bounce + extra), 10);
    expect(out.bx).toBeCloseTo(bounce + extra, 10);
    // The bounce alone turns "closing at 6" into "separating at restitution × 6".
    expect(6 - 2 * bounce).toBeCloseTo(-W.restitution * 6, 10);
  });

  it("the bounce conserves momentum with unequal (braced) masses", () => {
    const massB = W.mass * W.brace.massMultiplier;
    // Zero the game knockback out by comparing against a call without closing speed.
    const base: ImpactOutput = { ...out };
    resolveImpact(impact({ approach: 6, closing: 0, bBracing: true, massB }), W, base);
    resolveImpact(impact({ approach: 6, closing: 6, bBracing: true, massB }), W, out);
    const da = out.ax - base.ax;
    const db = out.bx - base.bx;
    expect(W.mass * da + massB * db).toBeCloseTo(0, 10);
    expect(Math.abs(da)).toBeCloseTo(Math.abs(db) * W.brace.massMultiplier, 10);
  });

  it("does not bounce again when the solver already separated them", () => {
    const a: ImpactOutput = { ...out };
    resolveImpact(impact({ approach: 6, closing: -2 }), W, a);
    resolveImpact(impact({ approach: 6, closing: 0 }), W, out);
    expect(a).toEqual(out);
  });

  it("keeps the game knockback horizontal when one wrestler lands on another", () => {
    resolveImpact(impact({ nx: 0, ny: -1, nz: 0, approach: 8 }), W, out);
    expect(out.ax).toBeCloseTo(0, 10);
    expect(out.az).toBeCloseTo(0, 10);
    expect(out.bx).toBeCloseTo(0, 10);
    expect(out.ay).toBeCloseTo(0, 10);
    expect(out.by).toBeCloseTo(0, 10);
  });

  it("follows the contact normal in the plane", () => {
    const n = Math.SQRT1_2;
    resolveImpact(impact({ nx: n, nz: -n, approach: 4 }), W, out);
    expect(out.bx).toBeCloseTo(-out.bz, 10);
    expect(out.ax).toBeCloseTo(-out.bx, 10);
    expect(out.az).toBeCloseTo(-out.bz, 10);
  });
});

describe("pairIndex", () => {
  it("maps every unordered pair of 4 slots to its own entry of a 6-entry table", () => {
    expect(pairCount(4)).toBe(6);
    const seen = new Set<number>();
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const p = pairIndex(a, b, 4);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(6);
        expect(Number.isInteger(p)).toBe(true);
        expect(pairIndex(b, a, 4)).toBe(p);
        seen.add(p);
      }
    }
    expect(seen.size).toBe(6);
  });
});

describe("isGrounded", () => {
  const r = W.radius;

  it("is true for a body resting on the island", () => {
    expect(isGrounded(r, 0, 0, 6, r)).toBe(true);
    expect(isGrounded(r - 0.002, -0.3, 5.9, 6, r)).toBe(true);
  });

  it("is false in the air, on the way up, past the rim, or below the surface", () => {
    expect(isGrounded(r + 0.5, 0, 0, 6, r)).toBe(false);
    expect(isGrounded(r + 0.01, 3, 0, 6, r)).toBe(false);
    expect(isGrounded(r, 0, 6.3, 6, r)).toBe(false);
    expect(isGrounded(r - 0.4, -2, 0, 6, r)).toBe(false);
  });

  it("follows the shrinking island", () => {
    expect(isGrounded(r, 0, 5.5, 6, r)).toBe(true);
    expect(isGrounded(r, 0, 5.5, 5, r)).toBe(false);
  });
});

describe("angles", () => {
  it("headingToCentre looks from a point at the origin", () => {
    // Facing convention: atan2(dirX, dirZ).
    expect(headingToCentre(0, -3, 9)).toBeCloseTo(0, 10); // must look toward +z
    expect(headingToCentre(-3, 0, 9)).toBeCloseTo(Math.PI / 2, 10); // toward +x
    expect(Math.abs(headingToCentre(0, 3, 9))).toBeCloseTo(Math.PI, 10); // toward -z
    expect(headingToCentre(0, 0, 1.25)).toBe(1.25);
  });

  it("wrapAngle keeps angles in (-π, π]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 10);
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 10);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 10);
    expect(wrapAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 10);
    expect(wrapAngle(7 * Math.PI)).toBeCloseTo(Math.PI, 10);
  });
});
