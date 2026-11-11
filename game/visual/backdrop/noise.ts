// Tileable noise for the mist floor, generated once at startup (no network, no canvas).
// Pure numbers so it can be unit-tested; mist.ts wraps the bytes in a DataTexture.

import { hash01 } from "../../math";

/** Lattice cells per tile for each octave, and how much each one contributes. */
const OCTAVE_CELLS = [4, 8, 16] as const;
const OCTAVE_WEIGHTS = [0.55, 0.3, 0.15] as const;

function lattice(ix: number, iy: number, cells: number, seed: number): number {
  // Wrapping the lattice coordinates is what makes the tile seamless.
  const x = ((ix % cells) + cells) % cells;
  const y = ((iy % cells) + cells) % cells;
  return hash01(seed * 7919 + cells * 104729 + y * 131 + x);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Periodic value noise in 0..1; `u`, `v` in tile units (period 1). */
function valueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = lattice(ix, iy, cells, seed);
  const b = lattice(ix + 1, iy, cells, seed);
  const c = lattice(ix, iy + 1, cells, seed);
  const d = lattice(ix + 1, iy + 1, cells, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Three octaves of tileable value noise (period 1 in `u` and `v`), bell-distributed around 0.5. */
export function tileableFbm(u: number, v: number, seed: number): number {
  let sum = 0;
  for (let o = 0; o < OCTAVE_CELLS.length; o++) {
    sum += valueNoise(u, v, OCTAVE_CELLS[o], seed + o) * OCTAVE_WEIGHTS[o];
  }
  return sum;
}

/**
 * Histogram-equalise a field into bytes: the output is uniformly distributed, so in the
 * shader "value > t" covers exactly (1 - t) of the area. That makes the coverage of the
 * mist tiers a design decision instead of an accident of the noise.
 */
export function equalizeToBytes(field: Float32Array): Uint8Array {
  const n = field.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((p, q) => field[p] - field[q]);
  const out = new Uint8Array(n);
  for (let rank = 0; rank < n; rank++) {
    out[order[rank]] = Math.min(255, Math.floor((rank / n) * 256));
  }
  return out;
}

/**
 * RGBA8 pixels of a `size` x `size` seamless tile.
 * R = equalised fbm (the mist shape), G = an independent equalised fbm (domain warp),
 * B = 0, A = 255.
 */
export function buildMistNoise(size: number): Uint8Array<ArrayBuffer> {
  const count = size * size;
  const shape = new Float32Array(count);
  const warp = new Float32Array(count);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      shape[y * size + x] = tileableFbm(u, v, 1);
      warp[y * size + x] = tileableFbm(u, v, 57);
    }
  }
  const r = equalizeToBytes(shape);
  const g = equalizeToBytes(warp);
  const pixels = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    pixels[i * 4] = r[i];
    pixels[i * 4 + 1] = g[i];
    pixels[i * 4 + 2] = 0;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}
