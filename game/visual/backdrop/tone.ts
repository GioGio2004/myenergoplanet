// ACES filmic tone mapping (the exact curve three.js and the post-processing ToneMapping
// effect use) and its inverse. Pure numbers: no three.js, no DOM.
//
// Why the backdrop needs this: its colours are flat, unlit palette colours. Without
// post-processing the backdrop materials opt out of tone mapping (`toneMapped: false`)
// and hit the palette exactly. With the composer mounted EVERYTHING is tone mapped by a
// full-screen effect, which crushes dark blues to near black. Feeding the shaders the
// inverse-tone-mapped colour makes the final pixel land on the palette again.

/** Anything with linear r, g, b channels (a `THREE.Color` qualifies). */
export type Rgb = { r: number; g: number; b: number };

// Row-major copies of the matrices in three's `tonemapping_pars_fragment` chunk
// (the GLSL source lists them column by column).
const ACES_INPUT = [
  0.59719, 0.35458, 0.04823,
  0.076, 0.90834, 0.01566,
  0.0284, 0.13383, 0.83777,
] as const;

const ACES_OUTPUT = [
  1.60475, -0.53108, -0.07367,
  -0.10208, 1.10813, -0.00605,
  -0.00327, -0.07276, 1.07602,
] as const;

// RRTAndODTFit( v ) = ( v ( v + A ) - B ) / ( v ( C v + D ) + E )
const FIT_A = 0.0245786;
const FIT_B = 0.000090537;
const FIT_C = 0.983729;
const FIT_D = 0.432951;
const FIT_E = 0.238081;

/** three.js divides the exposure by this before the curve. */
const EXPOSURE_BIAS = 0.6;

/** Highest curve output the inverse accepts (the curve's asymptote is 1 / FIT_C ≈ 1.017). */
const FIT_MAX = 0.985;
/** Curve output for an input of zero; anything lower has no non-negative preimage. */
const FIT_MIN = -FIT_B / FIT_E;

function invert3x3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

const ACES_INPUT_INVERSE = invert3x3(ACES_INPUT);
const ACES_OUTPUT_INVERSE = invert3x3(ACES_OUTPUT);

function fit(v: number): number {
  return (v * (v + FIT_A) - FIT_B) / (v * (FIT_C * v + FIT_D) + FIT_E);
}

/** Positive root of `fit(x) = y`, i.e. of (1 - C y) x² + (A - D y) x - (B + E y) = 0. */
function fitInverse(y: number): number {
  const yc = y < FIT_MIN ? FIT_MIN : y > FIT_MAX ? FIT_MAX : y;
  const qa = 1 - FIT_C * yc;
  const qb = FIT_A - FIT_D * yc;
  const qc = -(FIT_B + FIT_E * yc);
  const disc = qb * qb - 4 * qa * qc;
  return (-qb + Math.sqrt(disc > 0 ? disc : 0)) / (2 * qa);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * `ACESFilmicToneMapping` from three.js: scene-linear in, display-linear (0..1) out.
 * Writes into `out` (which may be `color` itself) and returns it.
 */
export function acesFilmic<T extends Rgb>(color: Rgb, out: T, exposure = 1): T {
  const k = exposure / EXPOSURE_BIAS;
  const r = color.r * k;
  const g = color.g * k;
  const b = color.b * k;
  const x = fit(ACES_INPUT[0] * r + ACES_INPUT[1] * g + ACES_INPUT[2] * b);
  const y = fit(ACES_INPUT[3] * r + ACES_INPUT[4] * g + ACES_INPUT[5] * b);
  const z = fit(ACES_INPUT[6] * r + ACES_INPUT[7] * g + ACES_INPUT[8] * b);
  out.r = clamp01(ACES_OUTPUT[0] * x + ACES_OUTPUT[1] * y + ACES_OUTPUT[2] * z);
  out.g = clamp01(ACES_OUTPUT[3] * x + ACES_OUTPUT[4] * y + ACES_OUTPUT[5] * z);
  out.b = clamp01(ACES_OUTPUT[6] * x + ACES_OUTPUT[7] * y + ACES_OUTPUT[8] * z);
  return out;
}

/**
 * The scene-linear colour that `acesFilmic` maps onto `display` (display-linear, 0..1).
 * Colours the curve cannot reach (channels that would have to be negative) are clamped,
 * so very saturated inputs come back slightly desaturated; the backdrop's blues,
 * greys and paper tones round-trip exactly.
 * Writes into `out` (which may be `display` itself) and returns it.
 */
export function inverseAcesFilmic<T extends Rgb>(display: Rgb, out: T, exposure = 1): T {
  const m = ACES_OUTPUT_INVERSE;
  const x = fitInverse(m[0] * display.r + m[1] * display.g + m[2] * display.b);
  const y = fitInverse(m[3] * display.r + m[4] * display.g + m[5] * display.b);
  const z = fitInverse(m[6] * display.r + m[7] * display.g + m[8] * display.b);
  const n = ACES_INPUT_INVERSE;
  const k = EXPOSURE_BIAS / exposure;
  out.r = Math.max(0, (n[0] * x + n[1] * y + n[2] * z) * k);
  out.g = Math.max(0, (n[3] * x + n[4] * y + n[5] * z) * k);
  out.b = Math.max(0, (n[6] * x + n[7] * y + n[8] * z) * k);
  return out;
}
