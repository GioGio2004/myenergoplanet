import { describe, expect, it } from "vitest";
import { angleDelta, clamp, damp, hash01, inputToWorld } from "./math";

describe("math", () => {
  it("clamps", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });

  it("damp converges without overshoot", () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = damp(v, 10, 0.2, 1 / 60);
    expect(v).toBeGreaterThan(9.99);
    expect(v).toBeLessThanOrEqual(10);
  });

  it("angleDelta takes the short way round", () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it("maps stick-up to away from the camera", () => {
    const out = { x: 0, z: 0 };
    // Camera on +Z looking at the centre: up the screen is -Z, right is +X.
    inputToWorld(0, 1, 0, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-1);
    inputToWorld(1, 0, 0, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
    // Camera on +X: up the screen is -X, right is -Z.
    inputToWorld(0, 1, Math.PI / 2, out);
    expect(out.x).toBeCloseTo(-1);
    expect(out.z).toBeCloseTo(0);
    inputToWorld(1, 0, Math.PI / 2, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-1);
  });

  it("hash01 stays in range and varies", () => {
    const a = hash01(1);
    const b = hash01(2);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(a).not.toBe(b);
  });
});
