import { describe, expect, it } from "vitest";
import { PLAYER_STYLES, gameConfig } from "../../config";
import type { WrestlerRuntime } from "../../types";
import {
  BODY_RADIUS,
  createPose,
  determinantMat3,
  kickBrace,
  kickHit,
  kickLand,
  multiplyMat3,
  resetPose,
  smoothstep,
  stepPose,
  stepSpring,
  stretchMatrix,
  type Pose,
} from "./deform";

const DT = 1 / 60;

function wrestler(patch: Partial<WrestlerRuntime> = {}): WrestlerRuntime {
  return {
    slot: 0,
    style: PLAYER_STYLES[0],
    name: "Test",
    control: "bot",
    status: "alive",
    score: 0,
    invulnerableUntil: 0,
    lastTouchedBy: -1,
    lastTouchedAt: -Infinity,
    respawnAt: 0,
    teleport: false,
    spawnX: 0,
    spawnY: 0,
    spawnZ: 0,
    x: 0,
    y: BODY_RADIUS,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 0,
    grounded: true,
    onEdge: false,
    dashing: false,
    dashTimeLeft: 0,
    dashCooldownLeft: 0,
    bracing: false,
    braceTimeLeft: 0,
    braceCooldownLeft: 0,
    ...patch,
  };
}

function run(pose: Pose, w: WrestlerRuntime, seconds: number, reduceMotion = false, invulnerable = false) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) stepPose(pose, w, invulnerable, DT, reduceMotion);
}

function isIdentity(m: ArrayLike<number>, tolerance = 1e-3): boolean {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return id.every((v, i) => Math.abs(m[i] - v) < tolerance);
}

describe("smoothstep", () => {
  it("clamps and eases", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 2, 1)).toBeCloseTo(0.5);
  });
});

describe("stepSpring", () => {
  it("overshoots a little and settles in about half a second", () => {
    const s = { x: 0, v: -14 };
    let peak = 0;
    let overshoot = 0;
    for (let t = 0; t < 0.6; t += DT) {
      stepSpring(s, 0, 31.4, 0.32, DT);
      peak = Math.min(peak, s.x);
      overshoot = Math.max(overshoot, s.x);
    }
    expect(peak).toBeLessThan(-0.2);
    expect(overshoot).toBeGreaterThan(0.02);
    expect(Math.abs(s.x)).toBeLessThan(Math.abs(peak) * 0.03);
  });

  it("stays stable with a huge time step", () => {
    const s = { x: 1, v: 0 };
    for (let i = 0; i < 20; i++) stepSpring(s, 0, 31.4, 0.32, 0.1);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(0.01);
  });

  it("converges on its target", () => {
    const s = { x: 0, v: 0 };
    for (let t = 0; t < 1; t += DT) stepSpring(s, -0.36, 27, 0.45, DT);
    expect(s.x).toBeCloseTo(-0.36, 3);
  });
});

describe("stretchMatrix", () => {
  it("preserves volume and stretches along its axis only", () => {
    const m = stretchMatrix(new Float32Array(9), 0, 0, 1, 1.5);
    expect(determinantMat3(m)).toBeCloseTo(1, 5);
    expect(m[8]).toBeCloseTo(1.5, 5);
    expect(m[0]).toBeCloseTo(1 / Math.sqrt(1.5), 5);
    expect(m[4]).toBeCloseTo(1 / Math.sqrt(1.5), 5);
  });

  it("is symmetric for an arbitrary axis and keeps determinant 1 when combined", () => {
    const a = stretchMatrix(new Float32Array(9), 0.6, 0, 0.8, 1.4);
    const b = stretchMatrix(new Float32Array(9), 0, 1, 0, 0.7);
    expect(a[1]).toBeCloseTo(a[3]);
    expect(a[2]).toBeCloseTo(a[6]);
    expect(a[5]).toBeCloseTo(a[7]);
    const ab = multiplyMat3(new Float32Array(9), a, b);
    expect(determinantMat3(ab)).toBeCloseTo(1, 4);
  });
});

describe("stepPose", () => {
  it("rests undeformed, opaque and planted", () => {
    const pose = createPose(1);
    run(pose, wrestler(), 0.5);
    expect(isIdentity(pose.deform)).toBe(true);
    expect(pose.shift).toBeCloseTo(0, 3);
    expect(pose.opacity).toBe(1);
    expect(pose.beltGlow).toBeCloseTo(0, 3);
    expect(pose.pulse).toBe(-1);
    expect(pose.amp).toBeGreaterThan(0);
  });

  it("snaps to the record on the first step after a reset", () => {
    const pose = createPose(1);
    stepPose(pose, wrestler({ facing: 2.5 }), false, DT, false);
    expect(pose.facing).toBeCloseTo(2.5);
    resetPose(pose);
    stepPose(pose, wrestler({ facing: -1 }), true, DT, false);
    expect(pose.facing).toBeCloseTo(-1);
    expect(pose.opacity).toBeLessThan(1);
  });

  it("stretches along the heading when running forward, more when dashing", () => {
    const speed = gameConfig.wrestler.maxSpeed;
    const running = createPose(1);
    run(running, wrestler({ vz: speed }), 0.6);
    // Facing 0 → forward is local +Z (column 2 of the matrix).
    expect(running.deform[8]).toBeGreaterThan(1.1);
    expect(running.deform[0]).toBeLessThan(1);
    expect(determinantMat3(running.deform)).toBeCloseTo(1, 3);

    const dashing = createPose(1);
    run(dashing, wrestler({ vz: speed * 3, dashing: true }), 0.6);
    expect(dashing.deform[8]).toBeGreaterThan(running.deform[8] + 0.2);
    expect(dashing.rim).toBeGreaterThan(running.rim + 0.5);
  });

  it("stretches along local forward whatever the world heading", () => {
    const pose = createPose(1);
    const facing = Math.PI / 2; // moving along world +X
    run(pose, wrestler({ vx: gameConfig.wrestler.maxSpeed, facing }), 0.6);
    expect(pose.deform[8]).toBeGreaterThan(1.1);
    expect(Math.abs(pose.deform[2])).toBeLessThan(0.02);
  });

  it("keeps the foot on the floor while grounded and centred while airborne", () => {
    const grounded = createPose(1);
    run(grounded, wrestler({ vz: gameConfig.wrestler.maxSpeed }), 0.6);
    // Stretching forward thins the body vertically, so it must be lowered.
    expect(grounded.shift).toBeLessThan(-0.01);
    expect(grounded.shift).toBeCloseTo(-BODY_RADIUS * (1 - grounded.height), 4);

    const falling = createPose(1);
    run(falling, wrestler({ vy: -12, grounded: false, y: 3 }), 0.6);
    expect(falling.deform[4]).toBeGreaterThan(1.15); // a vertical drip
    expect(falling.shift).toBeCloseTo(0, 3);
  });

  it("flattens wide and low when bracing, with a glowing belt and a ring pulse", () => {
    const pose = createPose(1);
    const w = wrestler({ bracing: true });
    kickBrace(pose, true, false);
    run(pose, w, 0.8);
    expect(pose.deform[4]).toBeLessThan(0.78);
    expect(pose.deform[0]).toBeGreaterThan(1.12);
    expect(pose.shift).toBeLessThan(-0.1);
    expect(pose.beltGlow).toBeGreaterThan(0.4);
    expect(pose.pulse).toBeGreaterThanOrEqual(0);
    expect(pose.pulse).toBeLessThan(1);
    expect(pose.brace).toBeGreaterThan(0.9);

    // Released: back to rest, the pulse runs out.
    kickBrace(pose, false, false);
    run(pose, wrestler(), 1.2);
    expect(isIdentity(pose.deform, 5e-3)).toBe(true);
    expect(pose.pulse).toBe(-1);
    expect(pose.beltGlow).toBeLessThan(0.01);
  });

  it("squashes on landing and recovers within about half a second", () => {
    const pose = createPose(1);
    const w = wrestler();
    run(pose, w, 0.1);
    kickLand(pose, 11, false);
    let lowest = 1;
    let highest = 1;
    for (let t = 0; t < 0.6; t += DT) {
      stepPose(pose, w, false, DT, false);
      lowest = Math.min(lowest, pose.deform[4]);
      highest = Math.max(highest, pose.deform[4]);
    }
    expect(lowest).toBeLessThan(0.8);
    expect(highest).toBeGreaterThan(1.01); // slight overshoot
    expect(pose.deform[4]).toBeCloseTo(1, 1);
    run(pose, w, 0.4);
    expect(isIdentity(pose.deform, 5e-3)).toBe(true);
  });

  it("squashes along the hit normal, jiggles, flashes and settles", () => {
    const pose = createPose(1);
    const w = wrestler();
    run(pose, w, 0.1);
    const calmAmp = pose.amp;
    kickHit(pose, 1, 0, 0, 1, false, false); // hit from -X: normal points to +X
    stepPose(pose, w, false, DT, false);
    expect(pose.amp).toBeGreaterThan(calmAmp * 1.5);
    expect(pose.flash).toBeGreaterThan(0.5);
    let narrowest = 1;
    for (let t = 0; t < 0.2; t += DT) {
      stepPose(pose, w, false, DT, false);
      narrowest = Math.min(narrowest, pose.deform[0]);
    }
    expect(narrowest).toBeLessThan(0.82); // squashed along local X
    run(pose, w, 0.7);
    expect(isIdentity(pose.deform, 5e-3)).toBe(true);
    expect(pose.flash).toBeLessThan(0.01);
    expect(pose.amp).toBeCloseTo(calmAmp, 2);
  });

  it("gives far less when braced", () => {
    const free = createPose(1);
    const braced = createPose(1);
    kickHit(free, 0, 0, 1, 1, false, false);
    kickHit(braced, 0, 0, 1, 1, true, false);
    expect(Math.abs(braced.hit.v)).toBeLessThan(Math.abs(free.hit.v) * 0.5);
    expect(braced.jiggle).toBeLessThan(free.jiggle);
  });

  it("sways the top against accelerations and comes back to rest", () => {
    const pose = createPose(1);
    run(pose, wrestler(), 0.1);
    const moving = wrestler({ vz: gameConfig.wrestler.maxSpeed });
    stepPose(pose, moving, false, DT, false);
    run(pose, moving, 0.05);
    expect(pose.swayLocalZ).toBeLessThan(-0.01); // lags behind a forward launch
    expect(Math.hypot(pose.swayLocalX, pose.swayLocalZ)).toBeLessThanOrEqual(0.2 + 1e-6);
    run(pose, moving, 1.2);
    expect(Math.abs(pose.swayLocalZ)).toBeLessThan(0.005);
  });

  it("wobbles more on the edge", () => {
    const calm = createPose(1);
    const nervous = createPose(1);
    run(calm, wrestler(), 0.6);
    run(nervous, wrestler({ onEdge: true }), 0.6);
    expect(nervous.amp).toBeGreaterThan(calm.amp * 1.4);
    expect(nervous.time - nervous.seed * 7.3).toBeGreaterThan(calm.time - calm.seed * 7.3);
  });

  it("turns translucent with a pulse while invulnerable and solid again after", () => {
    const pose = createPose(1);
    const w = wrestler();
    let min = 1;
    let max = 0;
    for (let t = 0; t < 1.2; t += DT) {
      stepPose(pose, w, true, DT, false);
      if (t > 0.4) {
        min = Math.min(min, pose.opacity);
        max = Math.max(max, pose.opacity);
      }
    }
    expect(min).toBeGreaterThan(0.35); // still readable
    expect(max).toBeLessThan(0.8);
    expect(max - min).toBeGreaterThan(0.05); // it pulses
    run(pose, w, 0.8);
    expect(pose.opacity).toBe(1);
  });

  it("breathes calmly when idle and ignores stale velocities", () => {
    const pose = createPose(1);
    const w = wrestler({ status: "idle", grounded: false, vx: 9, vy: -30, vz: 4 });
    let min = 1;
    let max = 1;
    for (let t = 0; t < 4; t += DT) {
      stepPose(pose, w, false, DT, false);
      min = Math.min(min, pose.deform[4]);
      max = Math.max(max, pose.deform[4]);
    }
    expect(max - min).toBeGreaterThan(0.01);
    expect(max).toBeLessThan(1.06);
    expect(min).toBeGreaterThan(0.94);
    expect(Math.abs(pose.deform[8] - pose.deform[0])).toBeLessThan(1e-4); // no velocity stretch
    expect(pose.ground).toBeCloseTo(1);
  });

  it("calms everything down with reduce-motion", () => {
    const full = createPose(1);
    const reduced = createPose(1);
    const w = wrestler({ bracing: true });
    kickHit(full, 1, 0, 0, 1, false, false);
    kickHit(reduced, 1, 0, 0, 1, false, true);
    expect(reduced.flash).toBe(0);
    expect(Math.abs(reduced.hit.v)).toBeLessThan(Math.abs(full.hit.v));
    run(full, w, 0.5, false);
    run(reduced, w, 0.5, true);
    expect(reduced.amp).toBeLessThan(full.amp);
    expect(reduced.pulse).toBe(-1);
    expect(reduced.swayLocalX).toBe(0);
    // The state itself is still shown.
    expect(reduced.deform[4]).toBeLessThan(0.8);
    expect(reduced.beltGlow).toBeGreaterThan(0.5);
  });

  it("never produces NaN, even with degenerate input", () => {
    const pose = createPose(3);
    kickHit(pose, 0, 0, 0, 5, false, false);
    kickLand(pose, 1000, false);
    const w = wrestler({ vx: 1e-9, vy: 0, vz: -1e-9, facing: 1e6 });
    stepPose(pose, w, false, 0, false);
    run(pose, w, 0.3);
    stepPose(pose, w, false, 0.1, false);
    for (const v of pose.deform) expect(Number.isFinite(v)).toBe(true);
    for (const v of [pose.shift, pose.amp, pose.time, pose.rim, pose.opacity, pose.swayLocalX, pose.facing]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // The clamps keep even an absurd landing within a sane silhouette.
    expect(pose.deform[4]).toBeGreaterThan(0.4);
  });
});
