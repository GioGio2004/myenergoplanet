// Droplet particle pool: pure logic over typed arrays, no three.js, no React.
//
// A fixed number of droplets live in parallel Float32Arrays. Spawning is ring-buffer
// allocation (when the pool is full the oldest allocation is recycled), so neither an
// event burst nor a frame update ever allocates.

/** Injectable random source, returns a number in [0, 1). */
export type Random = () => number;

export type ParticlePool = {
  readonly capacity: number;
  /** Next ring-buffer slot to hand out. */
  cursor: number;
  /** Number of droplets with life left. */
  alive: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Seconds left; `<= 0` means the slot is free. */
  readonly life: Float32Array;
  /** Life the droplet started with (drives the shrink curve). */
  readonly maxLife: Float32Array;
  /** Radius at full size, world units. */
  readonly size: Float32Array;
  /** Linear-sRGB colour. */
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Per-droplet multiplier on the environment gravity (dust hangs, liquid falls). */
  readonly gravity: Float32Array;
  /** Per-droplet linear drag, 1/seconds. */
  readonly drag: Float32Array;
};

/** The world the droplets move in. Mutate one instance in place; never allocate per frame. */
export type ParticleEnv = {
  /** Vertical acceleration, negative = down. */
  gravity: number;
  /** Height of the island's top surface. */
  floorY: number;
  /** Droplets only land on the island inside this radius. */
  floorRadius: number;
  /** Droplets below this height are removed. */
  killY: number;
  /** Fraction of vertical speed kept when a droplet bounces off the island. */
  restitution: number;
  /** Fraction of horizontal speed kept on that bounce. */
  floorGrip: number;
  /** A droplet that touches the island has at most this long left: it splats and shrinks away. */
  splatSeconds: number;
};

export function createParticlePool(capacity: number): ParticlePool {
  const n = Math.max(1, Math.floor(capacity));
  return {
    capacity: n,
    cursor: 0,
    alive: 0,
    px: new Float32Array(n),
    py: new Float32Array(n),
    pz: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    vz: new Float32Array(n),
    life: new Float32Array(n),
    maxLife: new Float32Array(n),
    size: new Float32Array(n),
    r: new Float32Array(n),
    g: new Float32Array(n),
    b: new Float32Array(n),
    gravity: new Float32Array(n),
    drag: new Float32Array(n),
  };
}

/**
 * Spawn one droplet. Returns its slot, or -1 when `life` / `size` are not positive.
 * When every slot is busy the oldest allocation is overwritten.
 */
export function spawnParticle(
  pool: ParticlePool,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  life: number,
  size: number,
  r: number,
  g: number,
  b: number,
  gravityScale = 1,
  drag = 0,
): number {
  if (!(life > 0) || !(size > 0)) return -1;
  const i = pool.cursor;
  pool.cursor = i + 1 === pool.capacity ? 0 : i + 1;
  if (pool.life[i] <= 0) pool.alive++;
  pool.px[i] = x;
  pool.py[i] = y;
  pool.pz[i] = z;
  pool.vx[i] = vx;
  pool.vy[i] = vy;
  pool.vz[i] = vz;
  pool.life[i] = life;
  pool.maxLife[i] = life;
  pool.size[i] = size;
  pool.r[i] = r;
  pool.g[i] = g;
  pool.b[i] = b;
  pool.gravity[i] = gravityScale;
  pool.drag[i] = drag;
  return i;
}

/** Free every slot. */
export function clearParticles(pool: ParticlePool): void {
  pool.life.fill(0);
  pool.cursor = 0;
  pool.alive = 0;
}

/** Vertical speed below which a bounce is swallowed and the droplet just sits. */
const MIN_BOUNCE_SPEED = 0.6;

/**
 * Advance every live droplet by `dt` seconds: gravity, drag, a soft bounce-and-splat
 * on the island top, and removal on timeout or below the kill plane.
 * Returns the number of droplets still alive.
 */
export function updateParticles(pool: ParticlePool, dt: number, env: ParticleEnv): number {
  if (!(dt > 0) || pool.alive === 0) return pool.alive;

  const { px, py, pz, vx, vy, vz, life, maxLife, size, gravity, drag } = pool;
  const floorR2 = env.floorRadius * env.floorRadius;
  const gdt = env.gravity * dt;
  let alive = pool.alive;

  for (let i = 0; i < pool.capacity; i++) {
    let left = life[i];
    if (left <= 0) continue;

    left -= dt;
    if (left <= 0) {
      life[i] = 0;
      alive--;
      continue;
    }

    // Semi-implicit Euler with a linear drag factor (clamped so big steps cannot reverse it).
    const keep = Math.max(0, 1 - drag[i] * dt);
    let nvx = vx[i] * keep;
    let nvy = (vy[i] + gdt * gravity[i]) * keep;
    let nvz = vz[i] * keep;

    const prevY = py[i];
    const x = px[i] + nvx * dt;
    let y = prevY + nvy * dt;
    const z = pz[i] + nvz * dt;

    if (y < env.killY) {
      life[i] = 0;
      alive--;
      continue;
    }

    const overIsland = x * x + z * z <= floorR2;

    // Rising into the island from underneath (a knockout burst below the rim): the rock
    // swallows it rather than letting it pop out of the dohyo.
    if (overIsland && prevY < env.floorY && y >= env.floorY) {
      life[i] = 0;
      alive--;
      continue;
    }

    // Land on the island: only when coming down from above the surface, inside the rim.
    const rest = env.floorY + size[i] * 0.5;
    if (overIsland && nvy < 0 && y < rest && prevY >= env.floorY) {
      y = rest;
      nvy = -nvy * env.restitution;
      if (nvy < MIN_BOUNCE_SPEED) nvy = 0;
      nvx *= env.floorGrip;
      nvz *= env.floorGrip;
      if (left > env.splatSeconds) {
        // Shorten the life but keep the life *fraction*, so the size does not pop.
        const fraction = left / maxLife[i];
        left = env.splatSeconds;
        maxLife[i] = left / fraction;
      }
    }

    px[i] = x;
    py[i] = y;
    pz[i] = z;
    vx[i] = nvx;
    vy[i] = nvy;
    vz[i] = nvz;
    life[i] = left;
  }

  pool.alive = alive;
  return alive;
}

/** Size multiplier over a droplet's life: quick pop-in, holds, then shrinks away at the end. */
export function lifeScale(left: number, maxLife: number): number {
  if (left <= 0 || maxLife <= 0) return 0;
  const t = left >= maxLife ? 1 : left / maxLife;
  const k = 1 - t;
  const shrink = 1 - k * k * k;
  const age = maxLife - left;
  const popIn = age >= 0.04 ? 1 : 0.4 + age * 15;
  return shrink * popIn;
}

/**
 * Write the live droplets, compacted to the front, as instance matrices (column-major
 * 4×4, 16 floats each) and colours (3 floats each). The droplet's local +Y axis points
 * along its velocity and is stretched with speed, squeezing the other two axes to keep
 * the volume. Returns the number of instances written (the mesh's `count`).
 */
export function writeParticleInstances(
  pool: ParticlePool,
  matrices: Float32Array,
  colors: Float32Array,
  stretchPerSpeed: number,
  maxStretch: number,
): number {
  if (pool.alive === 0) return 0;
  const { px, py, pz, vx, vy, vz, life, maxLife, size, r, g, b } = pool;
  let n = 0;

  for (let i = 0; i < pool.capacity; i++) {
    const left = life[i];
    if (left <= 0) continue;

    const s = size[i] * lifeScale(left, maxLife[i]);

    // Unit direction of travel (falls back to straight up when at rest).
    const sx = vx[i];
    const sy = vy[i];
    const sz = vz[i];
    const speed = Math.sqrt(sx * sx + sy * sy + sz * sz);
    let dx = 0;
    let dy = 1;
    let dz = 0;
    let stretch = 1;
    if (speed > 1e-4) {
      dx = sx / speed;
      dy = sy / speed;
      dz = sz / speed;
      stretch = 1 + Math.min(speed * stretchPerSpeed, maxStretch);
    }
    const along = s * stretch;
    const across = s / Math.sqrt(stretch);

    // Branch-light orthonormal basis around d (Duff et al. 2017): (b1, b2, d) is right-handed,
    // so the columns (b2, d, b1) form a proper rotation (no mirrored winding).
    const sign = dz >= 0 ? 1 : -1;
    const a = -1 / (sign + dz);
    const c = dx * dy * a;
    const b1x = 1 + sign * dx * dx * a;
    const b1y = sign * c;
    const b1z = -sign * dx;
    const b2x = c;
    const b2y = sign + dy * dy * a;
    const b2z = -dy;

    const m = n * 16;
    matrices[m] = b2x * across;
    matrices[m + 1] = b2y * across;
    matrices[m + 2] = b2z * across;
    matrices[m + 3] = 0;
    matrices[m + 4] = dx * along;
    matrices[m + 5] = dy * along;
    matrices[m + 6] = dz * along;
    matrices[m + 7] = 0;
    matrices[m + 8] = b1x * across;
    matrices[m + 9] = b1y * across;
    matrices[m + 10] = b1z * across;
    matrices[m + 11] = 0;
    matrices[m + 12] = px[i];
    matrices[m + 13] = py[i];
    matrices[m + 14] = pz[i];
    matrices[m + 15] = 1;

    const k = n * 3;
    colors[k] = r[i];
    colors[k + 1] = g[i];
    colors[k + 2] = b[i];
    n++;
  }
  return n;
}

/** Small, fast, seedable PRNG (mulberry32). Deterministic for a given seed. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
