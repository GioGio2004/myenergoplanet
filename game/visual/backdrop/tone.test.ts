import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { sceneColor, sceneColorMix } from "./colors";
import { BACKDROP_COLORS } from "./palette";
import { acesFilmic, inverseAcesFilmic, type Rgb } from "./tone";

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

/** Colours the unlit backdrop shaders and the fog receive through `sceneColor`. */
const COMPENSATED = [
  "sky",
  "deep",
  "zenith",
  "haze",
  "islandGlow",
  "mistDeep",
  "mist",
  "cloudLight",
  "cloudShade",
  "paper",
  "mountainNear",
  "mountainFar",
  "lanternTrim",
] as const;

describe("acesFilmic", () => {
  it("maps black to black and stays within 0..1", () => {
    const black = acesFilmic(rgb(0, 0, 0), rgb(0, 0, 0));
    expect(black.r).toBe(0);
    expect(black.g).toBe(0);
    expect(black.b).toBe(0);

    const hot = acesFilmic(rgb(50, 50, 50), rgb(0, 0, 0));
    for (const v of [hot.r, hot.g, hot.b]) {
      expect(v).toBeGreaterThan(0.95);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("matches the three.js curve for mid grey", () => {
    // ACESFilmicToneMapping( vec3( 0.18 ) ) at exposure 1: 0.18 / 0.6 = 0.3 on every
    // channel, and both matrices (nearly) preserve neutral greys, so the result is
    // RRTAndODTFit( 0.3 ) on every channel.
    const out = acesFilmic(rgb(0.18, 0.18, 0.18), rgb(0, 0, 0));
    const v = 0.3;
    const fit = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
    expect(out.r).toBeCloseTo(fit, 2);
    expect(out.g).toBeCloseTo(fit, 2);
    expect(out.b).toBeCloseTo(fit, 2);
  });

  it("crushes dark blues, which is why the backdrop compensates", () => {
    const sky = new THREE.Color(BACKDROP_COLORS.sky);
    const mapped = acesFilmic(sky, rgb(0, 0, 0));
    expect(mapped.b).toBeLessThan(sky.b * 0.8);
  });

  it("scales with exposure", () => {
    const dim = acesFilmic(rgb(0.2, 0.2, 0.2), rgb(0, 0, 0), 0.5);
    const bright = acesFilmic(rgb(0.2, 0.2, 0.2), rgb(0, 0, 0), 2);
    expect(bright.g).toBeGreaterThan(dim.g);
  });
});

describe("inverseAcesFilmic", () => {
  it("round-trips every compensated backdrop colour", () => {
    for (const name of COMPENSATED) {
      const display = new THREE.Color(BACKDROP_COLORS[name]);
      const scene = inverseAcesFilmic(display, rgb(0, 0, 0));
      for (const v of [scene.r, scene.g, scene.b]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      const back = acesFilmic(scene, rgb(0, 0, 0));
      const shown = new THREE.Color().setRGB(back.r, back.g, back.b);
      // The pixel that reaches the screen is the palette colour, to the last 8-bit step.
      expect(shown.getHexString(), name).toBe(display.getHexString());
    }
  });

  it("maps black to the toe of the curve (which tone-maps back to black) and may write in place", () => {
    // The curve dips below zero for tiny inputs, so "black" has a small positive preimage.
    const c = rgb(0, 0, 0);
    const out = inverseAcesFilmic(c, c);
    expect(out).toBe(c);
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(0.003);
    }
    const back = acesFilmic(c, rgb(0, 0, 0));
    expect(back.r).toBeCloseTo(0, 6);
    expect(back.g).toBeCloseTo(0, 6);
    expect(back.b).toBeCloseTo(0, 6);
  });

  it("stays finite and non-negative for out-of-range input", () => {
    for (const input of [rgb(1, 1, 1), rgb(1, 0, 0), rgb(0, 0, 1), rgb(2, 2, 2), rgb(-1, 0, 0)]) {
      const out = inverseAcesFilmic(input, rgb(0, 0, 0));
      for (const v of [out.r, out.g, out.b]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("honours exposure", () => {
    const display = rgb(0.1, 0.2, 0.3);
    const scene = inverseAcesFilmic(display, rgb(0, 0, 0), 1.4);
    const back = acesFilmic(scene, rgb(0, 0, 0), 1.4);
    expect(back.r).toBeCloseTo(display.r, 4);
    expect(back.g).toBeCloseTo(display.g, 4);
    expect(back.b).toBeCloseTo(display.b, 4);
  });
});

describe("sceneColor", () => {
  it("returns the plain linear colour without post-processing", () => {
    const c = sceneColor(BACKDROP_COLORS.sky, false);
    const plain = new THREE.Color(BACKDROP_COLORS.sky);
    expect(c.r).toBeCloseTo(plain.r, 6);
    expect(c.g).toBeCloseTo(plain.g, 6);
    expect(c.b).toBeCloseTo(plain.b, 6);
  });

  it("lifts dark colours under post-processing so ACES lands back on the palette", () => {
    const plain = new THREE.Color(BACKDROP_COLORS.sky);
    const lifted = sceneColor(BACKDROP_COLORS.sky, true);
    expect(lifted.b).toBeGreaterThan(plain.b);
    const shown = acesFilmic(lifted, rgb(0, 0, 0));
    expect(new THREE.Color().setRGB(shown.r, shown.g, shown.b).getHexString()).toBe(
      plain.getHexString(),
    );
  });

  it("writes into the target it is given", () => {
    const target = new THREE.Color();
    expect(sceneColor(BACKDROP_COLORS.haze, true, target)).toBe(target);
  });
});

describe("sceneColorMix", () => {
  it("returns the endpoints at t = 0 and t = 1", () => {
    for (const post of [false, true]) {
      const a = sceneColorMix(BACKDROP_COLORS.mountainNear, BACKDROP_COLORS.mountainFar, 0, post);
      const b = sceneColorMix(BACKDROP_COLORS.mountainNear, BACKDROP_COLORS.mountainFar, 1, post);
      const near = sceneColor(BACKDROP_COLORS.mountainNear, post);
      const far = sceneColor(BACKDROP_COLORS.mountainFar, post);
      expect(a.r).toBeCloseTo(near.r, 6);
      expect(a.b).toBeCloseTo(near.b, 6);
      expect(b.r).toBeCloseTo(far.r, 6);
      expect(b.b).toBeCloseTo(far.b, 6);
    }
  });

  it("lands between the endpoints half way", () => {
    const mid = sceneColorMix(BACKDROP_COLORS.mountainNear, BACKDROP_COLORS.mountainFar, 0.5, false);
    const near = new THREE.Color(BACKDROP_COLORS.mountainNear);
    const far = new THREE.Color(BACKDROP_COLORS.mountainFar);
    expect(mid.b).toBeGreaterThan(near.b);
    expect(mid.b).toBeLessThan(far.b);
  });
});
