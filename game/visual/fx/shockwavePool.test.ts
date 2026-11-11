import { describe, expect, it } from "vitest";
import {
  clearShockwaves,
  createShockwavePool,
  easeOutBack,
  easeOutCubic,
  spawnShockwave,
  updateShockwaves,
  writeShockwaveInstances,
} from "./shockwavePool";

describe("shockwave pool", () => {
  it("spawns, ages and expires rings", () => {
    const pool = createShockwavePool(4);
    expect(spawnShockwave(pool, 1, 0.03, 2, 2, 0.35)).toBe(0);
    expect(pool.alive).toBe(1);
    expect(updateShockwaves(pool, 0.2)).toBe(1);
    expect(pool.age[0]).toBeCloseTo(0.2);
    expect(updateShockwaves(pool, 0.2)).toBe(0);
    expect(pool.duration[0]).toBe(0);
  });

  it("rejects degenerate rings", () => {
    const pool = createShockwavePool(2);
    expect(spawnShockwave(pool, 0, 0, 0, 0, 0.3)).toBe(-1);
    expect(spawnShockwave(pool, 0, 0, 0, 1, 0)).toBe(-1);
    expect(pool.alive).toBe(0);
  });

  it("recycles the oldest ring when full", () => {
    const pool = createShockwavePool(2);
    spawnShockwave(pool, 1, 0, 0, 1, 1);
    spawnShockwave(pool, 2, 0, 0, 1, 1);
    updateShockwaves(pool, 0.5);
    expect(spawnShockwave(pool, 3, 0, 0, 1, 1)).toBe(0);
    expect(pool.alive).toBe(2);
    expect(pool.x[0]).toBe(3);
    expect(pool.age[0]).toBe(0); // restarted
    expect(pool.age[1]).toBeCloseTo(0.5);
  });

  it("clears", () => {
    const pool = createShockwavePool(2);
    spawnShockwave(pool, 1, 0, 0, 1, 1);
    clearShockwaves(pool);
    expect(pool.alive).toBe(0);
    expect(writeShockwaveInstances(pool, new Float32Array(32), new Float32Array(4), true)).toBe(0);
  });

  it("ignores a zero step", () => {
    const pool = createShockwavePool(1);
    spawnShockwave(pool, 0, 0, 0, 1, 1);
    expect(updateShockwaves(pool, 0)).toBe(1);
    expect(pool.age[0]).toBe(0);
  });
});

describe("shockwave easing", () => {
  it("easeOutBack overshoots slightly and settles at 1", () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    let peak = 0;
    for (let p = 0; p <= 1; p += 0.01) peak = Math.max(peak, easeOutBack(p));
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.12);
  });

  it("easeOutCubic never overshoots", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let prev = 0;
    for (let p = 0.01; p <= 1; p += 0.01) {
      const v = easeOutCubic(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe("writeShockwaveInstances", () => {
  /** Radius scale of the single ring at `age`, with or without overshoot. */
  function sample(age: number, overshoot: boolean) {
    const pool = createShockwavePool(1);
    spawnShockwave(pool, 3, 0.03, -2, 2, 0.4);
    if (age > 0) updateShockwaves(pool, age);
    const m = new Float32Array(16);
    const data = new Float32Array(2);
    const n = writeShockwaveInstances(pool, m, data, overshoot);
    return { n, m, scale: m[0], alpha: data[0], thickness: data[1] };
  }

  it("writes a flat ring at the spawn point", () => {
    const { n, m } = sample(0.1, true);
    expect(n).toBe(1);
    expect(m[0]).toBe(m[10]); // uniform radius scale on X and Z
    expect(m[5]).toBe(1);
    expect(m[12]).toBe(3);
    expect(m[13]).toBeCloseTo(0.03);
    expect(m[14]).toBe(-2);
    expect(m[15]).toBe(1);
  });

  it("expands, thins and fades over its life", () => {
    const early = sample(0.04, false);
    const mid = sample(0.2, false);
    const late = sample(0.38, false);
    expect(early.scale).toBeLessThan(mid.scale);
    expect(mid.scale).toBeLessThan(late.scale);
    expect(late.scale).toBeLessThanOrEqual(2);
    expect(early.thickness).toBeGreaterThan(mid.thickness);
    expect(mid.thickness).toBeGreaterThan(late.thickness);
    expect(mid.alpha).toBeGreaterThan(late.alpha);
    expect(late.alpha).toBeLessThan(0.05);
    expect(sample(0, false).alpha).toBe(0); // snaps in rather than flashing on frame 0
  });

  it("overshoots its radius only when allowed (reduced motion keeps it plain)", () => {
    let springPeak = 0;
    let plainPeak = 0;
    for (let age = 0.01; age < 0.4; age += 0.01) {
      springPeak = Math.max(springPeak, sample(age, true).scale);
      plainPeak = Math.max(plainPeak, sample(age, false).scale);
    }
    expect(springPeak).toBeGreaterThan(2.02);
    expect(plainPeak).toBeLessThanOrEqual(2);
  });

  it("compacts live rings to the front", () => {
    const pool = createShockwavePool(3);
    spawnShockwave(pool, 1, 0, 0, 1, 0.1);
    spawnShockwave(pool, 2, 0, 0, 1, 1);
    spawnShockwave(pool, 3, 0, 0, 1, 1);
    updateShockwaves(pool, 0.2); // the first one is done
    const m = new Float32Array(48);
    expect(writeShockwaveInstances(pool, m, new Float32Array(6), true)).toBe(2);
    expect(m[12]).toBe(2);
    expect(m[28]).toBe(3);
  });
});
