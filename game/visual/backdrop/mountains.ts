// Distant ink-wash mountains: three concentric ridges, merged into ONE mesh (one draw
// call). Each ridge is a ring-shaped strip whose top edge follows a procedural skyline.
// Ink pools along the ridge line, the top edge is feathered like a wet brush stroke and
// the slopes dissolve into the sea of clouds; farther ridges are lighter and bluer.

import * as THREE from "three";
import { sceneColor, sceneColorMix } from "./colors";
import { MOUNTAIN_LAYERS, ridgeHeight } from "./layout";
import { BACKDROP_COLORS, SEA_LEVEL } from "./palette";
import { DITHER_GLSL, OUTPUT_GLSL, type BackdropPart, type SharedUniforms } from "./shaderChunks";

/** Columns around each ring: enough for the finest ridge detail to stay smooth. */
const SEGMENTS = 288;
/** Vertex rows per ring: foot (under the mist), ridge line, feathered top edge. */
const ROWS = 3;
/** The feather above the ridge is this fraction of the distance of the ring (≈ constant on screen). */
const FEATHER_PER_RADIUS = 0.014;
/** The foot of every ridge sits this far under the mist floor, where it is fully dissolved. */
const FOOT_Y = SEA_LEVEL - 4;

const VERTEX = /* glsl */ `
attribute vec4 aTone;  // rgb: ink colour of the layer, a: its opacity
attribute vec2 aRidge; // x: world units below the ridge line, y: 1 on the body, 0 on the feathered edge
varying vec4 vTone;
varying vec3 vRidge;   // xy: aRidge, z: world height
void main() {
	vTone = aTone;
	vRidge = vec3( aRidge, position.y );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform float uAlphaGamma;
uniform vec3 uHaze;
varying vec4 vTone;
varying vec3 vRidge;
${DITHER_GLSL}
void main() {
	float ink = exp( - vRidge.x * 0.11 );                        // ink pools along the ridge
	float feather = smoothstep( 0.0, 1.0, vRidge.y );            // soft brush edge on top
	float rise = smoothstep( MIST_Y, MIST_Y + 14.0, vRidge.z );  // slopes dissolve into the mist
	vec3 color = mix( uHaze, vTone.rgb, 0.4 + 0.6 * ink );
	float alpha = vTone.a * feather * rise * ( 0.45 + 0.55 * ink );
	gl_FragColor = vec4( bdDither( color ), pow( alpha, uAlphaGamma ) );
	${OUTPUT_GLSL}
}
`;

function buildGeometry(postProcessing: boolean): THREE.BufferGeometry {
  const layerCount = MOUNTAIN_LAYERS.length;
  const columns = SEGMENTS + 1; // the seam column is duplicated
  const vertexCount = layerCount * columns * ROWS;
  const positions = new Float32Array(vertexCount * 3);
  const tones = new Float32Array(vertexCount * 4);
  const ridges = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  const tone = new THREE.Color();

  let v = 0;
  // MOUNTAIN_LAYERS is ordered farthest first, and triangles are drawn in index order,
  // so the nearer ridges are blended over the farther ones without any sorting.
  for (let l = 0; l < layerCount; l++) {
    const layer = MOUNTAIN_LAYERS[l];
    sceneColorMix(
      BACKDROP_COLORS.mountainNear,
      BACKDROP_COLORS.mountainFar,
      layer.distance,
      postProcessing,
      tone,
    );
    const feather = layer.radius * FEATHER_PER_RADIUS;
    const first = v;

    for (let s = 0; s < columns; s++) {
      const theta = (s / SEGMENTS) * Math.PI * 2;
      const x = Math.sin(theta) * layer.radius;
      const z = Math.cos(theta) * layer.radius;
      const ridge = ridgeHeight(layer, theta);
      for (let row = 0; row < ROWS; row++) {
        const y = row === 0 ? FOOT_Y : row === 1 ? ridge : ridge + feather;
        positions.set([x, y, z], v * 3);
        tones.set([tone.r, tone.g, tone.b, layer.opacity], v * 4);
        ridges.set([row === 0 ? ridge - FOOT_Y : 0, row === 2 ? 0 : 1], v * 2);
        v++;
      }
    }

    for (let s = 0; s < SEGMENTS; s++) {
      for (let row = 0; row < ROWS - 1; row++) {
        const a = first + s * ROWS + row;
        const b = a + ROWS; // same row, next column
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aTone", new THREE.BufferAttribute(tones, 4));
  geometry.setAttribute("aRidge", new THREE.BufferAttribute(ridges, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function createMountains(shared: SharedUniforms, postProcessing: boolean): BackdropPart {
  const geometry = buildGeometry(postProcessing);
  const material = new THREE.ShaderMaterial({
    name: "BackdropMountains",
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { MIST_Y: SEA_LEVEL.toFixed(1) },
    uniforms: {
      uDither: shared.uDither,
      uAlphaGamma: shared.uAlphaGamma,
      uHaze: { value: sceneColor(BACKDROP_COLORS.haze, postProcessing) },
    },
    transparent: true,
    depthWrite: false,
    // The camera sits inside the rings and looks at their inner faces.
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "BackdropMountains";
  mesh.renderOrder = -90;
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
