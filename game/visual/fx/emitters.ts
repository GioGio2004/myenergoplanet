// Burst recipes: how each game moment turns into droplets. Pure functions over a
// ParticlePool with an injectable random source (deterministic in tests), no three.js.
//
// `budget` scales droplet counts with the pool size, so the Low preset (60 droplets)
// keeps every effect readable without one burst starving the next.

import { spawnParticle, type ParticlePool, type Random } from "./particlePool";
import type { DropletPalette } from "./palette";

const TAU = Math.PI * 2;

/** How far a droplet's colour may drift from the body colour toward the glow tint. */
const GLOW_MIX = 0.45;

/** Droplet-count multiplier for a pool of `capacity` droplets (1 at the Medium preset). */
export function burstBudget(capacity: number): number {
  const b = capacity / 140;
  return b < 0.45 ? 0.45 : b > 1.5 ? 1.5 : b;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function saturate(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Spawn one droplet tinted somewhere between the palette's body colour and its glow. */
function drop(
  pool: ParticlePool,
  rng: Random,
  pal: DropletPalette,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  life: number,
  size: number,
  gravityScale: number,
  drag: number,
): void {
  const t = rng();
  const m = t * t * GLOW_MIX; // most droplets stay close to the body colour
  spawnParticle(
    pool,
    x,
    y,
    z,
    vx,
    vy,
    vz,
    life,
    size,
    pal[0] + (pal[3] - pal[0]) * m,
    pal[1] + (pal[4] - pal[1]) * m,
    pal[2] + (pal[5] - pal[2]) * m,
    gravityScale,
    drag,
  );
}

/**
 * Impact between two wrestlers: droplets in both colours fan out in the plane
 * perpendicular to the line between them, mostly upwards.
 * `(nx, nz)` points from wrestler A to wrestler B (need not be normalised).
 * Returns the number of droplets spawned.
 */
export function emitHitBurst(
  pool: ParticlePool,
  rng: Random,
  palA: DropletPalette,
  palB: DropletPalette,
  x: number,
  y: number,
  z: number,
  nx: number,
  nz: number,
  strength: number,
  dash: boolean,
  braced: boolean,
  budget: number,
): number {
  const s = saturate(strength);
  const len = Math.hypot(nx, nz);
  const ax = len > 1e-5 ? nx / len : 1;
  const az = len > 1e-5 ? nz / len : 0;
  // Horizontal tangent of the contact plane.
  const tx = -az;
  const tz = ax;

  const count = Math.max(4, Math.round((mix(4, 24, s) + (dash ? 5 : 0)) * budget));
  const baseSpeed = mix(2.2, 7.5, s) * (braced ? 0.8 : 1);
  const baseSize = mix(0.05, 0.085, s);
  const y0 = Math.max(y, 0.15);

  for (let i = 0; i < count; i++) {
    const fromB = (i & 1) === 1;
    const side = fromB ? 1 : -1;
    const theta = rng() * TAU;
    const lateral = Math.cos(theta);
    const up = Math.abs(Math.sin(theta)) * 0.85 + 0.25;
    const along = side * rng() * 0.35; // a little spill back toward the droplet's own wrestler
    const speed = baseSpeed * (0.45 + 0.55 * rng());
    drop(
      pool,
      rng,
      fromB ? palB : palA,
      x + ax * side * 0.08,
      y0,
      z + az * side * 0.08,
      (tx * lateral + ax * along) * speed,
      up * speed,
      (tz * lateral + az * along) * speed,
      0.45 + rng() * 0.4 + s * 0.25,
      baseSize * (0.7 + 0.6 * rng()),
      1,
      0.25,
    );
  }
  return count;
}

/**
 * Landing: a crown splash. A ring of droplets shoots up and out from around the
 * wrestler's footprint, with a low fast skirt along the ground. `speed` is the
 * impact speed (the intro drop lands at roughly 20 units/s).
 */
export function emitCrownSplash(
  pool: ParticlePool,
  rng: Random,
  pal: DropletPalette,
  x: number,
  z: number,
  floorY: number,
  speed: number,
  budget: number,
): number {
  const k = saturate(speed / 20);
  const count = Math.max(5, Math.round(mix(6, 22, k) * budget));
  const upSpeed = mix(2.4, 7.2, k);
  const outSpeed = mix(1.0, 3.0, k);
  const baseSize = mix(0.05, 0.1, k);
  const phase = rng() * TAU;

  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * TAU + (rng() - 0.5) * 0.25;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const r0 = 0.42 + rng() * 0.12;
    const out = outSpeed * (0.7 + 0.6 * rng());
    drop(
      pool,
      rng,
      pal,
      x + dx * r0,
      floorY + 0.08,
      z + dz * r0,
      dx * out,
      upSpeed * (0.75 + 0.5 * rng()),
      dz * out,
      0.55 + 0.5 * k + rng() * 0.3,
      baseSize * (0.75 + 0.5 * rng()),
      1,
      0.2,
    );
  }

  const skirt = Math.round(count * 0.35);
  for (let i = 0; i < skirt; i++) {
    const angle = rng() * TAU;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const out = outSpeed * (1.8 + rng() * 1.2);
    drop(
      pool,
      rng,
      pal,
      x + dx * 0.5,
      floorY + 0.06,
      z + dz * 0.5,
      dx * out,
      0.6 + rng() * 0.8,
      dz * out,
      0.3 + rng() * 0.2,
      baseSize * (0.5 + 0.3 * rng()),
      0.8,
      2.2,
    );
  }
  return count + skirt;
}

/**
 * Dash: a short spray thrown out behind the wrestler plus a few droplets skittering
 * along the ground. `(dirX, dirZ)` is the dash direction; `(x, y, z)` the body centre.
 */
export function emitDashSpray(
  pool: ParticlePool,
  rng: Random,
  pal: DropletPalette,
  x: number,
  y: number,
  z: number,
  floorY: number,
  dirX: number,
  dirZ: number,
  budget: number,
): number {
  const len = Math.hypot(dirX, dirZ);
  const fx = len > 1e-5 ? dirX / len : 0;
  const fz = len > 1e-5 ? dirZ / len : 1;
  const bx = -fx; // "behind"
  const bz = -fz;
  const sx = -fz; // sideways
  const sz = fx;

  const spray = Math.max(5, Math.round(11 * budget));
  for (let i = 0; i < spray; i++) {
    const lateral = rng() - 0.5;
    const back = 1.5 + rng() * 3.5;
    const spread = (rng() - 0.5) * 2.4;
    drop(
      pool,
      rng,
      pal,
      x + bx * 0.4 + sx * lateral * 0.5,
      Math.max(floorY + 0.12, y - 0.2 + rng() * 0.4),
      z + bz * 0.4 + sz * lateral * 0.5,
      bx * back + sx * spread,
      0.8 + rng() * 2.6,
      bz * back + sz * spread,
      0.3 + rng() * 0.3,
      0.045 + rng() * 0.035,
      1,
      0.6,
    );
  }

  const skid = Math.max(2, Math.round(4 * budget));
  for (let i = 0; i < skid; i++) {
    const back = 2 + rng() * 2.5;
    const spread = (rng() - 0.5) * 4;
    drop(
      pool,
      rng,
      pal,
      x + bx * 0.3,
      floorY + 0.06,
      z + bz * 0.3,
      bx * back + sx * spread,
      0.2 + rng() * 0.4,
      bz * back + sz * spread,
      0.25 + rng() * 0.15,
      0.04 + rng() * 0.02,
      0.6,
      3,
    );
  }
  return spray + skid;
}

/** Fastest horizontal speed a knockout burst inherits from the victim. */
const MAX_INHERITED_SPEED = 9;

/**
 * Knockout: the wrestler bursts into droplets. A large share of the pool, carried
 * along by the victim's last velocity `(vx, vy, vz)` plus an outward (mostly upward)
 * spread, so the burst fountains over the rim and then rains into the clouds.
 */
export function emitKnockoutBurst(
  pool: ParticlePool,
  rng: Random,
  pal: DropletPalette,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  budget: number,
): number {
  const count = Math.min(
    pool.capacity,
    Math.max(20, Math.min(72, Math.round(50 * budget))),
  );

  let ivx = vx * 0.65;
  let ivz = vz * 0.65;
  const horizontal = Math.hypot(ivx, ivz);
  if (horizontal > MAX_INHERITED_SPEED) {
    const f = MAX_INHERITED_SPEED / horizontal;
    ivx *= f;
    ivz *= f;
  }
  // The victim is usually plummeting; keep only a hint of that and add an upward pop.
  const ivy = Math.max(-3, Math.min(4, vy * 0.3)) + 3.2;

  for (let i = 0; i < count; i++) {
    const theta = rng() * TAU;
    const dy = rng() * 1.3 - 0.3; // -0.3 .. 1: biased upward
    const h = Math.sqrt(Math.max(0, 1 - dy * dy));
    const dx = Math.cos(theta) * h;
    const dz = Math.sin(theta) * h;
    const blob = i % 6 === 0; // a few heavy, slow gobs among the spray
    const speed = (1.8 + rng() * 5.6) * (blob ? 0.55 : 1);
    const inside = rng() * 0.35; // start inside the body's volume
    drop(
      pool,
      rng,
      pal,
      x + dx * inside,
      y + dy * inside,
      z + dz * inside,
      ivx + dx * speed,
      ivy + dy * speed,
      ivz + dz * speed,
      1.0 + rng() * 0.9,
      (0.07 + rng() * 0.07) * (blob ? 1.6 : 1),
      0.85,
      0.35,
    );
  }
  return count;
}

/** Respawn: a subtle shimmer of fine droplets falling with the wrestler from `(x, y, z)`. */
export function emitRespawnShimmer(
  pool: ParticlePool,
  rng: Random,
  pal: DropletPalette,
  x: number,
  y: number,
  z: number,
  budget: number,
): number {
  const count = Math.max(4, Math.round(8 * budget));
  for (let i = 0; i < count; i++) {
    const angle = rng() * TAU;
    const r0 = 0.45 + rng() * 0.25;
    drop(
      pool,
      rng,
      pal,
      x + Math.sin(angle) * r0,
      y + (rng() - 0.5) * 0.8,
      z + Math.cos(angle) * r0,
      (rng() - 0.5) * 0.6,
      -1.5 - rng() * 2.5,
      (rng() - 0.5) * 0.6,
      0.45 + rng() * 0.35,
      0.03 + rng() * 0.02,
      0.9,
      0.5,
    );
  }
  return count;
}

/** Brace: a low ring of dust kicked out at the wrestler's feet as it digs in. */
export function emitBracePuff(
  pool: ParticlePool,
  rng: Random,
  pal: DropletPalette,
  x: number,
  z: number,
  floorY: number,
  budget: number,
): number {
  const count = Math.max(6, Math.round(10 * budget));
  const phase = rng() * TAU;
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * TAU + (rng() - 0.5) * 0.3;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const out = 1.3 + rng();
    drop(
      pool,
      rng,
      pal,
      x + dx * 0.5,
      floorY + 0.05,
      z + dz * 0.5,
      dx * out,
      0.3 + rng() * 0.5,
      dz * out,
      0.32 + rng() * 0.18,
      0.04 + rng() * 0.025,
      0.3,
      4,
    );
  }
  return count;
}
