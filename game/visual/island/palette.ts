// Island colours. Warm, slightly greyed earth tones chosen to sit on the egyptian-blue
// backdrop and to stay clearly apart from all four wrestler colours (less saturated
// than the gold, darker than the rice white).

import * as THREE from "three";
import { hash01 } from "../../math";
import { PALETTE } from "../../config";
import type { IslandLayout } from "./layout";

export const ISLAND_COLORS = {
  /** Cracked, about-to-fall earth: dark burnt umber. */
  tileCracked: "#3E261D",
  /** Falling pieces dissolve into the backdrop. */
  dissolve: PALETTE.egyptianBlue,
  /** Chalk starting lines: rice paper rubbed into clay. */
  marks: "#DCD3BE",
  strawLight: "#E2CA92",
  strawDark: "#B8975B",
  strawBinding: "#4E3524",
  /** Rope instance tint when cracked (it multiplies the straw colours). */
  ropeCracked: "#7A6658",
  ropeDissolve: "#0A2238",
  /** Underside, from just below the slab down to the tip. */
  rockEarth: "#5E4735",
  rockStone: "#3B333A",
  rockDeep: "#16304C",
  rockTip: "#0A2A4D",
} as const;

/** Packed-earth base tone in sRGB HSL; every tile varies a little around it. */
const EARTH_HUE = 31 / 360;
const EARTH_SATURATION = 0.3;
const EARTH_LIGHTNESS = 0.585;

const _color = new THREE.Color();

/**
 * Per-tile packed-earth colour (linear rgb, 3 floats per tile) written into `out`.
 * Subtle value/hue shifts per tile, a slightly paler centre pad and a gentle
 * darkening toward the rim.
 */
export function fillTileColors(layout: IslandLayout, out: Float32Array): Float32Array {
  const lastRing = Math.max(1, layout.rings.length - 1);
  for (const tile of layout.tiles) {
    const i = tile.index;
    const hueShift = (hash01(i * 7 + 31) - 0.5) * (9 / 360);
    const saturationShift = (hash01(i * 7 + 32) - 0.5) * 0.09;
    // Mostly small shifts, with the odd noticeably lighter or darker tile.
    const v = hash01(i * 7 + 33) - 0.5;
    const lightnessShift = v * 0.06 + v * Math.abs(v) * 0.1;
    const rim = tile.ring / lastRing;
    const lightness =
      EARTH_LIGHTNESS + lightnessShift - 0.035 * rim * rim + (tile.ring === 0 ? 0.02 : 0);

    _color.setHSL(
      EARTH_HUE + hueShift,
      EARTH_SATURATION + saturationShift,
      lightness,
      THREE.SRGBColorSpace,
    );
    out[i * 3] = _color.r;
    out[i * 3 + 1] = _color.g;
    out[i * 3 + 2] = _color.b;
  }
  return out;
}
