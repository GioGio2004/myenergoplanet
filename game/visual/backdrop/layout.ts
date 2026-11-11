// Where everything in the backdrop sits. Pure, deterministic placement (hash-based, no
// Math.random) so the scenery is identical on every load and can be unit-tested.

import { gameConfig } from "../../config";
import { hash01, lerp } from "../../math";

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// ── cloud scrolls ───────────────────────────────────────────────────────────

/** The slab of air below the island that the cloud scrolls drift in. */
export const CLOUD_BAND = {
  minY: -14,
  maxY: -6,
  minRadius: 9,
  maxRadius: 46,
  /** Vertical bob amplitude (kept inside minY..maxY). */
  bob: 0.35,
  /** The inner edge of a cloud never comes closer to the axis of the island than this. */
  axisClearance: 5,
} as const;

export type CloudSpec = {
  /** Distance of the centre of the cloud from the axis of the island. */
  radius: number;
  /** Starting angle around the axis, radians. */
  angle: number;
  /** Rest height of the centre. */
  height: number;
  /** Angular drift, radians per second. */
  speed: number;
  /** Half of the width in world units (a cloud is twice as wide as it is tall). */
  halfWidth: number;
  /** 0..1, drives the shape variation in the shader. */
  seed: number;
  /** Bob phase, radians. */
  phase: number;
  opacity: number;
  /** +1 or -1: mirrors the scroll. */
  flip: number;
};

/**
 * `count` clouds on a sunflower spiral (even coverage from every yaw angle), sorted
 * lowest first: the camera always looks down, so lower means farther, and drawing in
 * that order keeps the translucent layers stacking correctly without per-frame sorting.
 */
export function layoutClouds(count: number): CloudSpec[] {
  const clouds: CloudSpec[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const k = i * 16;
    // Farther clouds are larger, so they hold their size on screen.
    const halfWidth = lerp(2.3, 4.1, hash01(k + 1)) * (0.85 + 0.45 * t);
    const spiralRadius =
      lerp(CLOUD_BAND.minRadius, CLOUD_BAND.maxRadius, Math.sqrt(t)) + (hash01(k + 2) - 0.5) * 4;
    const radius = Math.min(
      CLOUD_BAND.maxRadius,
      Math.max(spiralRadius, CLOUD_BAND.minRadius, halfWidth + CLOUD_BAND.axisClearance),
    );
    // One wind for the whole sky: same direction, 0.14-0.36 units/s, so layers slide past each other.
    const linearSpeed = lerp(0.14, 0.36, hash01(k + 3));
    clouds.push({
      radius,
      angle: (i * GOLDEN_ANGLE + (hash01(k + 4) - 0.5) * 0.6 + TAU) % TAU,
      height: lerp(
        CLOUD_BAND.minY + CLOUD_BAND.bob,
        CLOUD_BAND.maxY - CLOUD_BAND.bob,
        hash01(k + 5),
      ),
      speed: linearSpeed / radius,
      halfWidth,
      seed: hash01(k + 6),
      phase: hash01(k + 7) * TAU,
      opacity: lerp(0.62, 1, hash01(k + 8)),
      flip: hash01(k + 9) < 0.5 ? -1 : 1,
    });
  }
  return clouds.sort((a, b) => a.height - b.height);
}

// ── lanterns ────────────────────────────────────────────────────────────────

export const LANTERN_BAND = {
  minRadius: 10,
  maxRadius: 18,
  minY: -1,
  maxY: 6,
  /** Half the height of a lantern at scale 1 (body, caps and tassel). */
  halfHeight: 0.8,
} as const;

export type LanternSpec = {
  radius: number;
  angle: number;
  height: number;
  /** Angular drift, radians per second (sign = direction). */
  speed: number;
  scale: number;
  /** 0..1. */
  phase: number;
  /** 0 = scarlet paper, 1 = gold paper. */
  tint: number;
  /** Vertical bob amplitude. */
  bob: number;
};

/**
 * Highest a lantern may float at a given distance from the axis.
 *
 * The camera looks down at 36 degrees or steeper, so its sight line to the near rim of
 * the island climbs at least tan(36°) ≈ 0.73 per unit beyond the rim. Staying under a
 * 0.7 slope keeps every lantern below that line: it can frame the ring, never cover it.
 */
export function lanternCeiling(radius: number): number {
  return Math.min(LANTERN_BAND.maxY, (radius - gameConfig.arena.radius) * 0.7 - 0.5);
}

/** How many lanterns to float for a given cloud budget (4 on Low, 6 otherwise). */
export function lanternCountFor(cloudCount: number): number {
  return cloudCount <= 10 ? 4 : 6;
}

export function layoutLanterns(count: number): LanternSpec[] {
  const lanterns: LanternSpec[] = [];
  for (let i = 0; i < count; i++) {
    const k = 1000 + i * 16;
    const scale = lerp(0.85, 1.2, hash01(k + 1));
    const bob = lerp(0.18, 0.4, hash01(k + 2));
    const radius = lerp(
      LANTERN_BAND.minRadius + 0.6,
      LANTERN_BAND.maxRadius - 0.6,
      hash01(k + 3),
    );
    const reach = bob + LANTERN_BAND.halfHeight * scale;
    const floor = LANTERN_BAND.minY + reach;
    const ceiling = Math.max(floor, lanternCeiling(radius) - reach);
    lanterns.push({
      radius,
      // Evenly spread around the ring, loosened so it does not look like a clock face.
      angle: (i / count) * TAU + (hash01(k + 4) - 0.5) * 0.7,
      height: lerp(floor, ceiling, hash01(k + 5)),
      // 0.1-0.24 units/s, alternating direction: a full lap takes five minutes or more.
      speed: ((i % 2 === 0 ? 1 : -1) * lerp(0.1, 0.24, hash01(k + 6))) / radius,
      scale,
      phase: hash01(k + 7),
      // Mostly scarlet with gold accents.
      tint: i % 3 === 1 ? 1 : 0,
      bob,
    });
  }
  return lanterns;
}

// ── ink-wash mountains ──────────────────────────────────────────────────────

export type MountainLayer = {
  /** Distance of the ridge from the axis of the island. */
  radius: number;
  /** Height of the valley floors between peaks. */
  valleyY: number;
  /** Tallest possible peak above `valleyY`. */
  amplitude: number;
  /** Phase offset so no two layers repeat each other. */
  phase: number;
  /** 0 = nearest (darkest ink), 1 = farthest (lightest, bluest). */
  distance: number;
  opacity: number;
};

/** Farthest first: that is also the draw order inside the single mountain mesh. */
export const MOUNTAIN_LAYERS: readonly MountainLayer[] = [
  { radius: 106, valleyY: -6, amplitude: 44, phase: 0.0, distance: 1, opacity: 0.6 },
  { radius: 82, valleyY: -9, amplitude: 34, phase: 2.1, distance: 0.5, opacity: 0.74 },
  { radius: 60, valleyY: -12, amplitude: 25, phase: 4.4, distance: 0, opacity: 0.88 },
];

// Whole-number frequencies keep the ridge seamless around the full circle.
const RIDGE_FREQUENCIES = [9, 14, 23, 37] as const;
const RIDGE_WEIGHTS = [0.38, 0.32, 0.2, 0.1] as const;

/** A rounded karst hump: narrow soft peak, wide flat valley. 0..1. */
function hump(x: number): number {
  const c = 0.5 + 0.5 * Math.cos(x);
  return c * c * c;
}

/**
 * Height of the ridge line of a layer at angle `theta` (radians around the island).
 * Clusters of rounded peaks whose overall height swells and sinks around the circle,
 * so the range has gaps instead of reading as a wall. Periodic in 2π.
 */
export function ridgeHeight(layer: MountainLayer, theta: number): number {
  let peaks = 0;
  for (let i = 0; i < RIDGE_FREQUENCIES.length; i++) {
    peaks += RIDGE_WEIGHTS[i] * hump(RIDGE_FREQUENCIES[i] * theta + layer.phase * (i + 1) * 1.7);
  }
  const swell =
    0.55 + 0.45 * Math.sin(2 * theta + layer.phase * 3.1) * Math.cos(3 * theta - layer.phase);
  return layer.valleyY + layer.amplitude * Math.min(1, peaks * swell * 1.25);
}
