import { describe, expect, it } from "vitest";
import {
  clearParticles,
  createParticlePool,
  createRandom,
  lifeScale,
  spawnParticle,
  updateParticles,
  writeParticleInstances,
  type ParticleEnv,
  type ParticlePool,
} from "./particlePool";

const env = (over: Partial<ParticleEnv> = {}): ParticleEnv => ({
  gravity: -10,
  floorY: 0,
  floorRadius: 6,
  killY: -9,
  restitution: 0.3,
  floorGrip: 0.5,
  splatSeconds: 0.2,
  ...over,
});

/** Spawn a plain white droplet with sensible defaults. */
function spawn(
  pool: ParticlePool,
  p: { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number } = {},
  life = 1,
  size = 0.1,
  gravityScale = 1,
  drag = 0,
): number {
  return spawnParticle(
    pool,
    p.x ?? 0,
    p.y ?? 5,
    p.z ?? 0,
    p.vx ?? 0,
    p.vy ?? 0,
    p.vz ?? 0,
    life,
    size,
    1,
    1,
    1,
    gravityScale,
    drag,
  );
}

describe("particle pool: spawning", () => {
  it("starts empty", () => {
    const pool = createParticlePool(8);
    expect(pool.capacity).toBe(8);
    expect(pool.alive).toBe(0);
    expect(pool.cursor).toBe(0);
  });

  it("clamps a silly capacity to at least one slot", () => {
    expect(createParticlePool(0).capacity).toBe(1);
    expect(createParticlePool(3.9).capacity).toBe(3);
  });

  it("stores every field of a spawned droplet", () => {
    const pool = createParticlePool(4);
    const i = spawnParticle(pool, 1, 2, 3, 4, 5, 6, 0.75, 0.25, 0.5, 0.25, 0.125, 0.5, 2);
    expect(i).toBe(0);
    expect(pool.alive).toBe(1);
    expect([pool.px[i], pool.py[i], pool.pz[i]]).toEqual([1, 2, 3]);
    expect([pool.vx[i], pool.vy[i], pool.vz[i]]).toEqual([4, 5, 6]);
    expect(pool.life[i]).toBe(0.75);
    expect(pool.maxLife[i]).toBe(0.75);
    expect(pool.size[i]).toBe(0.25);
    expect([pool.r[i], pool.g[i], pool.b[i]]).toEqual([0.5, 0.25, 0.125]);
    expect(pool.gravity[i]).toBe(0.5);
    expect(pool.drag[i]).toBe(2);
  });

  it("rejects droplets with no life or no size", () => {
    const pool = createParticlePool(4);
    expect(spawn(pool, {}, 0)).toBe(-1);
    expect(spawn(pool, {}, 1, 0)).toBe(-1);
    expect(spawn(pool, {}, Number.NaN)).toBe(-1);
    expect(pool.alive).toBe(0);
    expect(pool.cursor).toBe(0);
  });

  it("recycles the oldest slot when the pool is full (ring buffer)", () => {
    const pool = createParticlePool(3);
    expect(spawn(pool, { x: 10 })).toBe(0);
    expect(spawn(pool, { x: 11 })).toBe(1);
    expect(spawn(pool, { x: 12 })).toBe(2);
    expect(pool.alive).toBe(3);

    // Full: the fourth droplet takes over slot 0, the fifth slot 1.
    expect(spawn(pool, { x: 13 })).toBe(0);
    expect(spawn(pool, { x: 14 })).toBe(1);
    expect(pool.alive).toBe(3);
    expect(Array.from(pool.px)).toEqual([13, 14, 12]);
  });

  it("keeps the live count right when a wrapped spawn lands on a dead slot", () => {
    const pool = createParticlePool(2);
    spawn(pool, {}, 0.1);
    spawn(pool, {}, 5);
    updateParticles(pool, 0.2, env()); // slot 0 expires
    expect(pool.alive).toBe(1);
    expect(spawn(pool)).toBe(0);
    expect(pool.alive).toBe(2);
  });

  it("clears", () => {
    const pool = createParticlePool(4);
    spawn(pool);
    spawn(pool);
    clearParticles(pool);
    expect(pool.alive).toBe(0);
    expect(pool.cursor).toBe(0);
    expect(writeParticleInstances(pool, new Float32Array(64), new Float32Array(12), 0, 0)).toBe(0);
  });
});

describe("particle pool: update", () => {
  it("moves ballistically under gravity", () => {
    const pool = createParticlePool(2);
    const i = spawn(pool, { y: 5, vx: 2, vy: 3, vz: -1 }, 10);
    const dt = 1 / 60;
    for (let s = 0; s < 30; s++) updateParticles(pool, dt, env());
    const t = 0.5;
    expect(pool.px[i]).toBeCloseTo(2 * t, 4);
    expect(pool.pz[i]).toBeCloseTo(-1 * t, 4);
    expect(pool.vy[i]).toBeCloseTo(3 - 10 * t, 4);
    // Semi-implicit Euler lands within one step's worth of the analytic height.
    expect(pool.py[i]).toBeCloseTo(5 + 3 * t - 5 * t * t, 1);
  });

  it("applies the per-droplet gravity scale", () => {
    const pool = createParticlePool(2);
    const heavy = spawn(pool, { y: 5 }, 10, 0.1, 1);
    const dusty = spawn(pool, { y: 5 }, 10, 0.1, 0.25);
    updateParticles(pool, 0.1, env());
    expect(pool.vy[heavy]).toBeCloseTo(-1);
    expect(pool.vy[dusty]).toBeCloseTo(-0.25);
  });

  it("drag slows droplets and never reverses them", () => {
    const pool = createParticlePool(2);
    const i = spawn(pool, { y: 5, vx: 4 }, 10, 0.1, 0, 2);
    updateParticles(pool, 0.1, env());
    expect(pool.vx[i]).toBeCloseTo(4 * 0.8);
    // A huge step with strong drag stops the droplet instead of flinging it backwards.
    const j = spawn(pool, { y: 5, vx: 4 }, 10, 0.1, 0, 50);
    updateParticles(pool, 0.1, env());
    expect(pool.vx[j]).toBe(0);
  });

  it("expires droplets when their life runs out", () => {
    const pool = createParticlePool(4);
    const i = spawn(pool, {}, 0.25, 0.1, 0);
    expect(updateParticles(pool, 0.2, env())).toBe(1);
    expect(pool.life[i]).toBeCloseTo(0.05);
    expect(updateParticles(pool, 0.2, env())).toBe(0);
    expect(pool.life[i]).toBe(0);
    expect(pool.alive).toBe(0);
  });

  it("removes droplets that fall below the kill plane", () => {
    const pool = createParticlePool(2);
    // Outside the island, so nothing catches it.
    spawn(pool, { x: 20, y: -8.9, vy: -5 }, 10);
    expect(updateParticles(pool, 0.1, env())).toBe(0);
  });

  it("does nothing for a zero or negative step", () => {
    const pool = createParticlePool(2);
    const i = spawn(pool, { y: 5, vy: 1 }, 1);
    expect(updateParticles(pool, 0, env())).toBe(1);
    expect(updateParticles(pool, -1, env())).toBe(1);
    expect(pool.py[i]).toBe(5);
    expect(pool.life[i]).toBe(1);
  });

  it("bounces softly off the island and splats (life cut short)", () => {
    const pool = createParticlePool(2);
    const i = spawn(pool, { y: 0.1, vx: 2, vy: -6 }, 2, 0.1, 0);
    updateParticles(pool, 0.05, env());
    expect(pool.py[i]).toBeCloseTo(0.05); // resting on its own radius
    expect(pool.vy[i]).toBeCloseTo(6 * 0.3);
    expect(pool.vx[i]).toBeCloseTo(2 * 0.5);
    expect(pool.life[i]).toBeCloseTo(0.2);
    // The life *fraction* is preserved so the droplet does not visibly pop in size.
    expect(pool.life[i] / pool.maxLife[i]).toBeCloseTo(1.95 / 2);
  });

  it("comes to rest on the island instead of jittering", () => {
    const pool = createParticlePool(2);
    const i = spawn(pool, { y: 0.3 }, 50, 0.1);
    const e = env({ splatSeconds: 100 });
    for (let s = 0; s < 240; s++) updateParticles(pool, 1 / 60, e);
    expect(pool.py[i]).toBeCloseTo(0.05);
    expect(pool.vy[i]).toBe(0);
  });

  it("falls past the island when outside its radius", () => {
    const pool = createParticlePool(2);
    const i = spawn(pool, { x: 6.5, y: 0.1, vy: -6 }, 2, 0.1, 0);
    updateParticles(pool, 0.05, env());
    expect(pool.py[i]).toBeLessThan(0);
    expect(pool.vy[i]).toBe(-6);
    expect(pool.life[i]).toBeCloseTo(1.95);
  });

  it("respects a shrinking island radius", () => {
    const pool = createParticlePool(2);
    const i = spawn(pool, { x: 4.5, y: 0.1, vy: -6 }, 2, 0.1, 0);
    updateParticles(pool, 0.05, env({ floorRadius: 4 }));
    expect(pool.py[i]).toBeLessThan(0);
  });

  it("swallows droplets rising into the island from below", () => {
    const pool = createParticlePool(2);
    spawn(pool, { x: 1, y: -0.2, vy: 8 }, 2, 0.1, 0);
    expect(updateParticles(pool, 0.05, env())).toBe(0);
    // …but not the ones rising outside the rim.
    const j = spawn(pool, { x: 7, y: -0.2, vy: 8 }, 2, 0.1, 0);
    expect(updateParticles(pool, 0.05, env())).toBe(1);
    expect(pool.py[j]).toBeGreaterThan(0);
  });

  it("keeps `alive` equal to the number of slots with life left", () => {
    const pool = createParticlePool(16);
    const rng = createRandom(7);
    for (let step = 0; step < 200; step++) {
      if (step % 3 === 0) {
        spawn(pool, { x: rng() * 14 - 7, y: rng() * 3, vy: rng() * 6 - 3 }, 0.1 + rng());
      }
      updateParticles(pool, 1 / 30, env());
      let counted = 0;
      for (let i = 0; i < pool.capacity; i++) if (pool.life[i] > 0) counted++;
      expect(pool.alive).toBe(counted);
    }
  });
});

describe("lifeScale", () => {
  it("is 0 when dead and close to 1 for most of the life", () => {
    expect(lifeScale(0, 1)).toBe(0);
    expect(lifeScale(-1, 1)).toBe(0);
    expect(lifeScale(0.8, 1)).toBeGreaterThan(0.95);
    expect(lifeScale(0.5, 1)).toBeGreaterThan(0.8);
  });

  it("pops in and shrinks away monotonically at the end", () => {
    expect(lifeScale(1, 1)).toBeLessThan(0.5); // just spawned
    let prev = lifeScale(0.3, 1);
    for (let left = 0.29; left > 0; left -= 0.01) {
      const s = lifeScale(left, 1);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
    expect(prev).toBeLessThan(0.05);
  });
});

describe("writeParticleInstances", () => {
  const col = (m: Float32Array, n: number, c: number): [number, number, number] => [
    m[n * 16 + c * 4],
    m[n * 16 + c * 4 + 1],
    m[n * 16 + c * 4 + 2],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a: number[]) => Math.sqrt(dot(a, a));
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  it("compacts live droplets to the front and copies their colours", () => {
    const pool = createParticlePool(4);
    spawnParticle(pool, 1, 1, 1, 0, 0, 0, 0.05, 0.1, 1, 0, 0);
    spawnParticle(pool, 2, 2, 2, 0, 0, 0, 5, 0.1, 0, 1, 0);
    spawnParticle(pool, 3, 3, 3, 0, 0, 0, 0.05, 0.1, 1, 0, 0);
    spawnParticle(pool, 4, 4, 4, 0, 0, 0, 5, 0.1, 0, 0, 1);
    updateParticles(pool, 0.1, env({ gravity: 0 })); // slots 0 and 2 die

    const matrices = new Float32Array(4 * 16);
    const colors = new Float32Array(4 * 3);
    expect(writeParticleInstances(pool, matrices, colors, 0.1, 1)).toBe(2);
    expect([matrices[12], matrices[13], matrices[14], matrices[15]]).toEqual([2, 2, 2, 1]);
    expect([matrices[28], matrices[29], matrices[30], matrices[31]]).toEqual([4, 4, 4, 1]);
    expect(Array.from(colors.subarray(0, 6))).toEqual([0, 1, 0, 0, 0, 1]);
  });

  it("writes an upright, unstretched sphere for a droplet at rest", () => {
    const pool = createParticlePool(1);
    spawnParticle(pool, 0, 1, 0, 0, 0, 0, 1, 0.2, 1, 1, 1, 0);
    updateParticles(pool, 0.5, env({ gravity: 0 }));
    const m = new Float32Array(16);
    writeParticleInstances(pool, m, new Float32Array(3), 0.1, 1);
    const s = 0.2 * lifeScale(0.5, 1);
    expect(len(col(m, 0, 0))).toBeCloseTo(s);
    expect(len(col(m, 0, 2))).toBeCloseTo(s);
    expect(col(m, 0, 1)[0]).toBeCloseTo(0);
    expect(col(m, 0, 1)[1]).toBeCloseTo(s);
    expect(col(m, 0, 1)[2]).toBeCloseTo(0);
  });

  it("stretches along the velocity with a proper (unmirrored) rotation", () => {
    const rng = createRandom(99);
    const velocities: [number, number, number][] = [
      [0, 0, 5],
      [0, 0, -5],
      [3, 0, 0],
      [0, -7, 0],
      [0, 7, 0],
    ];
    for (let k = 0; k < 40; k++) velocities.push([rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6]);

    for (const [vx, vy, vz] of velocities) {
      const pool = createParticlePool(1);
      spawnParticle(pool, 0, 100, 0, vx, vy, vz, 1, 0.2, 1, 1, 1, 0);
      updateParticles(pool, 0.5, env({ gravity: 0 }));
      const m = new Float32Array(16);
      expect(writeParticleInstances(pool, m, new Float32Array(3), 0.1, 1)).toBe(1);

      const x = col(m, 0, 0);
      const y = col(m, 0, 1);
      const z = col(m, 0, 2);
      const speed = Math.hypot(vx, vy, vz);
      const stretch = 1 + Math.min(speed * 0.1, 1);
      const s = 0.2 * lifeScale(0.5, 1);

      // Y axis points along the velocity and carries the stretch…
      expect(len(y)).toBeCloseTo(s * stretch, 5);
      expect(dot(y, [vx, vy, vz]) / (len(y) * speed)).toBeCloseTo(1, 5);
      // …the other two are squeezed to keep the volume, and everything is orthogonal.
      expect(len(x)).toBeCloseTo(s / Math.sqrt(stretch), 5);
      expect(len(z)).toBeCloseTo(s / Math.sqrt(stretch), 5);
      expect(dot(x, y)).toBeCloseTo(0, 5);
      expect(dot(y, z)).toBeCloseTo(0, 5);
      expect(dot(x, z)).toBeCloseTo(0, 5);
      // Right-handed: positive determinant, so triangle winding is preserved.
      expect(dot(cross(x, y), z)).toBeGreaterThan(0);
      expect(len(x) * len(y) * len(z)).toBeCloseTo(s * s * s, 5);
    }
  });

  it("caps the stretch", () => {
    const pool = createParticlePool(1);
    spawnParticle(pool, 0, 1, 0, 0, 0, 1000, 1, 0.2, 1, 1, 1, 0);
    updateParticles(pool, 0.5, env({ gravity: 0 }));
    const m = new Float32Array(16);
    writeParticleInstances(pool, m, new Float32Array(3), 0.1, 1.5);
    expect(len(col(m, 0, 1))).toBeCloseTo(0.2 * lifeScale(0.5, 1) * 2.5, 5);
  });
});

describe("createRandom", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    let differs = false;
    for (let i = 0; i < 500; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v !== c()) differs = true;
    }
    expect(differs).toBe(true);
  });

  it("is roughly uniform", () => {
    const rng = createRandom(1);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += rng();
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
  });
});
