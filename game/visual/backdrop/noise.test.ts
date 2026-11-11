import { describe, expect, it } from "vitest";
import { buildMistNoise, equalizeToBytes, tileableFbm } from "./noise";

describe("tileableFbm", () => {
  it("is periodic with period 1 in both directions", () => {
    for (const [u, v] of [
      [0.13, 0.71],
      [0.5, 0.02],
      [0.98, 0.44],
    ]) {
      expect(tileableFbm(u + 1, v, 3)).toBeCloseTo(tileableFbm(u, v, 3), 9);
      expect(tileableFbm(u, v + 1, 3)).toBeCloseTo(tileableFbm(u, v, 3), 9);
      expect(tileableFbm(u - 1, v - 1, 3)).toBeCloseTo(tileableFbm(u, v, 3), 9);
    }
  });

  it("stays in 0..1 and differs between seeds", () => {
    let differing = 0;
    for (let i = 0; i < 200; i++) {
      const u = (i * 0.61803) % 1;
      const v = (i * 0.41421) % 1;
      const a = tileableFbm(u, v, 1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      if (Math.abs(a - tileableFbm(u, v, 57)) > 0.02) differing++;
    }
    expect(differing).toBeGreaterThan(120);
  });

  it("is continuous (no jumps between neighbouring samples)", () => {
    const step = 1 / 512;
    for (let i = 0; i < 512; i++) {
      const u = i * step;
      expect(Math.abs(tileableFbm(u + step, 0.3, 1) - tileableFbm(u, 0.3, 1))).toBeLessThan(0.03);
    }
  });
});

describe("equalizeToBytes", () => {
  it("produces a uniform histogram whatever the input distribution", () => {
    const field = new Float32Array(4096);
    for (let i = 0; i < field.length; i++) field[i] = Math.pow(i / field.length, 5); // very skewed
    const bytes = equalizeToBytes(field);
    const quarters = [0, 0, 0, 0];
    for (const b of bytes) quarters[b >> 6]++;
    for (const q of quarters) expect(q).toBe(1024);
  });

  it("preserves order", () => {
    const bytes = equalizeToBytes(Float32Array.from([0.9, 0.1, 0.5, 0.3]));
    expect(Array.from(bytes)).toEqual([192, 0, 128, 64]);
  });
});

describe("buildMistNoise", () => {
  const size = 32;
  const pixels = buildMistNoise(size);
  const at = (x: number, y: number, channel: number) =>
    pixels[(((y + size) % size) * size + ((x + size) % size)) * 4 + channel];

  it("returns RGBA8 pixels with an opaque alpha and an empty blue channel", () => {
    expect(pixels).toBeInstanceOf(Uint8Array);
    expect(pixels.length).toBe(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      expect(pixels[i * 4 + 2]).toBe(0);
      expect(pixels[i * 4 + 3]).toBe(255);
    }
  });

  it("is uniformly distributed in R and G, so shader thresholds are coverage fractions", () => {
    for (const channel of [0, 1]) {
      let above = 0;
      for (let i = 0; i < size * size; i++) if (pixels[i * 4 + channel] >= 153) above++; // 0.6 * 255
      expect(above / (size * size)).toBeCloseTo(0.4, 1);
    }
  });

  it("tiles seamlessly: the wrap-around seam is no rougher than the interior", () => {
    let seam = 0;
    let interior = 0;
    for (let y = 0; y < size; y++) {
      seam += Math.abs(at(0, y, 0) - at(-1, y, 0)) + Math.abs(at(y, 0, 0) - at(y, -1, 0));
      interior +=
        Math.abs(at(size / 2, y, 0) - at(size / 2 - 1, y, 0)) +
        Math.abs(at(y, size / 2, 0) - at(y, size / 2 - 1, 0));
    }
    expect(seam).toBeLessThan(interior * 2.5);
  });

  it("uses independent fields for the shape and the warp", () => {
    let differing = 0;
    for (let i = 0; i < size * size; i++) {
      if (Math.abs(pixels[i * 4] - pixels[i * 4 + 1]) > 16) differing++;
    }
    expect(differing).toBeGreaterThan(size * size * 0.5);
  });

  it("is deterministic", () => {
    expect(Array.from(buildMistNoise(16))).toEqual(Array.from(buildMistNoise(16)));
  });
});
