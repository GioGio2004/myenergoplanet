// Droplet colours: pure sRGB-hex → linear conversion (same maths as THREE.Color.setHex),
// cached per player style so event handlers never allocate.

import type { PlayerStyle } from "../../config";

/** `[r, g, b, glowR, glowG, glowB]` in linear sRGB: the body colour and its highlight tint. */
export type DropletPalette = Float32Array;

export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** Parse `#RRGGBB` / `#RGB` and write linear r, g, b into `out[offset..offset + 2]`. */
export function hexToLinear(hex: string, out: Float32Array, offset = 0): Float32Array {
  let h = hex.charCodeAt(0) === 35 /* # */ ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  const value = Number.isFinite(n) && h.length === 6 ? n : 0xffffff;
  out[offset] = srgbToLinear(((value >> 16) & 255) / 255);
  out[offset + 1] = srgbToLinear(((value >> 8) & 255) / 255);
  out[offset + 2] = srgbToLinear((value & 255) / 255);
  return out;
}

export function createPalette(colorHex: string, glowHex: string): DropletPalette {
  const p = new Float32Array(6);
  hexToLinear(colorHex, p, 0);
  hexToLinear(glowHex, p, 3);
  return p;
}

const styleCache = new WeakMap<PlayerStyle, DropletPalette>();

/** The droplet palette of a wrestler style (computed once per style object). */
export function paletteForStyle(style: PlayerStyle): DropletPalette {
  let p = styleCache.get(style);
  if (!p) {
    p = createPalette(style.color, style.glow);
    styleCache.set(style, p);
  }
  return p;
}

/**
 * `out = mix(a, b, t)` for both the body colour and the glow.
 * Used for the brace dust puff (dohyo dust tinted with the wrestler's colour).
 */
export function mixPalette(
  out: DropletPalette,
  a: DropletPalette,
  b: DropletPalette,
  t: number,
): DropletPalette {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
