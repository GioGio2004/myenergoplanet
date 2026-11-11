// Ground shockwave rings: a tiny ring-buffer pool, pure logic (no three.js, no React).
// Each ring expands from an impact point, thins out and fades over a fraction of a second.

export type ShockwavePool = {
  readonly capacity: number;
  cursor: number;
  alive: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Seconds since the ring was spawned. */
  readonly age: Float32Array;
  /** Total lifetime in seconds; `0` means the slot is free. */
  readonly duration: Float32Array;
  /** Outer radius the ring settles at. */
  readonly radius: Float32Array;
};

export function createShockwavePool(capacity: number): ShockwavePool {
  const n = Math.max(1, Math.floor(capacity));
  return {
    capacity: n,
    cursor: 0,
    alive: 0,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    age: new Float32Array(n),
    duration: new Float32Array(n),
    radius: new Float32Array(n),
  };
}

/** Spawn a ring (recycles the oldest when full). Returns its slot, or -1 for a degenerate ring. */
export function spawnShockwave(
  pool: ShockwavePool,
  x: number,
  y: number,
  z: number,
  radius: number,
  duration: number,
): number {
  if (!(radius > 0) || !(duration > 0)) return -1;
  const i = pool.cursor;
  pool.cursor = i + 1 === pool.capacity ? 0 : i + 1;
  if (pool.duration[i] <= 0) pool.alive++;
  pool.x[i] = x;
  pool.y[i] = y;
  pool.z[i] = z;
  pool.age[i] = 0;
  pool.duration[i] = duration;
  pool.radius[i] = radius;
  return i;
}

export function clearShockwaves(pool: ShockwavePool): void {
  pool.duration.fill(0);
  pool.cursor = 0;
  pool.alive = 0;
}

/** Age every live ring by `dt` seconds and free the finished ones. Returns the live count. */
export function updateShockwaves(pool: ShockwavePool, dt: number): number {
  if (!(dt > 0) || pool.alive === 0) return pool.alive;
  let alive = pool.alive;
  for (let i = 0; i < pool.capacity; i++) {
    const d = pool.duration[i];
    if (d <= 0) continue;
    const age = pool.age[i] + dt;
    if (age >= d) {
      pool.duration[i] = 0;
      alive--;
    } else {
      pool.age[i] = age;
    }
  }
  pool.alive = alive;
  return alive;
}

/** Ease-out with a slight overshoot past 1 (ink settling back), `p` in 0..1. */
export function easeOutBack(p: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  const q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
}

export function easeOutCubic(p: number): number {
  const q = 1 - p;
  return 1 - q * q * q;
}

/** Fraction of the final radius a ring starts at. */
const START_SCALE = 0.25;
/** Band thickness as a fraction of the current radius: fat brush stroke → hairline. */
const THICK_START = 0.55;
const THICK_END = 0.07;
const PEAK_ALPHA = 0.85;

/**
 * Write the live rings, compacted to the front: instance matrices (flat on XZ, uniform
 * radius scale) and two floats per ring (alpha, band thickness). `overshoot = false`
 * (reduced motion) swaps the springy expansion for a plain ease-out.
 * Returns the number of instances written.
 */
export function writeShockwaveInstances(
  pool: ShockwavePool,
  matrices: Float32Array,
  ringData: Float32Array,
  overshoot: boolean,
): number {
  if (pool.alive === 0) return 0;
  let n = 0;
  for (let i = 0; i < pool.capacity; i++) {
    const d = pool.duration[i];
    if (d <= 0) continue;
    const p = pool.age[i] / d;
    const grow = overshoot ? easeOutBack(p) : easeOutCubic(p);
    const scale = pool.radius[i] * (START_SCALE + (1 - START_SCALE) * grow);
    const fade = 1 - p;

    const m = n * 16;
    matrices[m] = scale;
    matrices[m + 1] = 0;
    matrices[m + 2] = 0;
    matrices[m + 3] = 0;
    matrices[m + 4] = 0;
    matrices[m + 5] = 1;
    matrices[m + 6] = 0;
    matrices[m + 7] = 0;
    matrices[m + 8] = 0;
    matrices[m + 9] = 0;
    matrices[m + 10] = scale;
    matrices[m + 11] = 0;
    matrices[m + 12] = pool.x[i];
    matrices[m + 13] = pool.y[i];
    matrices[m + 14] = pool.z[i];
    matrices[m + 15] = 1;

    const k = n * 2;
    // Snap in over the first few percent, then an ease-in fade so the ring reads before it goes.
    ringData[k] = PEAK_ALPHA * Math.min(1, p * 14) * fade * Math.sqrt(fade);
    ringData[k + 1] = THICK_START + (THICK_END - THICK_START) * easeOutCubic(p);
    n++;
  }
  return n;
}
