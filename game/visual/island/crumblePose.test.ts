import { describe, expect, it } from "vitest";
import { hash01 } from "../../math";
import {
  CRUMBLE_RAND_STRIDE,
  FALL_DEPTH,
  FALL_MAX_DELAY,
  FALL_SECONDS,
  MIN_SCALE,
  applyFall,
  createPose,
  shakeFrequency,
  writeWarnPose,
} from "./crumblePose";

const ITEMS = 40;
const rand = new Float32Array(ITEMS * CRUMBLE_RAND_STRIDE);
for (let i = 0; i < rand.length; i++) rand[i] = hash01(i + 17);

/** Half-diagonal of the largest tile: how far a tilt can lift an edge. */
const TILE_REACH = 0.8;

describe("warning shake", () => {
  it("is exactly the resting pose at level 0", () => {
    const pose = createPose();
    pose.dx = 5;
    pose.shade = 1;
    writeWarnPose(pose, 0, 12.3, rand, 0, false);
    expect(pose).toEqual(createPose());
  });

  it("grows with the level and darkens the piece", () => {
    const pose = createPose();
    let early = 0;
    let late = 0;
    let earlyShade = 0;
    let lateShade = 0;
    for (let i = 0; i < ITEMS; i++) {
      for (let k = 0; k < 50; k++) {
        const phase = k * 0.37;
        writeWarnPose(pose, 0.15, phase, rand, i * CRUMBLE_RAND_STRIDE, false);
        early += Math.hypot(pose.dx, pose.dz);
        earlyShade += pose.shade;
        writeWarnPose(pose, 1, phase, rand, i * CRUMBLE_RAND_STRIDE, false);
        late += Math.hypot(pose.dx, pose.dz);
        lateShade += pose.shade;
      }
    }
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early * 2);
    expect(lateShade).toBeGreaterThan(earlyShade * 1.5);
  });

  it("stays small, never lifts a piece above the floor and keeps it whole", () => {
    const pose = createPose();
    for (let i = 0; i < ITEMS; i++) {
      for (let k = 0; k < 400; k++) {
        const level = (k % 21) / 20;
        writeWarnPose(pose, level, k * 0.173, rand, i * CRUMBLE_RAND_STRIDE, false);
        expect(Math.hypot(pose.dx, pose.dz)).toBeLessThan(0.07);
        expect(pose.dy).toBeLessThanOrEqual(0);
        expect(pose.dy).toBeGreaterThan(-0.05);
        // Highest point of a tilted tile's top edge stays under ~2 cm above y = 0.
        expect(pose.dy + Math.abs(pose.angle) * TILE_REACH).toBeLessThan(0.02);
        expect(pose.scale).toBe(1);
        expect(pose.fade).toBe(0);
        expect(pose.shade).toBeGreaterThanOrEqual(0);
        expect(pose.shade).toBeLessThanOrEqual(1);
      }
    }
  });

  it("only darkens and sags when motion is reduced", () => {
    const pose = createPose();
    writeWarnPose(pose, 0.8, 3.1, rand, 8, true);
    expect(pose.dx).toBe(0);
    expect(pose.dz).toBe(0);
    expect(pose.angle).toBe(0);
    expect(pose.dy).toBeLessThan(0);
    expect(pose.dy).toBeGreaterThan(-0.03);
    expect(pose.shade).toBeGreaterThan(0.4);
  });

  it("shakes faster as the drop approaches", () => {
    expect(shakeFrequency(1)).toBeGreaterThan(shakeFrequency(0));
    expect(shakeFrequency(5)).toBe(shakeFrequency(1));
  });
});

describe("fall", () => {
  it("holds the warning pose until the piece's own delay has passed", () => {
    const o = 3 * CRUMBLE_RAND_STRIDE;
    const delay = rand[o + 4] * FALL_MAX_DELAY;
    expect(delay).toBeGreaterThan(0);
    const warned = createPose();
    writeWarnPose(warned, 1, 7.7, rand, o, false);
    const pose = { ...warned };
    applyFall(pose, delay * 0.5, rand, o, 1, 0, false);
    expect(pose).toEqual(warned);
  });

  it("drops monotonically, drifts outward, tumbles and shrinks to nothing", () => {
    for (let i = 0; i < ITEMS; i++) {
      const o = i * CRUMBLE_RAND_STRIDE;
      const delay = rand[o + 4] * FALL_MAX_DELAY;
      const pose = createPose();
      let lastY = 0;
      let lastScale = 1;
      for (let t = 0; t <= FALL_SECONDS; t += 1 / 120) {
        // Level 0 = no shake underneath: this isolates the fall itself.
        writeWarnPose(pose, 0, 0, rand, o, false);
        applyFall(pose, t, rand, o, 0.6, 0.8, false);
        if (t > delay) expect(pose.dy).toBeLessThan(lastY);
        else expect(pose.dy).toBe(0);
        expect(pose.scale).toBeLessThanOrEqual(lastScale);
        expect(pose.scale).toBeGreaterThanOrEqual(MIN_SCALE);
        lastY = pose.dy;
        lastScale = pose.scale;
      }
      // By the time the group is declared gone every piece is far below and invisible.
      writeWarnPose(pose, 1, 0, rand, o, false);
      applyFall(pose, FALL_SECONDS, rand, o, 0.6, 0.8, false);
      expect(pose.dy).toBeLessThanOrEqual(-FALL_DEPTH);
      expect(pose.scale).toBe(MIN_SCALE);
      expect(pose.fade).toBe(1);
      expect(pose.dx * 0.6 + pose.dz * 0.8).toBeGreaterThan(0.3);
      expect(Math.abs(pose.angle)).toBeGreaterThan(0.5);
    }
  });

  it("is continuous at the moment a piece lets go", () => {
    const o = 5 * CRUMBLE_RAND_STRIDE;
    const delay = rand[o + 4] * FALL_MAX_DELAY;
    const before = createPose();
    const after = createPose();
    writeWarnPose(before, 1, 4.2, rand, o, false);
    writeWarnPose(after, 1, 4.2, rand, o, false);
    applyFall(after, delay + 1e-4, rand, o, 0, 1, false);
    expect(after.dx).toBeCloseTo(before.dx, 3);
    expect(after.dy).toBeCloseTo(before.dy, 3);
    expect(after.dz).toBeCloseTo(before.dz, 3);
    expect(after.angle).toBeCloseTo(before.angle, 3);
    expect(after.scale).toBe(1);
  });

  it("sinks and shrinks in place, without tumbling, when motion is reduced", () => {
    const o = 2 * CRUMBLE_RAND_STRIDE;
    const pose = createPose();
    writeWarnPose(pose, 1, 1, rand, o, true);
    applyFall(pose, 0.3, rand, o, 1, 0, true);
    expect(pose.dx).toBe(0);
    expect(pose.angle).toBe(0);
    expect(pose.scale).toBeLessThan(1);
    expect(pose.scale).toBeGreaterThan(MIN_SCALE);

    writeWarnPose(pose, 1, 1, rand, o, true);
    applyFall(pose, FALL_SECONDS, rand, o, 1, 0, true);
    expect(pose.scale).toBe(MIN_SCALE);
    expect(pose.fade).toBe(1);
    expect(pose.dy).toBeLessThan(-1);
  });
});
