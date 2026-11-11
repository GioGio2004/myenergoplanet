// GLSL snippets shared by the backdrop's unlit shader materials.
// All of them are plain `THREE.ShaderMaterial`s (GLSL ES 3.00 through three's aliases).

import type * as THREE from "three";

/**
 * Uniforms every backdrop material shares (the SAME objects, so one write per frame
 * updates them all).
 */
export type SharedUniforms = {
  /** Backdrop clock in seconds (already scaled by slow motion / reduced motion). */
  uTime: THREE.IUniform<number>;
  /** Dither amplitude in display units (about one 8-bit step). */
  uDither: THREE.IUniform<number>;
  /** See `alphaGammaFor`. */
  uAlphaGamma: THREE.IUniform<number>;
};

/**
 * Screen-space dither. Dark blue gradients band badly on TVs at 8 bits, so the big
 * gradients add a little noise. It is applied in (approximate) display space and
 * converted back, which stays correct whether the fragment is written to the canvas
 * (sRGB) or to a linear half-float buffer of a post-processing composer.
 */
export const DITHER_GLSL = /* glsl */ `
uniform float uDither;
float bdHash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
vec3 bdDither( vec3 linearColor ) {
	vec3 display = pow( max( linearColor, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
	display += ( bdHash12( gl_FragCoord.xy ) - 0.5 ) * uDither;
	return pow( max( display, vec3( 0.0 ) ), vec3( 2.2 ) );
}
// Same idea for a translucent layer: jitter the alpha so the BLENDED result is dithered.
float bdDitherAlpha( float alpha ) {
	float jitter = ( bdHash12( gl_FragCoord.xy + 17.0 ) - 0.5 ) * uDither * 3.0;
	return max( alpha + jitter * min( alpha * 12.0, 1.0 ), 0.0 );
}
`;

/**
 * Where a drifting thing (cloud, lantern) is right now. It circles the island's axis
 * and bobs; everything is a function of time, so the CPU never touches the instances.
 * orbit = ( radius, start angle, height, angular speed ).
 */
export const ORBIT_GLSL = /* glsl */ `
vec3 bdOrbit( vec4 orbit, float phase, float bob, float bobSpeed, float time ) {
	float a = orbit.y + time * orbit.w;
	return vec3(
		sin( a ) * orbit.x,
		orbit.z + sin( time * bobSpeed + phase ) * bob,
		cos( a ) * orbit.x
	);
}
`;

/** Tail of every backdrop fragment shader: renderer tone mapping (if enabled) + output encoding. */
export const OUTPUT_GLSL = /* glsl */ `
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
`;

/**
 * Exponent applied to the alpha of light-on-dark translucent layers.
 *
 * Without post-processing three.js blends in display (sRGB) space; inside a composer
 * it blends in linear space, where the same alpha looks far brighter over a dark
 * background. For pale mist over the dark blues of this backdrop, `alpha^1.6` in the
 * linear case lands within a few percent of the sRGB blend across the alphas in use.
 */
export function alphaGammaFor(postProcessing: boolean): number {
  return postProcessing ? 1.6 : 1;
}

/**
 * Display-space brightness of the backdrop behind an ADDITIVE glow, as the shader should
 * assume it. Adding `s` in an sRGB buffer brightens a dark pixel far more than adding
 * `s^2.2` in a linear one, so under the composer the glow is computed as
 * `(floor + s)^2.2 - floor^2.2`, which reproduces the sRGB result over a typical
 * backdrop pixel. Zero on the plain canvas, where the blend already is in sRGB.
 */
export function additiveFloorFor(postProcessing: boolean): number {
  return postProcessing ? 0.19 : 0;
}

/** About one 8-bit step; a little more under the composer, whose tone curve flattens darks. */
export function ditherAmplitudeFor(postProcessing: boolean): number {
  return (postProcessing ? 1.6 : 1) / 255;
}

export function createSharedUniforms(postProcessing: boolean): SharedUniforms {
  return {
    uTime: { value: 0 },
    uDither: { value: ditherAmplitudeFor(postProcessing) },
    uAlphaGamma: { value: alphaGammaFor(postProcessing) },
  };
}

/** One piece of the backdrop: something to add to the scene and a way to free its GPU memory. */
export type BackdropPart = {
  readonly object: THREE.Object3D;
  dispose(): void;
};
