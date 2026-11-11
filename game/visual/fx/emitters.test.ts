import { describe, expect, it } from "vitest";
import { PLAYER_STYLES, QUALITY_PRESETS } from "../../config";
import {
  burstBudget,
  emitBracePuff,
  emitCrownSplash,
  emitDashSpray,
  emitHitBurst,
  emitKnockoutBurst,
  emitRespawnShimmer,
} from "./emitters";
import { createPalette, hexToLinear, mixPalette, paletteForStyle, srgbToLinear } from "./palette";
import { createParticlePool, createRandom, type ParticlePool } from "./particlePool";

// Pure primaries so a droplet's owner can be read back from its colour.
const RED = createPalette("#ff0000", "#ff0000");
const BLUE = createPalette("#0000ff", "#0000ff");

function live(pool: ParticlePool): number[] {
  const out: number[] = [];
  for (let i = 0; i < pool.capacity; i++) if (pool.life[i] > 0) out.push(i);
  return out;
}

function mean(pool: ParticlePool, field: Float32Array): number {
  const idx = live(pool);
  let sum = 0;
  for (const i of idx) sum += field[i];
  return sum / idx.length;
}

describe("burstBudget", () => {
  it("is 1 at the medium preset and clamped at the extremes", () => {
    expect(burstBudget(QUALITY_PRESETS.medium.particles)).toBe(1);
    expect(burstBudget(QUALITY_PRESETS.low.particles)).toBeCloseTo(0.45);
    expect(burstBudget(QUALITY_PRESETS.high.particles)).toBeCloseTo(1.5);
    expect(burstBudget(1)).toBe(0.45);
    expect(burstBudget(100000)).toBe(1.5);
  });
});

describe("emitHitBurst", () => {
  it("scales the droplet count with strength: a nudge ~4, a full dash hit 24+", () => {
    const pool = createParticlePool(256);
    const rng = createRandom(1);
    expect(emitHitBurst(pool, rng, RED, BLUE, 0, 0.6, 0, 1, 0, 0, false, false, 1)).toBe(4);
    expect(pool.alive).toBe(4);
    const mid = emitHitBurst(pool, rng, RED, BLUE, 0, 0.6, 0, 1, 0, 0.5, false, false, 1);
    const full = emitHitBurst(pool, rng, RED, BLUE, 0, 0.6, 0, 1, 0, 1, true, false, 1);
    expect(mid).toBeGreaterThan(4);
    expect(full).toBeGreaterThan(mid);
    expect(full).toBeGreaterThanOrEqual(24);
  });

  it("clamps out-of-range strength", () => {
    const pool = createParticlePool(256);
    const rng = createRandom(1);
    expect(emitHitBurst(pool, rng, RED, BLUE, 0, 0.6, 0, 1, 0, -3, false, false, 1)).toBe(4);
    expect(emitHitBurst(pool, rng, RED, BLUE, 0, 0.6, 0, 1, 0, 9, false, false, 1)).toBe(24);
  });

  it("uses both wrestlers' colours, about half each", () => {
    const pool = createParticlePool(64);
    emitHitBurst(pool, createRandom(3), RED, BLUE, 0, 0.6, 0, 1, 0, 1, false, false, 1);
    let red = 0;
    let blue = 0;
    for (const i of live(pool)) {
      if (pool.r[i] > 0.9 && pool.b[i] < 0.1) red++;
      if (pool.b[i] > 0.9 && pool.r[i] < 0.1) blue++;
    }
    expect(red).toBe(12);
    expect(blue).toBe(12);
  });

  it("flies outward mostly perpendicular to the line between the wrestlers, and upward", () => {
    const pool = createParticlePool(256);
    // Wrestlers lined up along X: the burst should fan out along Z and up.
    emitHitBurst(pool, createRandom(5), RED, BLUE, 0, 0.6, 0, 3, 0, 1, true, false, 1.5);
    let along = 0;
    let across = 0;
    for (const i of live(pool)) {
      expect(pool.vy[i]).toBeGreaterThan(0);
      along += Math.abs(pool.vx[i]);
      across += Math.abs(pool.vz[i]);
    }
    expect(across).toBeGreaterThan(along * 2.5);
  });

  it("is faster for stronger hits and softer when braced", () => {
    const speed = (strength: number, braced: boolean) => {
      const pool = createParticlePool(256);
      emitHitBurst(pool, createRandom(11), RED, BLUE, 0, 0.6, 0, 1, 0, strength, false, braced, 1);
      let sum = 0;
      const idx = live(pool);
      for (const i of idx) sum += Math.hypot(pool.vx[i], pool.vy[i], pool.vz[i]);
      return sum / idx.length;
    };
    expect(speed(1, false)).toBeGreaterThan(speed(0.2, false) * 1.8);
    expect(speed(1, true)).toBeLessThan(speed(1, false));
  });

  it("starts at the contact point, never below the dohyo surface", () => {
    const pool = createParticlePool(64);
    emitHitBurst(pool, createRandom(2), RED, BLUE, 2, -0.5, -1, 0, 0, 1, false, false, 1);
    for (const i of live(pool)) {
      expect(pool.py[i]).toBeGreaterThan(0);
      expect(Math.abs(pool.px[i] - 2)).toBeLessThan(0.2);
      expect(Math.abs(pool.pz[i] + 1)).toBeLessThan(0.2);
      expect(Number.isFinite(pool.vx[i] + pool.vy[i] + pool.vz[i])).toBe(true); // zero-length normal is fine
    }
  });

  it("is deterministic for a given random seed", () => {
    const run = (seed: number) => {
      const pool = createParticlePool(64);
      emitHitBurst(pool, createRandom(seed), RED, BLUE, 1, 0.6, 2, 1, 1, 0.8, true, false, 1);
      return [Array.from(pool.px), Array.from(pool.vy), Array.from(pool.size), Array.from(pool.life)];
    };
    expect(run(123)).toEqual(run(123));
    expect(run(123)).not.toEqual(run(124));
  });

  it("wraps around a small pool without growing it", () => {
    const pool = createParticlePool(10);
    emitHitBurst(pool, createRandom(8), RED, BLUE, 0, 0.6, 0, 1, 0, 1, true, false, 1.5);
    expect(pool.alive).toBe(10);
    expect(pool.px.length).toBe(10);
  });
});

describe("emitCrownSplash", () => {
  it("makes a ring of droplets around the landing point, shooting up and out", () => {
    const pool = createParticlePool(256);
    const n = emitCrownSplash(pool, createRandom(4), RED, 2, -1, 0, 20, 1);
    expect(n).toBe(pool.alive);
    for (const i of live(pool)) {
      const dx = pool.px[i] - 2;
      const dz = pool.pz[i] + 1;
      const r = Math.hypot(dx, dz);
      expect(r).toBeGreaterThan(0.35);
      expect(r).toBeLessThan(0.6);
      expect(pool.vy[i]).toBeGreaterThan(0);
      // Outward: horizontal velocity points away from the centre.
      expect(pool.vx[i] * dx + pool.vz[i] * dz).toBeGreaterThan(0);
      expect(pool.r[i]).toBeGreaterThan(0.9);
    }
  });

  it("covers the whole circle", () => {
    const pool = createParticlePool(256);
    emitCrownSplash(pool, createRandom(4), RED, 0, 0, 0, 20, 1);
    const quadrants = [0, 0, 0, 0];
    for (const i of live(pool)) {
      quadrants[(pool.px[i] >= 0 ? 0 : 1) + (pool.pz[i] >= 0 ? 0 : 2)]++;
    }
    for (const q of quadrants) expect(q).toBeGreaterThanOrEqual(4);
  });

  it("scales with landing speed", () => {
    const soft = createParticlePool(256);
    const hard = createParticlePool(256);
    const nSoft = emitCrownSplash(soft, createRandom(4), RED, 0, 0, 0, 3, 1);
    const nHard = emitCrownSplash(hard, createRandom(4), RED, 0, 0, 0, 20, 1);
    expect(nHard).toBeGreaterThan(nSoft * 2);
    expect(mean(hard, hard.vy)).toBeGreaterThan(mean(soft, soft.vy) * 1.5);
    // Faster than the reference speed does not blow the count up.
    const over = createParticlePool(256);
    expect(emitCrownSplash(over, createRandom(4), RED, 0, 0, 0, 500, 1)).toBe(nHard);
  });

  it("four simultaneous intro landings fit in the pool at every quality preset", () => {
    for (const preset of Object.values(QUALITY_PRESETS)) {
      const pool = createParticlePool(preset.particles);
      const rng = createRandom(6);
      let total = 0;
      for (let p = 0; p < 4; p++) {
        total += emitCrownSplash(pool, rng, RED, p, 0, 0, 20, burstBudget(pool.capacity));
      }
      expect(total).toBeLessThanOrEqual(preset.particles);
      expect(pool.alive).toBe(total);
    }
  });
});

describe("emitDashSpray", () => {
  it("sprays behind the wrestler, opposite to the dash direction", () => {
    const pool = createParticlePool(128);
    // Dashing toward +X from (1, 0.6, 1): droplets should be thrown toward -X.
    emitDashSpray(pool, createRandom(9), BLUE, 1, 0.6, 1, 0, 4, 0, 1);
    expect(pool.alive).toBeGreaterThanOrEqual(10);
    for (const i of live(pool)) {
      expect(pool.vx[i]).toBeLessThan(0);
      expect(pool.px[i]).toBeLessThan(1);
      expect(pool.py[i]).toBeGreaterThan(0);
      expect(pool.b[i]).toBeGreaterThan(0.9);
    }
  });

  it("includes a few low droplets skidding along the ground", () => {
    const pool = createParticlePool(128);
    emitDashSpray(pool, createRandom(9), BLUE, 0, 0.6, 0, 0, 0, 1, 1);
    const low = live(pool).filter((i) => pool.py[i] < 0.1);
    expect(low.length).toBeGreaterThanOrEqual(2);
    for (const i of low) expect(pool.vy[i]).toBeLessThan(1);
  });

  it("survives a zero-length direction", () => {
    const pool = createParticlePool(128);
    emitDashSpray(pool, createRandom(9), BLUE, 0, 0.6, 0, 0, 0, 0, 1);
    for (const i of live(pool)) {
      expect(Number.isFinite(pool.px[i] + pool.vx[i] + pool.vz[i])).toBe(true);
    }
  });
});

describe("emitKnockoutBurst", () => {
  it("uses a large share of the pool at every quality preset", () => {
    for (const preset of Object.values(QUALITY_PRESETS)) {
      const pool = createParticlePool(preset.particles);
      const n = emitKnockoutBurst(
        pool,
        createRandom(1),
        RED,
        7,
        -2,
        0,
        6,
        -9,
        0,
        burstBudget(pool.capacity),
      );
      expect(n).toBeGreaterThanOrEqual(20);
      expect(n).toBeLessThanOrEqual(72);
      expect(n / preset.particles).toBeGreaterThan(0.25);
      expect(n / preset.particles).toBeLessThan(0.5);
      expect(pool.alive).toBe(n);
    }
    const medium = createParticlePool(140);
    expect(emitKnockoutBurst(medium, createRandom(1), RED, 0, 0, 0, 0, 0, 0, 1)).toBe(50);
  });

  it("never asks for more droplets than the pool holds", () => {
    const pool = createParticlePool(8);
    expect(emitKnockoutBurst(pool, createRandom(1), RED, 0, 0, 0, 0, 0, 0, 1)).toBe(8);
    expect(pool.alive).toBe(8);
  });

  it("inherits the victim's horizontal velocity", () => {
    const still = createParticlePool(128);
    const moving = createParticlePool(128);
    emitKnockoutBurst(still, createRandom(2), RED, 7, -2, 0, 0, -9, 0, 1);
    emitKnockoutBurst(moving, createRandom(2), RED, 7, -2, 0, 8, -9, 0, 1);
    expect(Math.abs(mean(still, still.vx))).toBeLessThan(1);
    expect(mean(moving, moving.vx) - mean(still, still.vx)).toBeCloseTo(8 * 0.65, 4);
    expect(mean(moving, moving.vz)).toBeCloseTo(mean(still, still.vz), 4);
  });

  it("caps absurd inherited speeds and pops upward even while plummeting", () => {
    const pool = createParticlePool(128);
    emitKnockoutBurst(pool, createRandom(2), RED, 7, -2, 0, 500, -500, 0, 1);
    expect(mean(pool, pool.vx)).toBeLessThan(10.5);
    expect(mean(pool, pool.vy)).toBeGreaterThan(0);
  });

  it("spreads in every horizontal direction, lives long and is the victim's colour", () => {
    const pool = createParticlePool(128);
    emitKnockoutBurst(pool, createRandom(3), BLUE, 0, -2, 0, 0, 0, 0, 1);
    let px = 0;
    let nx = 0;
    let pz = 0;
    let nz = 0;
    for (const i of live(pool)) {
      if (pool.vx[i] > 0) px++;
      else nx++;
      if (pool.vz[i] > 0) pz++;
      else nz++;
      expect(pool.life[i]).toBeGreaterThanOrEqual(1);
      expect(pool.b[i]).toBeGreaterThan(0.9);
      expect(Math.hypot(pool.px[i], pool.py[i] + 2, pool.pz[i])).toBeLessThan(0.4);
    }
    for (const n of [px, nx, pz, nz]) expect(n).toBeGreaterThan(12);
  });
});

describe("emitRespawnShimmer / emitBracePuff", () => {
  it("shimmer: a few fine droplets falling around the wrestler", () => {
    const pool = createParticlePool(128);
    const n = emitRespawnShimmer(pool, createRandom(1), RED, 1, 3, 2, 1);
    expect(n).toBe(8);
    for (const i of live(pool)) {
      expect(pool.vy[i]).toBeLessThan(0);
      expect(pool.size[i]).toBeLessThanOrEqual(0.05 + 1e-6);
      expect(Math.hypot(pool.px[i] - 1, pool.pz[i] - 2)).toBeLessThan(0.75);
    }
  });

  it("brace puff: a low, slow, short-lived ring at the feet", () => {
    const pool = createParticlePool(128);
    const n = emitBracePuff(pool, createRandom(1), RED, 1, 2, 0, 1);
    expect(n).toBe(10);
    for (const i of live(pool)) {
      const dx = pool.px[i] - 1;
      const dz = pool.pz[i] - 2;
      expect(Math.hypot(dx, dz)).toBeCloseTo(0.5, 4);
      expect(pool.py[i]).toBeLessThan(0.1);
      expect(pool.vx[i] * dx + pool.vz[i] * dz).toBeGreaterThan(0);
      expect(pool.vy[i]).toBeLessThan(1);
      expect(pool.life[i]).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(pool.gravity[i]).toBeLessThan(0.5); // dust hangs
    }
  });
});

describe("palette", () => {
  it("converts sRGB to linear like three.js", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 6);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 6);
  });

  it("parses hex colours", () => {
    const out = new Float32Array(5);
    hexToLinear("#EC2F36", out, 1);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(srgbToLinear(0xec / 255), 6);
    expect(out[2]).toBeCloseTo(srgbToLinear(0x2f / 255), 6);
    expect(out[3]).toBeCloseTo(srgbToLinear(0x36 / 255), 6);
    expect(out[4]).toBe(0);
    expect(Array.from(hexToLinear("#fff", new Float32Array(3)))).toEqual([1, 1, 1]);
    expect(Array.from(hexToLinear("f00", new Float32Array(3)))).toEqual([1, 0, 0]);
    // Garbage falls back to white rather than NaN.
    expect(Array.from(hexToLinear("nope", new Float32Array(3)))).toEqual([1, 1, 1]);
  });

  it("caches one palette per style and keeps the slots distinguishable", () => {
    const palettes = PLAYER_STYLES.map(paletteForStyle);
    expect(paletteForStyle(PLAYER_STYLES[0])).toBe(palettes[0]);
    for (let a = 0; a < palettes.length; a++) {
      for (let b = a + 1; b < palettes.length; b++) {
        const d = Math.hypot(
          palettes[a][0] - palettes[b][0],
          palettes[a][1] - palettes[b][1],
          palettes[a][2] - palettes[b][2],
        );
        expect(d).toBeGreaterThan(0.2);
      }
    }
  });

  it("mixes palettes", () => {
    const out = mixPalette(new Float32Array(6), RED, BLUE, 0.25);
    expect(Array.from(out)).toEqual([0.75, 0, 0.25, 0.75, 0, 0.25]);
  });

  it("tints droplets between the body colour and the glow, never beyond", () => {
    const pal = createPalette("#000000", "#ffffff");
    const pool = createParticlePool(256);
    emitKnockoutBurst(pool, createRandom(5), pal, 0, 0, 0, 0, 0, 0, 1.5);
    let max = 0;
    for (const i of live(pool)) {
      expect(pool.r[i]).toBeGreaterThanOrEqual(0);
      expect(pool.r[i]).toBe(pool.g[i]);
      max = Math.max(max, pool.r[i]);
    }
    expect(max).toBeGreaterThan(0.1);
    expect(max).toBeLessThanOrEqual(0.45 + 1e-6);
  });
});
