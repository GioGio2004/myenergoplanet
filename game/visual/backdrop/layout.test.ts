import { describe, expect, it } from "vitest";
import { QUALITY_PRESETS, gameConfig } from "../../config";
import {
  CLOUD_BAND,
  LANTERN_BAND,
  MOUNTAIN_LAYERS,
  lanternCeiling,
  lanternCountFor,
  layoutClouds,
  layoutLanterns,
  ridgeHeight,
} from "./layout";

const CLOUD_COUNTS = Object.values(QUALITY_PRESETS).map((q) => q.clouds);

describe("layoutClouds", () => {
  it("returns exactly the requested number of clouds", () => {
    for (const n of [0, 1, ...CLOUD_COUNTS]) expect(layoutClouds(n)).toHaveLength(n);
  });

  it("is deterministic", () => {
    expect(layoutClouds(18)).toEqual(layoutClouds(18));
  });

  it("keeps every cloud, bob included, inside the band below the island", () => {
    for (const n of CLOUD_COUNTS) {
      for (const c of layoutClouds(n)) {
        expect(c.height - CLOUD_BAND.bob).toBeGreaterThanOrEqual(CLOUD_BAND.minY - 1e-9);
        expect(c.height + CLOUD_BAND.bob).toBeLessThanOrEqual(CLOUD_BAND.maxY + 1e-9);
        expect(c.radius).toBeGreaterThanOrEqual(CLOUD_BAND.minRadius);
        expect(c.radius).toBeLessThanOrEqual(CLOUD_BAND.maxRadius);
        // The whole billboard (half as tall as it is wide) stays under the floor of the island.
        expect(c.height + CLOUD_BAND.bob + c.halfWidth / 2).toBeLessThan(
          -gameConfig.arena.slabThickness,
        );
      }
    }
  });

  it("keeps the inner edge of every cloud clear of the column under the island", () => {
    for (const c of layoutClouds(26)) {
      expect(c.radius - c.halfWidth).toBeGreaterThanOrEqual(CLOUD_BAND.axisClearance - 1e-9);
    }
  });

  it("sorts lowest first so translucent layers stack correctly from above", () => {
    const clouds = layoutClouds(26);
    for (let i = 1; i < clouds.length; i++) {
      expect(clouds[i].height).toBeGreaterThanOrEqual(clouds[i - 1].height);
    }
  });

  it("drifts slowly, all with the same wind", () => {
    for (const c of layoutClouds(26)) {
      const linear = c.speed * c.radius;
      expect(linear).toBeGreaterThan(0.1);
      expect(linear).toBeLessThan(0.4);
    }
  });

  it("spreads clouds over every side of the island", () => {
    const quadrants = [0, 0, 0, 0];
    for (const c of layoutClouds(18)) {
      expect(c.angle).toBeGreaterThanOrEqual(0);
      expect(c.angle).toBeLessThan(Math.PI * 2);
      quadrants[Math.floor(c.angle / (Math.PI / 2))]++;
    }
    for (const q of quadrants) expect(q).toBeGreaterThanOrEqual(2);
  });

  it("gives valid shader inputs", () => {
    for (const c of layoutClouds(26)) {
      expect(c.seed).toBeGreaterThanOrEqual(0);
      expect(c.seed).toBeLessThan(1);
      expect(c.opacity).toBeGreaterThan(0.5);
      expect(c.opacity).toBeLessThanOrEqual(1);
      expect(Math.abs(c.flip)).toBe(1);
      expect(c.halfWidth).toBeGreaterThan(1.5);
      expect(c.halfWidth).toBeLessThan(6);
    }
  });
});

describe("layoutLanterns", () => {
  it("floats four to six lanterns depending on the preset", () => {
    for (const n of CLOUD_COUNTS) {
      const count = lanternCountFor(n);
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(6);
      expect(layoutLanterns(count)).toHaveLength(count);
    }
    expect(lanternCountFor(QUALITY_PRESETS.low.clouds)).toBeLessThan(
      lanternCountFor(QUALITY_PRESETS.high.clouds),
    );
  });

  it("is deterministic", () => {
    expect(layoutLanterns(6)).toEqual(layoutLanterns(6));
  });

  it("keeps every lantern in its ring around the island", () => {
    for (const count of [4, 5, 6]) {
      for (const l of layoutLanterns(count)) {
        expect(l.radius).toBeGreaterThanOrEqual(LANTERN_BAND.minRadius);
        expect(l.radius).toBeLessThanOrEqual(LANTERN_BAND.maxRadius);
        expect(l.height - l.bob).toBeGreaterThanOrEqual(LANTERN_BAND.minY);
        expect(l.height + l.bob).toBeLessThanOrEqual(LANTERN_BAND.maxY);
      }
    }
  });

  it("never lets a lantern rise into the sight line from the camera to the island", () => {
    // The shallowest gameplay pitch is the final-stretch one; the sight line to the
    // near rim climbs tan(pitch) per unit beyond the rim.
    const slope = Math.tan((gameConfig.camera.finalPitchDegrees * Math.PI) / 180);
    for (const count of [4, 5, 6]) {
      for (const l of layoutLanterns(count)) {
        const top = l.height + l.bob + LANTERN_BAND.halfHeight * l.scale;
        expect(top).toBeLessThanOrEqual(lanternCeiling(l.radius) + 1e-9);
        expect(top).toBeLessThan((l.radius - gameConfig.arena.radius) * slope);
      }
    }
  });

  it("stays small and slow", () => {
    for (const l of layoutLanterns(6)) {
      expect(l.scale).toBeLessThanOrEqual(1.2);
      expect(Math.abs(l.speed) * l.radius).toBeLessThan(0.3);
      expect(l.phase).toBeGreaterThanOrEqual(0);
      expect(l.phase).toBeLessThan(1);
    }
  });

  it("mixes scarlet and gold paper and both drift directions", () => {
    const lanterns = layoutLanterns(6);
    expect(lanterns.some((l) => l.tint === 0)).toBe(true);
    expect(lanterns.some((l) => l.tint === 1)).toBe(true);
    expect(lanterns.some((l) => l.speed > 0)).toBe(true);
    expect(lanterns.some((l) => l.speed < 0)).toBe(true);
  });

  it("spaces lanterns around the whole ring", () => {
    const lanterns = layoutLanterns(6);
    for (let i = 0; i < lanterns.length; i++) {
      const next = lanterns[(i + 1) % lanterns.length];
      let gap = next.angle - lanterns[i].angle;
      if (gap < 0) gap += Math.PI * 2;
      expect(gap).toBeGreaterThan(0.25);
    }
  });
});

describe("lanternCeiling", () => {
  it("rises with distance and is capped at the top of the band", () => {
    expect(lanternCeiling(10)).toBeLessThan(lanternCeiling(14));
    expect(lanternCeiling(40)).toBe(LANTERN_BAND.maxY);
  });
});

describe("ridgeHeight", () => {
  it("is seamless around the full circle", () => {
    for (const layer of MOUNTAIN_LAYERS) {
      for (const theta of [0, 0.37, 1.9, 4.4]) {
        expect(ridgeHeight(layer, theta + Math.PI * 2)).toBeCloseTo(ridgeHeight(layer, theta), 6);
      }
    }
  });

  it("stays between the valley floor and the tallest allowed peak", () => {
    for (const layer of MOUNTAIN_LAYERS) {
      for (let i = 0; i < 720; i++) {
        const h = ridgeHeight(layer, (i / 720) * Math.PI * 2);
        expect(h).toBeGreaterThanOrEqual(layer.valleyY - 1e-9);
        expect(h).toBeLessThanOrEqual(layer.valleyY + layer.amplitude + 1e-9);
      }
    }
  });

  it("has real relief: peaks well above the valleys on every layer", () => {
    for (const layer of MOUNTAIN_LAYERS) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 720; i++) {
        const h = ridgeHeight(layer, (i / 720) * Math.PI * 2);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
      expect(max - min).toBeGreaterThan(layer.amplitude * 0.45);
      expect(min).toBeLessThan(layer.valleyY + layer.amplitude * 0.05);
    }
  });

  it("gives every layer its own skyline", () => {
    const [far, mid] = MOUNTAIN_LAYERS;
    let differing = 0;
    for (let i = 0; i < 90; i++) {
      const theta = (i / 90) * Math.PI * 2;
      const a = (ridgeHeight(far, theta) - far.valleyY) / far.amplitude;
      const b = (ridgeHeight(mid, theta) - mid.valleyY) / mid.amplitude;
      if (Math.abs(a - b) > 0.05) differing++;
    }
    expect(differing).toBeGreaterThan(20);
  });
});

describe("MOUNTAIN_LAYERS", () => {
  it("is ordered farthest first with farther layers taller, fainter and bluer", () => {
    for (let i = 1; i < MOUNTAIN_LAYERS.length; i++) {
      const far = MOUNTAIN_LAYERS[i - 1];
      const near = MOUNTAIN_LAYERS[i];
      expect(far.radius).toBeGreaterThan(near.radius);
      expect(far.valleyY + far.amplitude).toBeGreaterThan(near.valleyY + near.amplitude);
      expect(far.opacity).toBeLessThan(near.opacity);
      expect(far.distance).toBeGreaterThan(near.distance);
    }
  });

  it("sits far outside the play area", () => {
    for (const layer of MOUNTAIN_LAYERS) {
      expect(layer.radius).toBeGreaterThanOrEqual(60);
      expect(layer.radius).toBeLessThanOrEqual(110);
    }
  });
});
