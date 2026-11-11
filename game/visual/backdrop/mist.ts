// The floor of the sea of clouds, far below the island, and the soft cushion of light
// directly under it.
//
// The floor is one big disc shaded as stacked, soft-edged tiers of mist (a paper-cut,
// layered look) that slowly drift and curl. The shapes come from a small tileable noise
// texture generated at startup, so the whole thing costs three texture reads per pixel.

import * as THREE from "three";
import { sceneColor } from "./colors";
import { buildMistNoise } from "./noise";
import { BACKDROP_COLORS, SEA_LEVEL } from "./palette";
import { DITHER_GLSL, OUTPUT_GLSL, type BackdropPart, type SharedUniforms } from "./shaderChunks";

/** Radius of the mist disc. It has faded to nothing well before its edge. */
const MIST_RADIUS = 150;
const NOISE_SIZE = 128;
/** World units covered by one noise tile: the largest banks come out ~20 units across. */
const NOISE_TILE_WORLD = 90;

/** Where the glow cushion floats: below the rock of the island, above most of the clouds. */
const GLOW_Y = -8;
const GLOW_RADIUS = 17;

const FLOOR_VERTEX = /* glsl */ `
varying vec2 vGround;
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vGround = world.xz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FLOOR_FRAGMENT = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uAlphaGamma;
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uPaper;
varying vec2 vGround;
${DITHER_GLSL}

// Bilinear filtering with a smoothstep on the fractional part: removes the creases
// plain bilinear leaves when a magnified texture is thresholded.
vec2 bdSmoothUv( vec2 uv ) {
	vec2 p = uv * NOISE_SIZE + 0.5;
	vec2 i = floor( p );
	vec2 f = p - i;
	f = f * f * ( 3.0 - 2.0 * f );
	return ( i + f - 0.5 ) / NOISE_SIZE;
}

void main() {
	float r = length( vGround );
	vec2 uv = vGround / NOISE_TILE_WORLD;

	// Two slow fields bend the lookup of the third, so the banks curl as they drift.
	float warpA = texture2D( uNoise, bdSmoothUv( uv * 1.9 + uTime * vec2( 0.0021, 0.0013 ) ) ).g;
	#ifdef BD_LOW_DETAIL
		vec2 warp = vec2( warpA - 0.5, 0.5 - warpA ) * 0.07;
	#else
		float warpB = texture2D( uNoise, bdSmoothUv( uv * 1.3 + vec2( 0.37, 0.61 ) - uTime * vec2( 0.0016, -0.0024 ) ) ).g;
		vec2 warp = vec2( warpA - 0.5, warpB - 0.5 ) * 0.09;
	#endif
	float n = texture2D( uNoise, bdSmoothUv( uv + warp + uTime * vec2( -0.0011, 0.0019 ) ) ).r;

	// The noise is uniformly distributed, so these thresholds are coverage: the first
	// tier fills 55% of the floor, the second 34%, the brightest 15%.
	float e = 0.03;
	float tier1 = smoothstep( 0.45 - e, 0.45 + e, n );
	float tier2 = smoothstep( 0.66 - e, 0.66 + e, n );
	float tier3 = smoothstep( 0.85 - e, 0.85 + e, n );
	float tiers = tier1 + tier2 + tier3;
	// A lighter line riding the lip of each tier, like the outline of a cloud scroll.
	float lip = 4.0 * max( tier1 * ( 1.0 - tier1 ), max( tier2 * ( 1.0 - tier2 ), tier3 * ( 1.0 - tier3 ) ) );

	float level = tiers / 3.0;
	// Kept thin: the brightest tier is still a dark slate, so the ring stays the brightest thing on screen.
	float density = 0.05 + 0.07 * tiers + 0.04 * lip;

	// Far away the banks merge into one even wash...
	float distant = smoothstep( 45.0, 95.0, r );
	density = mix( density, 0.17, distant );
	level = mix( level, 0.45, distant );
	lip *= 1.0 - distant;
	// ...which then dissolves into the sky before the disc ends.
	float fade = 1.0 - smoothstep( 80.0, MIST_RADIUS - 8.0, r );

	// The mist is thickest under the island: the middle of the picture glows, the edges fall to ink.
	density *= 1.0 + 0.45 * exp( - r * r / 700.0 );

	vec3 color = mix( uLow, uHigh, level );
	color = mix( color, uPaper, lip * 0.25 );

	float alpha = bdDitherAlpha( density * fade );
	gl_FragColor = vec4( color, pow( alpha, uAlphaGamma ) );
	${OUTPUT_GLSL}
}
`;

const GLOW_VERTEX = /* glsl */ `
varying vec2 vDisc;
void main() {
	vDisc = position.xz / GLOW_RADIUS;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const GLOW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uAlphaGamma;
uniform vec3 uGlow;
uniform vec3 uPaper;
varying vec2 vDisc;
${DITHER_GLSL}
void main() {
	float g = 1.0 - smoothstep( 0.0, 1.0, length( vDisc ) );
	g *= g; // long, soft tail
	float breathe = 1.0 + 0.05 * sin( uTime * 0.35 );
	vec3 color = mix( uGlow, uPaper, g * 0.3 );
	float alpha = bdDitherAlpha( g * 0.5 * breathe );
	gl_FragColor = vec4( color, pow( alpha, uAlphaGamma ) );
	${OUTPUT_GLSL}
}
`;

function createNoiseTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    buildMistNoise(NOISE_SIZE),
    NOISE_SIZE,
    NOISE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "BackdropMistNoise";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Always magnified on screen (one texel is ~0.7 world units), so no mipmaps.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // data, not colour
  texture.needsUpdate = true;
  return texture;
}

/** The flat, drifting floor of the sea of clouds. One draw call. */
export function createMistFloor(
  shared: SharedUniforms,
  postProcessing: boolean,
  lowDetail: boolean,
): BackdropPart {
  const noise = createNoiseTexture();
  // CircleGeometry faces +Z; laid flat it faces up, toward the camera.
  const geometry = new THREE.CircleGeometry(MIST_RADIUS, 64).rotateX(-Math.PI / 2);
  const defines: Record<string, string> = {
    NOISE_SIZE: NOISE_SIZE.toFixed(1),
    NOISE_TILE_WORLD: NOISE_TILE_WORLD.toFixed(1),
    MIST_RADIUS: MIST_RADIUS.toFixed(1),
  };
  if (lowDetail) defines.BD_LOW_DETAIL = "";

  const material = new THREE.ShaderMaterial({
    name: "BackdropMistFloor",
    vertexShader: FLOOR_VERTEX,
    fragmentShader: FLOOR_FRAGMENT,
    defines,
    uniforms: {
      uTime: shared.uTime,
      uDither: shared.uDither,
      uAlphaGamma: shared.uAlphaGamma,
      uNoise: { value: noise },
      uLow: { value: sceneColor(BACKDROP_COLORS.mistDeep, postProcessing) },
      uHigh: { value: sceneColor(BACKDROP_COLORS.mist, postProcessing) },
      uPaper: { value: sceneColor(BACKDROP_COLORS.paper, postProcessing) },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "BackdropMistFloor";
  mesh.position.y = SEA_LEVEL;
  mesh.renderOrder = -80;
  mesh.frustumCulled = false;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  return {
    object: mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
      noise.dispose();
    },
  };
}

/** A soft disc of light under the island so its dark rim reads against the void. One draw call. */
export function createIslandGlow(shared: SharedUniforms, postProcessing: boolean): BackdropPart {
  const geometry = new THREE.CircleGeometry(GLOW_RADIUS, 40).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    name: "BackdropIslandGlow",
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    defines: { GLOW_RADIUS: GLOW_RADIUS.toFixed(1) },
    uniforms: {
      uTime: shared.uTime,
      uDither: shared.uDither,
      uAlphaGamma: shared.uAlphaGamma,
      uGlow: { value: sceneColor(BACKDROP_COLORS.islandGlow, postProcessing) },
      uPaper: { value: sceneColor(BACKDROP_COLORS.paper, postProcessing) },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "BackdropIslandGlow";
  mesh.position.y = GLOW_Y;
  mesh.renderOrder = -70;
  mesh.frustumCulled = false;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  return {
    object: mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
