// Pure tile layout for the dohyo: a round centre pad, then concentric rings of
// wedge-shaped tiles out to the island radius. No three.js, no React.
//
// Angle convention (same as `spawnPoint` in game/config.ts): a point at angle `a` and
// distance `r` from the centre is (x, z) = (sin a · r, cos a · r).

import { hash01 } from "../../math";

const TAU = Math.PI * 2;

/** Gap between neighbouring tiles (radially and along the arc), world units. */
export const DEFAULT_TILE_GAP = 0.05;
/** Target arc length of one tile, measured on its ring's centre line. */
export const DEFAULT_TILE_ARC = 1.15;
/** A ring is never split into fewer wedges than this. */
const MIN_TILES_PER_RING = 3;
/** Tolerance when comparing a radius against a ring boundary. */
const RADIUS_EPS = 1e-6;

export type TileLayout = {
  /** Index into `IslandLayout.tiles`. */
  index: number;
  /** Ring this tile belongs to: 0 is the centre pad, then outward. */
  ring: number;
  /** Position within its ring, counted in the direction of increasing angle. */
  indexInRing: number;
  /** Radial extent of the tile itself (the gap is already taken out). */
  innerRadius: number;
  outerRadius: number;
  /** Angular extent, `endAngle > startAngle`; may run past 2π, never wraps. */
  startAngle: number;
  endAngle: number;
  /** Mid angle and mid radius: the tile's polar centre. */
  angle: number;
  radius: number;
  /** World XZ of the polar centre (0, 0 for the centre pad). */
  x: number;
  z: number;
  /** Stable 0..1 value for per-tile variation (colour, height, fall timing). */
  hash: number;
};

export type RingLayout = {
  index: number;
  /** Boundaries of the ring band itself, gaps included. */
  nominalInner: number;
  nominalOuter: number;
  /** Radial extent of the ring's tiles. */
  innerRadius: number;
  outerRadius: number;
  /** The ring's tiles are `tiles[firstTile .. firstTile + tileCount - 1]`. */
  firstTile: number;
  tileCount: number;
};

export type IslandLayout = {
  radius: number;
  ringWidth: number;
  gap: number;
  rings: RingLayout[];
  /** Every tile, ordered ring by ring from the centre outward. */
  tiles: TileLayout[];
};

export type IslandLayoutOptions = {
  /** Island radius: the outermost ring ends exactly here. */
  radius: number;
  /** Rings are this wide; the centre pad is a disc of this radius. */
  ringWidth: number;
  gap?: number;
  targetArc?: number;
  /** Changes the per-ring stagger and the per-tile hashes. */
  seed?: number;
};

/** Number of rings (centre pad included) needed to cover `radius`. */
export function ringCountFor(radius: number, ringWidth: number): number {
  return Math.max(1, Math.ceil(radius / ringWidth - RADIUS_EPS));
}

/** How many wedges a ring is cut into so each is about `targetArc` long. */
export function tilesInRing(
  ring: number,
  nominalInner: number,
  nominalOuter: number,
  targetArc: number,
): number {
  if (ring === 0) return 1;
  const mid = (nominalInner + nominalOuter) / 2;
  return Math.max(MIN_TILES_PER_RING, Math.round((TAU * mid) / targetArc));
}

export function computeIslandLayout(options: IslandLayoutOptions): IslandLayout {
  const { radius, ringWidth } = options;
  const gap = options.gap ?? DEFAULT_TILE_GAP;
  const targetArc = options.targetArc ?? DEFAULT_TILE_ARC;
  const seed = options.seed ?? 1;
  if (!(radius > 0) || !(ringWidth > 0)) {
    throw new Error("island layout: radius and ringWidth must be positive");
  }
  if (gap < 0 || gap >= ringWidth || !(targetArc > gap)) {
    throw new Error("island layout: gap must be smaller than ringWidth and targetArc");
  }

  const ringCount = ringCountFor(radius, ringWidth);
  const rings: RingLayout[] = [];
  const tiles: TileLayout[] = [];

  for (let ring = 0; ring < ringCount; ring++) {
    const nominalInner = ring * ringWidth;
    const nominalOuter = Math.min(radius, (ring + 1) * ringWidth);
    // Half a gap is taken from each side of a shared boundary; the island's outer
    // edge has no neighbour, so the last ring reaches the full radius.
    const innerRadius = ring === 0 ? 0 : nominalInner + gap / 2;
    const outerRadius = ring === ringCount - 1 ? nominalOuter : nominalOuter - gap / 2;
    const midRadius = (nominalInner + nominalOuter) / 2;

    const tileCount = tilesInRing(ring, nominalInner, nominalOuter, targetArc);
    const step = TAU / tileCount;
    // Stagger every ring so the radial seams never line up into spokes.
    const offset = ring === 0 ? 0 : hash01(seed * 131 + ring) * step;
    const halfGapAngle = ring === 0 ? 0 : gap / 2 / midRadius;

    rings.push({
      index: ring,
      nominalInner,
      nominalOuter,
      innerRadius,
      outerRadius,
      firstTile: tiles.length,
      tileCount,
    });

    for (let i = 0; i < tileCount; i++) {
      const index = tiles.length;
      const startAngle = offset + i * step + halfGapAngle;
      const endAngle = offset + (i + 1) * step - halfGapAngle;
      const angle = (startAngle + endAngle) / 2;
      const tileRadius = ring === 0 ? 0 : (innerRadius + outerRadius) / 2;
      tiles.push({
        index,
        ring,
        indexInRing: i,
        innerRadius,
        outerRadius,
        startAngle,
        endAngle,
        angle,
        radius: tileRadius,
        x: Math.sin(angle) * tileRadius,
        z: Math.cos(angle) * tileRadius,
        hash: hash01(seed * 4099 + index),
      });
    }
  }

  return { radius, ringWidth, gap, rings, tiles };
}

/** Top-surface area of one tile. */
export function tileArea(tile: TileLayout): number {
  const span = tile.endAngle - tile.startAngle;
  return 0.5 * span * (tile.outerRadius * tile.outerRadius - tile.innerRadius * tile.innerRadius);
}

/** True when the world point (x, z) lies on the tile (boundaries included). */
export function tileContains(tile: TileLayout, x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < tile.innerRadius || r > tile.outerRadius) return false;
  const span = tile.endAngle - tile.startAngle;
  if (span >= TAU - 1e-9) return true;
  let a = (Math.atan2(x, z) - tile.startAngle) % TAU;
  if (a < 0) a += TAU;
  return a <= span;
}

/** Ring band (gaps included) that contains a distance from the centre, or -1 beyond the island. */
export function ringIndexAt(layout: IslandLayout, distance: number): number {
  if (distance < 0 || distance > layout.radius + RADIUS_EPS) return -1;
  return Math.min(layout.rings.length - 1, Math.floor(distance / layout.ringWidth));
}

/** Index of the tile under the world point (x, z), or -1 for a gap / off the island. */
export function tileIndexAt(layout: IslandLayout, x: number, z: number): number {
  const ring = ringIndexAt(layout, Math.hypot(x, z));
  if (ring < 0) return -1;
  const { firstTile, tileCount } = layout.rings[ring];
  for (let i = firstTile; i < firstTile + tileCount; i++) {
    if (tileContains(layout.tiles[i], x, z)) return i;
  }
  return -1;
}

/**
 * First ring that lies outside a walkable `radius` (its centre line is beyond it).
 * Rings `[result, rings.length)` crack and fall when the island shrinks to `radius`;
 * returns `rings.length` when nothing lies outside.
 */
export function firstRingOutside(layout: IslandLayout, radius: number): number {
  for (const ring of layout.rings) {
    if ((ring.nominalInner + ring.nominalOuter) / 2 > radius + RADIUS_EPS) return ring.index;
  }
  return layout.rings.length;
}
