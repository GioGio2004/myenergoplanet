// ─────────────────────────────────────────────────────────────────────────────
// The liquid look: MeshPhysicalMaterial patched through onBeforeCompile, plus
// depth / distance materials patched with the SAME vertex deformation so the
// shadow follows the wobbling, squashing surface.
//
// Hook points follow three r187's chunk names (see the verified liquid example).
// Every wrestler has its own material instances (uniforms are per material) but
// they all share one GL program through `customProgramCacheKey`.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { PALETTE, type PlayerStyle } from "../../config";

export type LiquidUniforms = {
  /** Wobble clock, seconds. */
  uTime: THREE.IUniform<number>;
  /** Wobble amplitude, world units. */
  uAmp: THREE.IUniform<number>;
  /** Per-wrestler noise offset. */
  uSeed: THREE.IUniform<number>;
  /** Jelly sway of the top of the body (character-space XZ). */
  uSway: THREE.IUniform<THREE.Vector2>;
  /** Squash & stretch (character space). */
  uDeform: THREE.IUniform<THREE.Matrix3>;
  /** Vertical offset that keeps the foot planted. */
  uShift: THREE.IUniform<number>;
  uBeltColor: THREE.IUniform<THREE.Color>;
  uAccentColor: THREE.IUniform<THREE.Color>;
  uInkColor: THREE.IUniform<THREE.Color>;
  uGlowColor: THREE.IUniform<THREE.Color>;
  /** Fresnel rim strength. */
  uRim: THREE.IUniform<number>;
  /** Inner glow (fake subsurface) strength. */
  uInner: THREE.IUniform<number>;
  /** Belt emission while bracing. */
  uBeltGlow: THREE.IUniform<number>;
  /** White impact flash, 0..1. */
  uFlash: THREE.IUniform<number>;
};

/** Bump these whenever the injected GLSL changes (they key the shared programs). */
const LIT_PROGRAM_KEY = "liquid-sumo-lit-v1";
const DEPTH_PROGRAM_KEY = "liquid-sumo-depth-v1";
const DISTANCE_PROGRAM_KEY = "liquid-sumo-distance-v1";

// ── vertex ───────────────────────────────────────────────────────────────────

/**
 * Shared by the lit, depth and distance materials. `liquidDeform` is a smooth field
 * over character space (not per-vertex-normal displacement), so the belt, topknot
 * and eyes merged into the mesh move exactly with the body surface under them.
 */
const DEFORM_PARS_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSeed;
uniform vec2 uSway;
uniform mat3 uDeform;
uniform float uShift;

// Integer-hashed lattice gradient, components in [-1, 1].
vec3 lqGradient( ivec3 cell ) {
	uvec3 q = uvec3( cell ) * uvec3( 1597334673u, 3812015801u, 2798796415u );
	uint h = ( q.x ^ q.y ^ q.z ) * 1597334673u;
	uvec3 r = uvec3( h, h * 16807u, h * 48271u );
	return vec3( r >> 8u ) * ( 2.0 / 16777216.0 ) - 1.0;
}

// 3D gradient noise with quintic fade, roughly in [-1, 1].
float lqNoise( vec3 p ) {
	vec3 cellF = floor( p );
	vec3 f = p - cellF;
	ivec3 c = ivec3( cellF );
	vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	float n000 = dot( lqGradient( c ), f );
	float n100 = dot( lqGradient( c + ivec3( 1, 0, 0 ) ), f - vec3( 1.0, 0.0, 0.0 ) );
	float n010 = dot( lqGradient( c + ivec3( 0, 1, 0 ) ), f - vec3( 0.0, 1.0, 0.0 ) );
	float n110 = dot( lqGradient( c + ivec3( 1, 1, 0 ) ), f - vec3( 1.0, 1.0, 0.0 ) );
	float n001 = dot( lqGradient( c + ivec3( 0, 0, 1 ) ), f - vec3( 0.0, 0.0, 1.0 ) );
	float n101 = dot( lqGradient( c + ivec3( 1, 0, 1 ) ), f - vec3( 1.0, 0.0, 1.0 ) );
	float n011 = dot( lqGradient( c + ivec3( 0, 1, 1 ) ), f - vec3( 0.0, 1.0, 1.0 ) );
	float n111 = dot( lqGradient( c + ivec3( 1, 1, 1 ) ), f - vec3( 1.0, 1.0, 1.0 ) );
	float nx00 = mix( n000, n100, u.x );
	float nx10 = mix( n010, n110, u.x );
	float nx01 = mix( n001, n101, u.x );
	float nx11 = mix( n011, n111, u.x );
	return mix( mix( nx00, nx10, u.y ), mix( nx01, nx11, u.y ), u.z );
}

vec3 liquidDeform( vec3 p ) {
	// 1. Wobble: slow lobes drifting over the drop, pushed along the radial direction.
	//    The foot stays planted so the body does not paddle on the floor.
	float lqGrip = smoothstep( - 0.62, - 0.2, p.y );
	vec3 lqFlow = vec3( uSeed + uTime * 0.21, - uTime * 0.5, uSeed * 1.7 + uTime * 0.13 );
	float lqWobble = lqNoise( p * 1.4 + lqFlow );
	p += normalize( p ) * ( uAmp * lqWobble * lqGrip );
	// 2. Jelly sway: the top lags behind the base, more the higher it is.
	float lqHeight = max( p.y + 0.6, 0.0 ) / 1.2;
	p.xz += uSway * ( lqHeight * lqHeight );
	// 3. Squash & stretch, then re-seat the foot on the floor.
	p = uDeform * p;
	p.y += uShift;
	return p;
}
`;

const PARTS_PARS_VERTEX = /* glsl */ `
attribute float aPart;
varying float vLqPart;
varying vec3 vLqPos;
`;

/** Normals of the deformed surface by finite differences in the tangent plane. */
const NORMAL_VERTEX = /* glsl */ `
#include <beginnormal_vertex>
{
	vec3 lqT = normalize( cross( objectNormal, abs( objectNormal.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
	vec3 lqB = cross( objectNormal, lqT );
	float lqE = 0.01;
	vec3 lqP0 = liquidDeform( position );
	vec3 lqP1 = liquidDeform( position + lqT * lqE );
	vec3 lqP2 = liquidDeform( position + lqB * lqE );
	objectNormal = normalize( cross( lqP1 - lqP0, lqP2 - lqP0 ) );
}
`;

const BEGIN_VERTEX = /* glsl */ `
#include <begin_vertex>
transformed = liquidDeform( transformed );
`;

const BEGIN_VERTEX_LIT = /* glsl */ `
#include <begin_vertex>
vLqPart = aPart;
vLqPos = position;
transformed = liquidDeform( transformed );
`;

// ── fragment ─────────────────────────────────────────────────────────────────

const PARS_FRAGMENT = /* glsl */ `
uniform vec3 uBeltColor;
uniform vec3 uAccentColor;
uniform vec3 uInkColor;
uniform vec3 uGlowColor;
uniform float uRim;
uniform float uInner;
uniform float uBeltGlow;
uniform float uFlash;
varying float vLqPart;
varying vec3 vLqPos;
`;

/** Part masks (aPart: 0 body, 1 belt, 2 accent, 3 hair, 4 eye) and the base colours. */
const COLOR_FRAGMENT = /* glsl */ `
#include <color_fragment>
float lqBody = 1.0 - step( 0.5, vLqPart );
float lqBelt = step( 0.5, vLqPart ) - step( 1.5, vLqPart );
float lqAccent = step( 1.5, vLqPart ) - step( 2.5, vLqPart );
float lqHair = step( 2.5, vLqPart ) - step( 3.5, vLqPart );
float lqEye = step( 3.5, vLqPart );
float lqCloth = lqBelt + lqAccent;
// The drop is thicker, so deeper in tone, towards its foot.
float lqDepthTone = mix( 0.8, 1.08, smoothstep( - 0.6, 0.75, vLqPos.y ) );
diffuseColor.rgb = diffuseColor.rgb * ( lqBody * lqDepthTone )
	+ uBeltColor * ( lqBelt + lqHair )
	+ uAccentColor * lqAccent
	+ uInkColor * lqEye;
`;

/** The belt is cloth: matte. The eyes are wet beads. */
const ROUGHNESS_FRAGMENT = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.62, lqCloth );
roughnessFactor = mix( roughnessFactor, 0.08, lqEye );
`;

/**
 * Glow that does not depend on the scene's lights, so the drop always reads as glossy
 * liquid in its own colour: inner glow (fake subsurface), fresnel rim in the style's
 * glow colour, a camera-anchored key highlight, the brace belt glow and the hit flash.
 * `normal` is view space (from <normal_fragment_begin>); vViewPosition = -mvPosition.
 */
const EMISSIVE_FRAGMENT = /* glsl */ `
#include <emissivemap_fragment>
vec3 lqView = normalize( vViewPosition );
float lqNdV = saturate( dot( normal, lqView ) );
float lqFresnel = pow( 1.0 - lqNdV, 2.6 );
{
	float lqSky = 0.62 + 0.38 * normal.y;
	vec3 lqHalf = normalize( vec3( - 0.38, 0.78, 0.5 ) + lqView );
	float lqNdH = saturate( dot( normal, lqHalf ) );
	float lqSpec = pow( lqNdH, 96.0 ) * 0.5 + pow( lqNdH, 10.0 ) * 0.07;
	totalEmissiveRadiance += diffuseColor.rgb * ( uInner * ( 0.3 + 0.7 * lqNdV * lqNdV ) * ( 1.0 - lqEye ) );
	totalEmissiveRadiance += uGlowColor * ( lqFresnel * uRim * lqSky );
	totalEmissiveRadiance += vec3( lqSpec * ( 1.0 - 0.75 * lqCloth ) );
	totalEmissiveRadiance += uGlowColor * ( uBeltGlow * lqCloth );
	totalEmissiveRadiance += vec3( uFlash * ( 0.2 + 0.8 * lqFresnel ) );
}
`;

const CLEARCOAT_FRAGMENT = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
	material.clearcoat *= 1.0 - 0.85 * lqCloth;
#endif
`;

/**
 * Translucent (invulnerable) drops keep a solid rim and solid markings, so the
 * silhouette, belt and topknot stay readable while the belly turns see-through.
 */
const OPAQUE_FRAGMENT = /* glsl */ `
if ( diffuseColor.a < 0.999 ) {
	diffuseColor.a = mix( diffuseColor.a, 1.0, saturate( lqFresnel * 0.9 + ( 1.0 - lqBody ) * 0.35 ) );
}
#include <opaque_fragment>
`;

// ── patching ─────────────────────────────────────────────────────────────────

/** The two shader sources `onBeforeCompile` edits. */
export type ShaderSource = { vertexShader: string; fragmentShader: string };

function replaceOrThrow(source: string, token: string, replacement: string): string {
  if (!source.includes(token)) {
    throw new Error(`liquid material: shader token not found: ${token}`);
  }
  return source.replace(token, replacement);
}

/** Inject the deformation (and nothing else) into a depth / distance vertex shader. */
export function patchDepthShader(shader: ShaderSource): void {
  let vs = shader.vertexShader;
  vs = replaceOrThrow(vs, "#include <common>", "#include <common>\n" + DEFORM_PARS_VERTEX);
  vs = replaceOrThrow(vs, "#include <begin_vertex>", BEGIN_VERTEX);
  shader.vertexShader = vs;
}

/** Inject deformation, corrected normals, part colours and the liquid glow. */
export function patchLitShader(shader: ShaderSource): void {
  let vs = shader.vertexShader;
  vs = replaceOrThrow(
    vs,
    "#include <common>",
    "#include <common>\n" + DEFORM_PARS_VERTEX + PARTS_PARS_VERTEX,
  );
  vs = replaceOrThrow(vs, "#include <beginnormal_vertex>", NORMAL_VERTEX);
  vs = replaceOrThrow(vs, "#include <begin_vertex>", BEGIN_VERTEX_LIT);
  shader.vertexShader = vs;

  let fs = shader.fragmentShader;
  fs = replaceOrThrow(fs, "#include <common>", "#include <common>\n" + PARS_FRAGMENT);
  fs = replaceOrThrow(fs, "#include <color_fragment>", COLOR_FRAGMENT);
  fs = replaceOrThrow(fs, "#include <roughnessmap_fragment>", ROUGHNESS_FRAGMENT);
  fs = replaceOrThrow(fs, "#include <emissivemap_fragment>", EMISSIVE_FRAGMENT);
  fs = replaceOrThrow(fs, "#include <lights_physical_fragment>", CLEARCOAT_FRAGMENT);
  fs = replaceOrThrow(fs, "#include <opaque_fragment>", OPAQUE_FRAGMENT);
  shader.fragmentShader = fs;
}

// ── factory ──────────────────────────────────────────────────────────────────

export type Liquid = {
  material: THREE.MeshPhysicalMaterial;
  /** Directional / spot light shadows. */
  depthMaterial: THREE.MeshDepthMaterial;
  /** Point light shadows. */
  distanceMaterial: THREE.MeshDistanceMaterial;
  uniforms: LiquidUniforms;
  dispose: () => void;
};

/**
 * Materials for one wrestler. `seed` de-synchronises the wobble between wrestlers.
 * Hex colours in the style are sRGB; THREE.Color converts them to the linear
 * working space the shader computes in.
 */
export function createLiquid(style: PlayerStyle, seed: number): Liquid {
  const uniforms: LiquidUniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.05 },
    uSeed: { value: seed },
    uSway: { value: new THREE.Vector2() },
    uDeform: { value: new THREE.Matrix3() },
    uShift: { value: 0 },
    uBeltColor: { value: new THREE.Color(style.belt) },
    uAccentColor: { value: new THREE.Color(style.glow) },
    uInkColor: { value: new THREE.Color(PALETTE.ink) },
    uGlowColor: { value: new THREE.Color(style.glow) },
    uRim: { value: 0.55 },
    uInner: { value: 0.3 },
    uBeltGlow: { value: 0 },
    uFlash: { value: 0 },
  };

  // Always in the transparent pass (with depth writes) so fading in and out of the
  // invulnerable state never switches program variants mid-match. At opacity 1 it
  // renders exactly like an opaque surface. No transmission: far too costly ×4.
  const material = new THREE.MeshPhysicalMaterial({
    color: style.color,
    roughness: 0.24,
    metalness: 0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  material.onBeforeCompile = (shader) => {
    // The same uniform objects for every program variant three compiles.
    Object.assign(shader.uniforms, uniforms);
    patchLitShader(shader);
  };
  material.customProgramCacheKey = () => LIT_PROGRAM_KEY;

  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchDepthShader(shader);
  };
  depthMaterial.customProgramCacheKey = () => DEPTH_PROGRAM_KEY;

  const distanceMaterial = new THREE.MeshDistanceMaterial();
  distanceMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchDepthShader(shader);
  };
  distanceMaterial.customProgramCacheKey = () => DISTANCE_PROGRAM_KEY;

  return {
    material,
    depthMaterial,
    distanceMaterial,
    uniforms,
    dispose: () => {
      material.dispose();
      depthMaterial.dispose();
      distanceMaterial.dispose();
    },
  };
}
