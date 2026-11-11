// Pure lighting maths: where the key light sits and how tightly its shadow camera can
// hug the island. No three.js, so it can be unit-tested.

import { gameConfig } from "../../config";

export type Vec3Tuple = [x: number, y: number, z: number];

export type ShadowFrustum = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
};

/** Unit vector pointing FROM the island TOWARD a light at the given elevation/azimuth. */
export function lightDirection(elevationDegrees: number, azimuthDegrees: number): Vec3Tuple {
  const e = (elevationDegrees * Math.PI) / 180;
  const a = (azimuthDegrees * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

export type ShadowFitOptions = {
  /** Elevation of the light above the horizon, degrees (0 < e < 90). */
  elevationDegrees: number;
  /** Distance of the light from the island centre. */
  distance: number;
  /** Radius of the disc that must receive shadows (island + whatever stands on its rim). */
  radius: number;
  /** Highest point that must still RECEIVE a shadow (wrestlers standing on the island). */
  receiverTop: number;
  /** Lowest point that must still receive a shadow (side of the slab); negative = below the floor. */
  receiverBottom: number;
  /** Highest point a shadow CASTER can be at (wrestlers dropping in). */
  casterTop: number;
  /** Slack added on every side. */
  margin: number;
};

/**
 * Orthographic shadow-camera bounds for a directional light aimed at the origin with
 * +Y as its up vector.
 *
 * A caster and its shadow share the same position across the view of the light, so the
 * left/right/top/bottom box only has to cover the RECEIVERS; tall casters just need
 * the near plane pulled toward the light. A tight box means every texel of the shadow
 * map lands on the island.
 */
export function fitShadowFrustum(o: ShadowFitOptions): ShadowFrustum {
  const e = (o.elevationDegrees * Math.PI) / 180;
  const sin = Math.sin(e);
  const cos = Math.cos(e);
  const halfWidth = o.radius + o.margin;
  // Across the vertical axis of the light the disc is foreshortened by sin(e), while
  // height above/below the floor shows up scaled by cos(e).
  const top = o.radius * sin + o.receiverTop * cos + o.margin;
  const bottom = -(o.radius * sin - o.receiverBottom * cos + o.margin);
  // Along the axis of the light: toward the light is nearer.
  const nearest = o.radius * cos + o.casterTop * sin;
  const farthest = o.radius * cos - o.receiverBottom * sin;
  return {
    left: -halfWidth,
    right: halfWidth,
    top,
    bottom,
    near: Math.max(0.1, o.distance - nearest - o.margin),
    far: o.distance + farthest + o.margin,
  };
}

/** World-space size of one shadow-map texel for a fitted frustum. */
export function shadowTexelSize(frustum: ShadowFrustum, mapSize: number): number {
  return Math.max(frustum.right - frustum.left, frustum.top - frustum.bottom) / mapSize;
}

// ── the key light of the game ───────────────────────────────────────────────

/** Low, warm lantern-sun: 46 degrees up, coming from the front-right of the starting view. */
export const KEY_ELEVATION_DEGREES = 46;
export const KEY_AZIMUTH_DEGREES = 52;
export const KEY_DISTANCE = 24;

const wrestlerRadius = gameConfig.wrestler.radius;

/**
 * How far below the floor the shadow box reaches, so the rock hanging under the slab
 * is shaded by the slab above it. Anything deeper is simply left unshadowed.
 */
const ISLAND_BODY_DEPTH = 4;

export const KEY_DIRECTION: Vec3Tuple = lightDirection(KEY_ELEVATION_DEGREES, KEY_AZIMUTH_DEGREES);

export const KEY_POSITION: Vec3Tuple = [
  KEY_DIRECTION[0] * KEY_DISTANCE,
  KEY_DIRECTION[1] * KEY_DISTANCE,
  KEY_DIRECTION[2] * KEY_DISTANCE,
];

export const KEY_SHADOW_FRUSTUM: ShadowFrustum = fitShadowFrustum({
  elevationDegrees: KEY_ELEVATION_DEGREES,
  distance: KEY_DISTANCE,
  // A wrestler teetering on the rim still catches (and casts) a full shadow.
  radius: gameConfig.arena.radius + wrestlerRadius,
  receiverTop: gameConfig.arena.respawnDropHeight + wrestlerRadius,
  receiverBottom: -ISLAND_BODY_DEPTH,
  casterTop: gameConfig.arena.introDropHeight + wrestlerRadius,
  margin: 0.4,
});

/** Cool rim light: opposite the key and lower, so the shaded side keeps an edge. */
export const RIM_POSITION: Vec3Tuple = (() => {
  const d = lightDirection(24, KEY_AZIMUTH_DEGREES + 180);
  return [d[0] * KEY_DISTANCE, d[1] * KEY_DISTANCE, d[2] * KEY_DISTANCE] as Vec3Tuple;
})();

export type ShadowTuning = { bias: number; normalBias: number; radius: number };

/**
 * Bias and blur for a shadow-map size.
 * - `normalBias` is in world units: about two texels pushes the lookup clear of the
 *   floor's own depth under the PCF kernel without visibly detaching contact shadows.
 * - `radius` is in texels: scaled so the penumbra is about the same width in the world
 *   whatever the map size (capped, because the 5-tap kernel gets noisy when stretched).
 */
export function shadowTuning(frustum: ShadowFrustum, mapSize: number): ShadowTuning {
  const texel = shadowTexelSize(frustum, mapSize);
  return {
    bias: -0.0002,
    normalBias: Math.min(0.08, texel * 2),
    radius: Math.min(4, Math.max(1.25, 0.03 / texel)),
  };
}
