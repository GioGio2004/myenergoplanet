// SplashRig: the whole "juice" system behind <Splashes/>, React-free.
// Owns the droplet pool, the shockwave pool and their two instanced meshes, turns game
// events into bursts and advances everything once per frame. Nothing here allocates
// after construction.

import { PALETTE, PLAYER_STYLES, gameConfig } from "../../config";
import type { GameRuntime } from "../../runtime";
import type { GameEventOf, WrestlerRuntime } from "../../types";
import { DropletMesh } from "./dropletMesh";
import {
  burstBudget,
  emitBracePuff,
  emitCrownSplash,
  emitDashSpray,
  emitHitBurst,
  emitKnockoutBurst,
  emitRespawnShimmer,
} from "./emitters";
import { createPalette, mixPalette, paletteForStyle, type DropletPalette } from "./palette";
import {
  clearParticles,
  createParticlePool,
  createRandom,
  updateParticles,
  type ParticleEnv,
  type ParticlePool,
  type Random,
} from "./particlePool";
import { ShockwaveMesh } from "./shockwaveMesh";
import {
  clearShockwaves,
  createShockwavePool,
  spawnShockwave,
  updateShockwaves,
  type ShockwavePool,
} from "./shockwavePool";

/** Island top surface. */
const FLOOR_Y = 0;
/** Rings float a hair above the dohyo. */
const RING_Y = FLOOR_Y + 0.03;
/** Droplets hang a little longer than the wrestlers fall. */
const GRAVITY_SCALE = 0.7;
/** "Well below the island": past this the droplets are lost in the clouds. */
const KILL_Y = gameConfig.arena.killY - 7;
const SHOCKWAVE_CAPACITY = 6;
const SHOCKWAVE_SECONDS = 0.35;
/** Hits stronger than this also throw a ground shockwave. */
const SHOCKWAVE_MIN_STRENGTH = 0.5;
/** Landings faster than this fraction of the intro drop speed throw one too. */
const SHOCKWAVE_MIN_LANDING = 0.55;
/** Impact speed of the intro drop-in (v = sqrt(2 g h)), the reference "full" landing. */
const INTRO_LANDING_SPEED = Math.sqrt(
  2 * Math.abs(gameConfig.sim.gravity) * gameConfig.arena.introDropHeight,
);

const DUST = createPalette(PALETTE.ricePaper, PALETTE.ricePaper);

export type SplashRigOptions = {
  /** Droplet pool size (`quality.particles`). */
  particles: number;
  lowDetail: boolean;
  castShadow: boolean;
};

export class SplashRig {
  readonly droplets: DropletMesh;
  readonly shockwaves: ShockwaveMesh;

  private readonly pool: ParticlePool;
  private readonly rings: ShockwavePool;
  private readonly rng: Random;
  private readonly budget: number;
  private readonly scratchPalette: DropletPalette = new Float32Array(6);
  private readonly env: ParticleEnv = {
    gravity: gameConfig.sim.gravity * GRAVITY_SCALE,
    floorY: FLOOR_Y,
    floorRadius: gameConfig.arena.radius,
    killY: KILL_Y,
    restitution: 0.28,
    floorGrip: 0.55,
    splatSeconds: 0.22,
  };

  constructor({ particles, lowDetail, castShadow }: SplashRigOptions) {
    this.pool = createParticlePool(particles);
    this.rings = createShockwavePool(SHOCKWAVE_CAPACITY);
    this.rng = createRandom(0x51d0_5a17);
    this.budget = burstBudget(this.pool.capacity);
    this.droplets = new DropletMesh({ capacity: this.pool.capacity, lowDetail, castShadow });
    this.shockwaves = new ShockwaveMesh(SHOCKWAVE_CAPACITY);
  }

  // ── events ───────────────────────────────────────────────────────────────

  hit(e: GameEventOf<"hit">, runtime: GameRuntime): void {
    const a = runtime.wrestler(e.a);
    const b = runtime.wrestler(e.b);
    // Line between the two bodies; the burst fans out perpendicular to it.
    const nx = a && b ? b.x - a.x : 1;
    const nz = a && b ? b.z - a.z : 0;
    emitHitBurst(
      this.pool,
      this.rng,
      palette(a, e.a),
      palette(b, e.b),
      e.x,
      e.y,
      e.z,
      nx,
      nz,
      e.strength,
      e.dash,
      e.braced,
      this.budget,
    );

    if (e.strength > SHOCKWAVE_MIN_STRENGTH && e.y < FLOOR_Y + 1.6 && onIsland(runtime, e.x, e.z)) {
      const t = Math.min(1, (e.strength - SHOCKWAVE_MIN_STRENGTH) / (1 - SHOCKWAVE_MIN_STRENGTH));
      spawnShockwave(this.rings, e.x, RING_Y, e.z, 1.3 + t * 1.1, SHOCKWAVE_SECONDS);
    }
  }

  land(e: GameEventOf<"land">, runtime: GameRuntime): void {
    // Normalise so the intro drop-in gives the full crown whatever the tuning numbers are.
    const speed = (e.speed / INTRO_LANDING_SPEED) * 20;
    emitCrownSplash(
      this.pool,
      this.rng,
      palette(runtime.wrestler(e.slot), e.slot),
      e.x,
      e.z,
      FLOOR_Y,
      speed,
      this.budget,
    );
    const k = e.speed / INTRO_LANDING_SPEED;
    if (k > SHOCKWAVE_MIN_LANDING) {
      spawnShockwave(this.rings, e.x, RING_Y, e.z, 1.0 + Math.min(k, 1) * 0.9, SHOCKWAVE_SECONDS);
    }
  }

  dash(e: GameEventOf<"dash">, runtime: GameRuntime): void {
    const w = runtime.wrestler(e.slot);
    if (!w) return;
    emitDashSpray(
      this.pool,
      this.rng,
      palette(w, e.slot),
      w.x,
      w.y,
      w.z,
      FLOOR_Y,
      e.dirX,
      e.dirZ,
      this.budget,
    );
  }

  knockout(e: GameEventOf<"knockout">, runtime: GameRuntime): void {
    const w = runtime.wrestler(e.victim);
    emitKnockoutBurst(
      this.pool,
      this.rng,
      palette(w, e.victim),
      e.x,
      e.y,
      e.z,
      w ? w.vx : 0,
      w ? w.vy : 0,
      w ? w.vz : 0,
      this.budget,
    );
  }

  respawn(e: GameEventOf<"respawn">, runtime: GameRuntime): void {
    const w = runtime.wrestler(e.slot);
    // The rules place the body at spawnY; fall back to the configured drop height.
    const fallback = gameConfig.arena.respawnDropHeight + gameConfig.wrestler.radius;
    const y = w && w.spawnY > FLOOR_Y && w.spawnY < 20 ? w.spawnY : fallback;
    emitRespawnShimmer(this.pool, this.rng, palette(w, e.slot), e.x, y, e.z, this.budget);
  }

  brace(e: GameEventOf<"brace">, runtime: GameRuntime): void {
    if (!e.on) return;
    const w = runtime.wrestler(e.slot);
    if (!w || !w.grounded) return;
    // Dohyo dust with a hint of the wrestler's own colour.
    const dust = mixPalette(this.scratchPalette, DUST, palette(w, e.slot), 0.35);
    emitBracePuff(this.pool, this.rng, dust, w.x, w.z, FLOOR_Y, this.budget);
  }

  /** Drop every live effect (back to the lobby). */
  clear(): void {
    clearParticles(this.pool);
    clearShockwaves(this.rings);
  }

  // ── per frame ────────────────────────────────────────────────────────────

  /**
   * Advance and upload. `dt` is the already time-scaled frame delta,
   * `arenaRadius` the current walkable radius (droplets only land inside it).
   */
  update(dt: number, arenaRadius: number, reduceMotion: boolean): void {
    this.env.floorRadius = arenaRadius;
    updateParticles(this.pool, dt, this.env);
    this.droplets.sync(this.pool);
    updateShockwaves(this.rings, dt);
    this.shockwaves.sync(this.rings, !reduceMotion);
  }

  /** Free GPU resources (idempotent; three re-uploads if the rig is rendered again). */
  dispose(): void {
    this.droplets.dispose();
    this.shockwaves.dispose();
  }
}

function palette(w: WrestlerRuntime | undefined, slot: number): DropletPalette {
  return paletteForStyle(w ? w.style : PLAYER_STYLES[slot % PLAYER_STYLES.length]);
}

function onIsland(runtime: GameRuntime, x: number, z: number): boolean {
  const r = runtime.arenaRadius + 0.3;
  return x * x + z * z <= r * r;
}
