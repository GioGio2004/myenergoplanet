import { describe, expect, it } from "vitest";
import { gameConfig } from "../config";
import { inputToWorld } from "../math";
import {
  DEG2RAD,
  aspectDistanceScale,
  blendProgress,
  bumpEnvelope,
  clampToRadius,
  createSpring,
  easeInOutCubic,
  enclosingCircle,
  farthestDistance,
  fitGroundDistance,
  fitSphereDistance,
  frameDistance,
  headingFromOffset,
  horizontalHalfFov,
  minHalfFov,
  orbitOffset,
  punchEnvelope,
  shakeNoise,
  smoothstep01,
  snapSpring,
  stepSpring,
  sweepRate,
  wrapAngle,
  type Circle,
} from "./framing";

const CAM = gameConfig.camera;

/**
 * Independent check of the fit maths: build the camera basis by hand, project the rim
 * of a ground disc around the target and return the largest |NDC| on each axis.
 */
function projectGroundDisc(
  radius: number,
  distance: number,
  fovDegrees: number,
  aspect: number,
  pitch: number,
  yaw = 0,
): { maxX: number; maxY: number; minDepth: number } {
  const off = orbitOffset(yaw, pitch, distance, { x: 0, y: 0, z: 0 });
  const len = Math.hypot(off.x, off.y, off.z);
  // forward = toward the target; right = screen right; up = forward × right flipped.
  const f = { x: -off.x / len, y: -off.y / len, z: -off.z / len };
  const r = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const u = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  const tv = Math.tan((fovDegrees * DEG2RAD) / 2);
  const th = tv * aspect;
  let maxX = 0;
  let maxY = 0;
  let minDepth = Infinity;
  const steps = 720;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rel = {
      x: Math.cos(a) * radius - off.x,
      y: -off.y,
      z: Math.sin(a) * radius - off.z,
    };
    const depth = rel.x * f.x + rel.y * f.y + rel.z * f.z;
    const sx = rel.x * r.x + rel.y * r.y + rel.z * r.z;
    const sy = rel.x * u.x + rel.y * u.y + rel.z * u.z;
    minDepth = Math.min(minDepth, depth);
    maxX = Math.max(maxX, Math.abs(sx / (depth * th)));
    maxY = Math.max(maxY, Math.abs(sy / (depth * tv)));
  }
  return { maxX, maxY, minDepth };
}

describe("stepSpring", () => {
  it("converges on the target and comes to rest", () => {
    const s = createSpring(0);
    for (let i = 0; i < 600; i++) stepSpring(s, 10, 0.5, 1 / 60);
    expect(s.value).toBeCloseTo(10, 5);
    expect(s.velocity).toBeCloseTo(0, 5);
  });

  it("does not overshoot when starting at rest", () => {
    const s = createSpring(0);
    let max = -Infinity;
    for (let i = 0; i < 600; i++) max = Math.max(max, stepSpring(s, 10, 0.5, 1 / 60));
    expect(max).toBeLessThanOrEqual(10);
  });

  it("is frame-rate independent", () => {
    const a = createSpring(2);
    const b = createSpring(2);
    for (let i = 0; i < 30; i++) stepSpring(a, -3, 0.7, 1 / 30);
    for (let i = 0; i < 120; i++) stepSpring(b, -3, 0.7, 1 / 120);
    expect(a.value).toBeCloseTo(b.value, 9);
    expect(a.velocity).toBeCloseTo(b.velocity, 9);
  });

  it("has mostly settled after smoothTime", () => {
    const s = createSpring(0);
    for (let i = 0; i < 55; i++) stepSpring(s, 1, 0.55, 0.01);
    expect(s.value).toBeGreaterThan(0.88);
    expect(s.value).toBeLessThan(0.95);
  });

  it("eases in: the first step of a jump is tiny (no cut)", () => {
    const s = createSpring(0);
    stepSpring(s, 10, 0.55, 1 / 60);
    // Plain exponential damping would already have covered ~3% here.
    expect(s.value).toBeLessThan(0.1);
    expect(s.velocity).toBeGreaterThan(0);
  });

  it("snaps with a zero smooth time and ignores a zero dt", () => {
    const s = createSpring(1);
    s.velocity = 5;
    expect(stepSpring(s, 4, 0.5, 0)).toBe(1);
    expect(stepSpring(s, 4, 0, 1 / 60)).toBe(4);
    expect(s.velocity).toBe(0);
    snapSpring(s, -2);
    expect(s).toEqual({ value: -2, velocity: 0 });
  });
});

describe("orbit geometry", () => {
  it("places the camera at (sin yaw, ·, cos yaw) × distance", () => {
    const out = { x: 0, y: 0, z: 0 };
    orbitOffset(0, 0, 10, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(10);
    orbitOffset(Math.PI / 2, 0, 10, out);
    expect(out.x).toBeCloseTo(10);
    expect(out.z).toBeCloseTo(0);
    orbitOffset(0.3, 50 * DEG2RAD, 14, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(14);
    expect(out.y).toBeCloseTo(14 * Math.sin(50 * DEG2RAD));
  });

  it("round-trips the heading for any pitch", () => {
    const out = { x: 0, y: 0, z: 0 };
    for (const yaw of [-3, -1.2, 0, 0.4, 2.9]) {
      for (const pitch of [0.2, 0.9, 1.4]) {
        orbitOffset(yaw, pitch, 17, out);
        expect(headingFromOffset(out.x, out.z)).toBeCloseTo(yaw, 10);
      }
    }
  });

  it("agrees with inputToWorld: stick up moves away from the camera", () => {
    const out = { x: 0, y: 0, z: 0 };
    const dir = { x: 0, z: 0 };
    for (const yaw of [-2.5, 0, 0.7, 3.1]) {
      orbitOffset(yaw, 0.87, 12, out);
      const horizontal = Math.hypot(out.x, out.z);
      inputToWorld(0, 1, yaw, dir);
      // "Up the screen" is exactly opposite the camera's horizontal offset…
      expect(dir.x).toBeCloseTo(-out.x / horizontal, 10);
      expect(dir.z).toBeCloseTo(-out.z / horizontal, 10);
      // …and stick-right is perpendicular to it.
      inputToWorld(1, 0, yaw, dir);
      expect(dir.x * out.x + dir.z * out.z).toBeCloseTo(0, 10);
    }
  });

  it("wraps angles into (-π, π]", () => {
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
    expect(wrapAngle(Math.PI + 0.25)).toBeCloseTo(-Math.PI + 0.25);
    expect(wrapAngle(-Math.PI - 0.25)).toBeCloseTo(Math.PI - 0.25);
    expect(wrapAngle(7 * Math.PI)).toBeCloseTo(Math.PI);
    expect(Math.sin(wrapAngle(123.456))).toBeCloseTo(Math.sin(123.456), 10);
  });
});

describe("field of view", () => {
  it("uses the narrower of the two fovs", () => {
    const v = (CAM.fov * DEG2RAD) / 2;
    expect(horizontalHalfFov(CAM.fov, 1)).toBeCloseTo(v);
    expect(minHalfFov(CAM.fov, 16 / 9)).toBeCloseTo(v);
    expect(minHalfFov(CAM.fov, 9 / 16)).toBeCloseTo(horizontalHalfFov(CAM.fov, 9 / 16));
    expect(minHalfFov(CAM.fov, 9 / 16)).toBeLessThan(v);
  });

  it("fits a sphere tangent to the narrower frustum side", () => {
    const d = fitSphereDistance(2, 60, 2);
    expect(d).toBeCloseTo(2 / Math.sin(30 * DEG2RAD));
    expect(fitSphereDistance(2, 60, 0.5)).toBeGreaterThan(d);
  });
});

describe("fitGroundDistance", () => {
  const cases: Array<[string, number, number, number]> = [
    ["16:9 default pitch", 16 / 9, CAM.pitchDegrees, 5],
    ["16:9 final pitch", 16 / 9, CAM.finalPitchDegrees, 7.5],
    ["4:3", 4 / 3, CAM.pitchDegrees, 3.6],
    ["square", 1, CAM.pitchDegrees, 6],
    ["portrait", 9 / 16, CAM.pitchDegrees, 6],
    ["ultrawide", 21 / 9, 30, 9],
    ["top down", 16 / 9, 89.9, 4],
  ];

  for (const [name, aspect, pitchDegrees, radius] of cases) {
    it(`fits the disc exactly (${name})`, () => {
      const pitch = pitchDegrees * DEG2RAD;
      const d = fitGroundDistance(radius, CAM.fov, aspect, pitch);
      const p = projectGroundDisc(radius, d, CAM.fov, aspect, pitch, 0.8);
      expect(p.minDepth).toBeGreaterThan(0);
      // Everything inside the frame…
      expect(p.maxX).toBeLessThanOrEqual(1 + 1e-6);
      expect(p.maxY).toBeLessThanOrEqual(1 + 1e-6);
      // …and tight: the rim touches at least one side.
      expect(Math.max(p.maxX, p.maxY)).toBeGreaterThan(1 - 1e-3);
    });
  }

  it("crops the disc when the camera is any closer", () => {
    const pitch = CAM.pitchDegrees * DEG2RAD;
    const d = fitGroundDistance(5, CAM.fov, 16 / 9, pitch);
    const p = projectGroundDisc(5, d * 0.95, CAM.fov, 16 / 9, pitch);
    expect(Math.max(p.maxX, p.maxY)).toBeGreaterThan(1);
  });

  it("scales linearly with the radius and backs off for narrow windows", () => {
    const pitch = CAM.pitchDegrees * DEG2RAD;
    const wide = fitGroundDistance(4, CAM.fov, 16 / 9, pitch);
    expect(fitGroundDistance(8, CAM.fov, 16 / 9, pitch)).toBeCloseTo(wide * 2);
    expect(fitGroundDistance(4, CAM.fov, 9 / 16, pitch)).toBeGreaterThan(wide);
    // Landscape windows are limited by the vertical fov, so extra width changes nothing.
    expect(fitGroundDistance(4, CAM.fov, 21 / 9, pitch)).toBeCloseTo(wide);
  });

  it("matches the top-down special case", () => {
    const tv = Math.tan((CAM.fov * DEG2RAD) / 2);
    expect(fitGroundDistance(3, CAM.fov, 2, Math.PI / 2)).toBeCloseTo(3 / tv);
    expect(fitGroundDistance(3, CAM.fov, 0.5, Math.PI / 2)).toBeCloseTo(3 / (tv * 0.5));
  });
});

describe("frameDistance", () => {
  const pitch = CAM.pitchDegrees * DEG2RAD;
  const frame = (radius: number, aspect = 16 / 9) =>
    frameDistance(
      radius,
      CAM.framePadding,
      CAM.fov,
      aspect,
      pitch,
      CAM.minDistance,
      CAM.maxDistance,
    );

  it("is tighter when players are close and wider when they spread out", () => {
    const close = frame(0.6);
    const spawn = frame(gameConfig.arena.spawnRadius);
    const far = frame(gameConfig.arena.radius);
    expect(close).toBeLessThan(spawn);
    expect(spawn).toBeLessThan(far);
  });

  it("clamps to the configured range in a landscape window", () => {
    expect(frame(0)).toBe(CAM.minDistance);
    expect(frame(50)).toBe(CAM.maxDistance);
    const mid = frame(gameConfig.arena.spawnRadius);
    expect(mid).toBeGreaterThan(CAM.minDistance);
    expect(mid).toBeLessThan(CAM.maxDistance);
    expect(mid).toBeCloseTo(
      fitGroundDistance(
        gameConfig.arena.spawnRadius + CAM.framePadding,
        CAM.fov,
        16 / 9,
        pitch,
      ),
    );
  });

  it("shows the whole island at the widest framing", () => {
    const p = projectGroundDisc(gameConfig.arena.radius, CAM.maxDistance, CAM.fov, 16 / 9, pitch);
    expect(p.maxX).toBeLessThan(1);
    expect(p.maxY).toBeLessThan(1);
  });

  it("widens the clamps for portrait windows so the island still fits", () => {
    const aspect = 9 / 16;
    expect(aspectDistanceScale(CAM.fov, 16 / 9, pitch)).toBe(1);
    expect(aspectDistanceScale(CAM.fov, 1.2, pitch)).toBe(1);
    const scale = aspectDistanceScale(CAM.fov, aspect, pitch);
    expect(scale).toBeGreaterThan(1);
    const d = frame(50, aspect);
    expect(d).toBeCloseTo(CAM.maxDistance * scale);
    const p = projectGroundDisc(gameConfig.arena.radius, d, CAM.fov, aspect, pitch);
    expect(p.maxX).toBeLessThan(1);
    expect(p.maxY).toBeLessThan(1);
  });

  it("treats a negative group radius as zero", () => {
    expect(frame(-3)).toBe(frame(0));
  });
});

describe("enclosingCircle", () => {
  const out: Circle = { x: 9, z: 9, radius: 9 };
  const encloses = (xs: number[], zs: number[], c: Circle) =>
    xs.every((x, i) => Math.hypot(x - c.x, zs[i] - c.z) <= c.radius + 1e-6);

  it("handles zero and one point", () => {
    expect(enclosingCircle([], [], 0, out)).toEqual({ x: 0, z: 0, radius: 0 });
    expect(enclosingCircle([2], [-3], 1, out)).toEqual({ x: 2, z: -3, radius: 0 });
  });

  it("uses the midpoint for two points", () => {
    enclosingCircle([-2, 4], [1, 1], 2, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(1);
    expect(out.radius).toBeCloseTo(3);
  });

  it("only looks at the first `count` points", () => {
    enclosingCircle([-2, 4, 100], [1, 1, 100], 2, out);
    expect(out.radius).toBeCloseTo(3);
  });

  it("uses the longest side for an obtuse triangle", () => {
    const xs = [-3, 3, 0];
    const zs = [0, 0, 0.5];
    enclosingCircle(xs, zs, 3, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0);
    expect(out.radius).toBeCloseTo(3);
    expect(encloses(xs, zs, out)).toBe(true);
  });

  it("uses the circumcircle for an acute triangle", () => {
    const r = 2.5;
    const xs = [0, 1, 2].map((i) => 1 + r * Math.sin((i * 2 * Math.PI) / 3));
    const zs = [0, 1, 2].map((i) => -2 + r * Math.cos((i * 2 * Math.PI) / 3));
    enclosingCircle(xs, zs, 3, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(-2);
    expect(out.radius).toBeCloseTo(r);
  });

  it("encloses four points minimally", () => {
    const xs = [-2, 2, 2, -2];
    const zs = [-2, -2, 2, 2];
    enclosingCircle(xs, zs, 4, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0);
    expect(out.radius).toBeCloseTo(Math.SQRT2 * 2);

    // A point well inside changes nothing.
    const xs2 = [-3, 3, 0, 0.4];
    const zs2 = [0, 0, 3, 1];
    enclosingCircle(xs2, zs2, 4, out);
    expect(out.radius).toBeCloseTo(3);
    expect(encloses(xs2, zs2, out)).toBe(true);
  });

  it("handles collinear and coincident points", () => {
    enclosingCircle([0, 1, 5, 3], [0, 1, 5, 3], 4, out);
    expect(out.x).toBeCloseTo(2.5);
    expect(out.z).toBeCloseTo(2.5);
    expect(out.radius).toBeCloseTo(Math.hypot(2.5, 2.5));

    enclosingCircle([1, 1, 1], [2, 2, 2], 3, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(2);
    expect(out.radius).toBeCloseTo(0);
  });

  it("always encloses every point (pseudo-random sweep) and is never larger than the bounding-box circle", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 300; n++) {
      const count = 2 + (n % 3);
      const xs: number[] = [];
      const zs: number[] = [];
      for (let i = 0; i < count; i++) {
        xs.push((rnd() - 0.5) * 14);
        zs.push((rnd() - 0.5) * 14);
      }
      enclosingCircle(xs, zs, count, out);
      expect(encloses(xs, zs, out)).toBe(true);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const boxRadius = Math.max(...xs.map((x, i) => Math.hypot(x - cx, zs[i] - cz)));
      expect(out.radius).toBeLessThanOrEqual(boxRadius + 1e-9);
    }
  });
});

describe("farthestDistance", () => {
  it("returns the distance to the farthest of the first `count` points", () => {
    const xs = [3, -1, 0, 100];
    const zs = [4, 0, -2, 100];
    expect(farthestDistance(xs, zs, 3, 0, 0)).toBeCloseTo(5);
    expect(farthestDistance(xs, zs, 3, 3, 4)).toBeCloseTo(Math.hypot(3, 6));
    expect(farthestDistance(xs, zs, 1, 3, 4)).toBe(0);
    expect(farthestDistance(xs, zs, 0, 7, 7)).toBe(0);
  });

  it("equals the enclosing radius when measured from the enclosing centre", () => {
    const xs = [0, 4, 2, 2];
    const zs = [0, 0, 3, 1];
    const c = enclosingCircle(xs, zs, 4, { x: 0, z: 0, radius: 0 });
    expect(farthestDistance(xs, zs, 4, c.x, c.z)).toBeCloseTo(c.radius, 9);
    // From anywhere else it can only be larger.
    expect(farthestDistance(xs, zs, 4, c.x + 0.5, c.z - 0.2)).toBeGreaterThan(c.radius);
  });
});

describe("clampToRadius", () => {
  it("leaves points inside the disc alone", () => {
    const out = { x: 0, z: 0 };
    clampToRadius(1, -1, 2.4, out);
    expect(out).toEqual({ x: 1, z: -1 });
  });

  it("pulls outside points back onto the rim, keeping their direction", () => {
    const out = { x: 0, z: 0 };
    clampToRadius(6, 8, 2.4, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(2.4);
    expect(out.x / out.z).toBeCloseTo(6 / 8);
  });

  it("collapses to the origin for a zero radius", () => {
    const out = { x: 1, z: 1 };
    clampToRadius(3, 4, 0, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0);
    clampToRadius(0, 0, 0, out);
    expect(out).toEqual({ x: 0, z: 0 });
  });
});

describe("shakeNoise", () => {
  it("is deterministic and bounded to [-1, 1]", () => {
    for (let i = 0; i < 2000; i++) {
      const t = i * 0.0137;
      for (let channel = 0; channel < 3; channel++) {
        const v = shakeNoise(t, channel);
        expect(v).toBe(shakeNoise(t, channel));
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is smooth between frames, roughly zero-mean and decorrelated across channels", () => {
    let sum = 0;
    let maxStep = 0;
    let differing = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const t = i / 60;
      const v = shakeNoise(t, 0);
      sum += v;
      maxStep = Math.max(maxStep, Math.abs(shakeNoise(t + 1 / 60, 0) - v));
      if (Math.abs(v - shakeNoise(t, 1)) > 0.05) differing++;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    // One 60 Hz frame never jumps across a large part of the range (no jitter).
    expect(maxStep).toBeLessThan(0.7);
    expect(differing / n).toBeGreaterThan(0.8);
  });
});

describe("easing and envelopes", () => {
  it("smoothstep01 and easeInOutCubic are clamped, monotone 0 → 1", () => {
    for (const ease of [smoothstep01, easeInOutCubic]) {
      expect(ease(-1)).toBe(0);
      expect(ease(0)).toBe(0);
      expect(ease(0.5)).toBeCloseTo(0.5);
      expect(ease(1)).toBe(1);
      expect(ease(2)).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const v = ease(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it("blendProgress runs 0 → 1 over the duration", () => {
    expect(blendProgress(0, 3)).toBe(0);
    expect(blendProgress(1.5, 3)).toBeCloseTo(0.5);
    expect(blendProgress(3, 3)).toBe(1);
    expect(blendProgress(99, 3)).toBe(1);
    expect(blendProgress(0.2, 0)).toBe(1);
    // Ease-in-out: slow at both ends.
    expect(blendProgress(0.3, 3)).toBeLessThan(0.02);
    expect(blendProgress(2.7, 3)).toBeGreaterThan(0.98);
  });

  it("sweepRate integrates to exactly one sweep", () => {
    expect(sweepRate(0)).toBe(0);
    expect(sweepRate(1)).toBe(0);
    expect(sweepRate(-0.5)).toBe(0);
    expect(sweepRate(1.5)).toBe(0);
    expect(sweepRate(0.5)).toBeCloseTo(1.5);
    const n = 3000;
    let integral = 0;
    for (let i = 0; i < n; i++) integral += sweepRate((i + 0.5) / n) / n;
    expect(integral).toBeCloseTo(1, 5);
  });

  it("bumpEnvelope rises, holds at 1 and returns to 0", () => {
    expect(bumpEnvelope(0, 0.2, 0.45)).toBe(0);
    expect(bumpEnvelope(1, 0.2, 0.45)).toBe(0);
    expect(bumpEnvelope(-1, 0.2, 0.45)).toBe(0);
    expect(bumpEnvelope(2, 0.2, 0.45)).toBe(0);
    expect(bumpEnvelope(0.4, 0.2, 0.45)).toBeCloseTo(1);
    expect(bumpEnvelope(0.1, 0.2, 0.45)).toBeCloseTo(0.5);
    // Continuous at both ends.
    expect(bumpEnvelope(1e-4, 0.2, 0.45)).toBeLessThan(1e-3);
    expect(bumpEnvelope(1 - 1e-4, 0.2, 0.45)).toBeLessThan(1e-3);
    for (let i = 0; i <= 100; i++) {
      const v = bumpEnvelope(i / 100, 0.2, 0.45);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("punchEnvelope decays monotonically from 1 to 0", () => {
    expect(punchEnvelope(-1)).toBe(1);
    expect(punchEnvelope(0)).toBe(1);
    expect(punchEnvelope(1)).toBe(0);
    expect(punchEnvelope(5)).toBe(0);
    let prev = 1;
    for (let i = 1; i <= 50; i++) {
      const v = punchEnvelope(i / 50);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});
