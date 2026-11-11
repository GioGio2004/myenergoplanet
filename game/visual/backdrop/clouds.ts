// Drifting auspicious cloud scrolls (xiangyun) below the island.
//
// Every cloud is a camera-facing quad; the scroll itself is drawn in the fragment
// shader as a signed-distance shape: rounded lobes on a long flat base, an outline
// riding just inside the silhouette and a spiral curl inside the larger lobes. Being
// procedural it is crisp at any size, needs no texture, and each instance gets its own
// proportions. All instances are ONE draw call and move entirely on the GPU.

import * as THREE from "three";
import { sceneColor } from "./colors";
import { CLOUD_BAND, layoutClouds } from "./layout";
import { BACKDROP_COLORS } from "./palette";
import {
  DITHER_GLSL,
  ORBIT_GLSL,
  OUTPUT_GLSL,
  type BackdropPart,
  type SharedUniforms,
} from "./shaderChunks";

const VERTEX = /* glsl */ `
attribute vec4 aOrbit; // radius, start angle, height, angular speed
attribute vec4 aShape; // half width, seed, bob phase, opacity
attribute float aFlip; // +1 / -1
uniform float uTime;
varying vec2 vScroll;  // x -2..2, y -1..1 across the quad
varying vec3 vVariant; // seed, opacity, flip
${ORBIT_GLSL}
void main() {
	vec3 centre = bdOrbit( aOrbit, aShape.z, CLOUD_BOB, 0.21, uTime );
	vec4 mv = modelViewMatrix * vec4( centre, 1.0 );
	// Billboard: offset in view space, so the scroll always faces the camera upright.
	mv.xy += position.xy * aShape.x;
	gl_Position = projectionMatrix * mv;
	vScroll = position.xy * 2.0;
	vVariant = vec3( aShape.y, aShape.w, aFlip );
}
`;

const FRAGMENT = /* glsl */ `
uniform float uAlphaGamma;
uniform vec3 uLight;
uniform vec3 uShade;
uniform vec3 uPaper;
varying vec2 vScroll;
varying vec3 vVariant;
${DITHER_GLSL}

const float BD_PI = 3.14159265;

float bdCircle( vec2 p, vec2 c, float r ) {
	return length( p - c ) - r;
}

// Smooth union: lobes melt into each other instead of meeting in a sharp crease.
float bdSmin( float a, float b, float k ) {
	float h = clamp( 0.5 + 0.5 * ( b - a ) / k, 0.0, 1.0 );
	return mix( b, a, h ) - k * h * ( 1.0 - h );
}

vec2 bdRotate( vec2 p, float angle ) {
	float c = cos( angle );
	float s = sin( angle );
	return vec2( c * p.x - s * p.y, s * p.x + c * p.y );
}

// Distance to a one-and-a-half-turn spiral centred on the origin (q in lobe radii).
// The spiral runs from radius 0.12 out to 0.64.
float bdCurl( vec2 q ) {
	q += 1e-4; // keeps atan defined at the exact centre
	float rho = length( q );
	float turn = atan( q.y, q.x ) + BD_PI; // 0 .. 2 pi
	float first = abs( rho - ( 0.12 + 0.055 * turn ) );
	float second = abs( rho - ( 0.12 + 0.055 * ( turn + 2.0 * BD_PI ) ) );
	return turn < BD_PI ? min( first, second ) : first;
}

void main() {
	float seed = vVariant.x;
	vec2 p = vec2( vScroll.x * vVariant.z, vScroll.y );

	// Four lobes of varying size sitting on a baseline.
	float r0 = 0.34 + 0.10 * fract( seed * 7.13 );
	float r1 = 0.48 + 0.12 * fract( seed * 13.7 );
	float r2 = 0.58 + 0.12 * fract( seed * 3.31 );
	float r3 = 0.40 + 0.12 * fract( seed * 23.9 );
	vec2 c0 = vec2( -1.12, -0.28 );
	vec2 c1 = vec2( -0.52, 0.00 );
	vec2 c2 = vec2( 0.22, 0.14 );
	vec2 c3 = vec2( 0.98, -0.14 );

	float d = bdCircle( p, c0, r0 );
	d = bdSmin( d, bdCircle( p, c1, r1 ), 0.10 );
	d = bdSmin( d, bdCircle( p, c2, r2 ), 0.10 );
	d = bdSmin( d, bdCircle( p, c3, r3 ), 0.10 );
	// The long flat tail of a cloud scroll, with rounded ends.
	vec2 tail = vec2( max( abs( p.x ) - 1.6, 0.0 ), p.y + 0.44 );
	d = bdSmin( d, length( tail ) - 0.16, 0.12 );

	float body = 1.0 - smoothstep( -0.05, 0.05, d );  // soft-edged silhouette
	float wash = smoothstep( -0.62, 0.10, p.y );      // dissolves downward, ink-wash style
	float inner = exp( d * 5.0 );                     // 1 on the outline, fading inward

	// Outline riding just inside the silhouette.
	float outline = 1.0 - smoothstep( 0.02, 0.06, abs( d + 0.07 ) );
	// Spiral curls inside the three larger lobes, each turned differently.
	float curl = bdCurl( bdRotate( ( p - c1 ) / r1, 2.4 ) ) * r1;
	curl = min( curl, bdCurl( bdRotate( ( p - c2 ) / r2, 0.6 ) ) * r2 );
	curl = min( curl, bdCurl( bdRotate( ( p - c3 ) / r3, 4.0 ) ) * r3 );
	float lines = max( outline, 1.0 - smoothstep( 0.02, 0.055, curl ) );

	vec3 color = mix( uShade, uLight, clamp( 0.3 + 0.7 * inner * wash + 0.25 * p.y, 0.0, 1.0 ) );
	color = mix( color, uPaper, lines * 0.7 );

	float alpha = body * wash * ( 0.2 + 0.16 * inner + 0.3 * lines ) * vVariant.y;
	alpha = bdDitherAlpha( alpha );
	gl_FragColor = vec4( color, pow( alpha, uAlphaGamma ) );
	${OUTPUT_GLSL}
}
`;

/** `count` drifting cloud scrolls in one draw call. */
export function createClouds(
  shared: SharedUniforms,
  postProcessing: boolean,
  count: number,
): BackdropPart {
  const specs = layoutClouds(count);
  const orbit = new Float32Array(count * 4);
  const shape = new Float32Array(count * 4);
  const flip = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const c = specs[i];
    orbit.set([c.radius, c.angle, c.height, c.speed], i * 4);
    shape.set([c.halfWidth, c.seed, c.phase, c.opacity], i * 4);
    flip[i] = c.flip;
  }

  // A 2:1 quad: x in -1..1, y in -0.5..0.5.
  const quad = new THREE.PlaneGeometry(2, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(quad.getIndex());
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("aOrbit", new THREE.InstancedBufferAttribute(orbit, 4));
  geometry.setAttribute("aShape", new THREE.InstancedBufferAttribute(shape, 4));
  geometry.setAttribute("aFlip", new THREE.InstancedBufferAttribute(flip, 1));
  geometry.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    name: "BackdropClouds",
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { CLOUD_BOB: CLOUD_BAND.bob.toFixed(3) },
    uniforms: {
      uTime: shared.uTime,
      uDither: shared.uDither,
      uAlphaGamma: shared.uAlphaGamma,
      uLight: { value: sceneColor(BACKDROP_COLORS.cloudLight, postProcessing) },
      uShade: { value: sceneColor(BACKDROP_COLORS.cloudShade, postProcessing) },
      uPaper: { value: sceneColor(BACKDROP_COLORS.paper, postProcessing) },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "BackdropClouds";
  mesh.renderOrder = -60;
  // The instances move in the vertex shader, so the bounding volume of the quad means nothing.
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;

  return {
    object: mesh,
    dispose() {
      // Frees the GPU buffers shared with `quad` as well (the attributes are the same objects).
      geometry.dispose();
      quad.dispose();
      material.dispose();
    },
  };
}
