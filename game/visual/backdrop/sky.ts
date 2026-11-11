// The sky: one inverted sphere glued to the camera, shaded by view direction only.
// Straight down is ink, the air below the horizon is egyptian blue, a slightly lighter
// haze band hugs the horizon and the zenith sinks back toward ink.

import * as THREE from "three";
import { sceneColor } from "./colors";
import { BACKDROP_COLORS } from "./palette";
import { DITHER_GLSL, OUTPUT_GLSL, type BackdropPart, type SharedUniforms } from "./shaderChunks";

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
	vDirection = position;
	// Rotate with the camera but never translate: the dome is infinitely far away.
	vec4 clip = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
	gl_Position = clip.xyww; // pinned to the far plane
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uHaze;
uniform vec3 uZenith;
varying vec3 vDirection;
${DITHER_GLSL}
void main() {
	float h = normalize( vDirection ).y; // -1 straight down .. +1 straight up

	// Below the horizon (most of what the game camera sees): ink rising to egyptian blue.
	vec3 color = mix( uDeep, uSky, smoothstep( -1.0, -0.35, h ) );

	// A band of lighter air on the horizon for the mountains to dissolve into.
	float band = ( h - 0.03 ) * 5.5;
	color = mix( color, uHaze, 0.9 * exp( - band * band ) );

	// Overhead the sky deepens again.
	color = mix( color, uZenith, smoothstep( 0.12, 0.8, h ) );

	gl_FragColor = vec4( bdDither( color ), 1.0 );
	${OUTPUT_GLSL}
}
`;

export function createSky(shared: SharedUniforms, postProcessing: boolean): BackdropPart {
  const geometry = new THREE.SphereGeometry(1, 24, 12);
  const material = new THREE.ShaderMaterial({
    name: "BackdropSky",
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uDither: shared.uDither,
      uDeep: { value: sceneColor(BACKDROP_COLORS.deep, postProcessing) },
      uSky: { value: sceneColor(BACKDROP_COLORS.sky, postProcessing) },
      uHaze: { value: sceneColor(BACKDROP_COLORS.haze, postProcessing) },
      uZenith: { value: sceneColor(BACKDROP_COLORS.zenith, postProcessing) },
    },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "BackdropSky";
  // Drawn before everything else, never culled (its vertices ignore the model matrix).
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;

  return {
    object: mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
