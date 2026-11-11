// A handful of small paper lanterns floating around the island.
//
// Two draw calls: the opaque lantern bodies (instanced, self-lit so they glow without
// any light source and bloom on High) and their soft additive halos. Both read the same
// per-instance attributes and compute the same drifting, bobbing position in the vertex
// shader, so nothing is updated on the CPU.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sceneColor } from "./colors";
import { layoutLanterns } from "./layout";
import { BACKDROP_COLORS } from "./palette";
import {
  DITHER_GLSL,
  ORBIT_GLSL,
  OUTPUT_GLSL,
  additiveFloorFor,
  type BackdropPart,
  type SharedUniforms,
} from "./shaderChunks";

/** Half the height of the paper body at scale 1. */
const BODY_HALF_HEIGHT = 0.42;
const BODY_RADIUS = 0.34;
/** Radius of the halo quad at scale 1 (the visible glow is about half of it). */
const HALO_RADIUS = 2.2;

/** Where each instance is and how its flame flickers; shared by both shaders. */
const LANTERN_COMMON_GLSL = /* glsl */ `
attribute vec4 aOrbit; // radius, start angle, height, angular speed
attribute vec4 aLook;  // scale, phase 0..1, tint (0 scarlet .. 1 gold), bob amplitude
uniform float uTime;
${ORBIT_GLSL}
vec3 bdLanternCentre() {
	return bdOrbit( aOrbit, aLook.y * 6.2831853, aLook.w, 0.45, uTime );
}
// A slow, shallow breathing of the flame: two sines that never line up.
float bdFlicker() {
	float phase = aLook.y * 40.0;
	return 1.0 + 0.05 * sin( uTime * 2.1 + phase ) + 0.03 * sin( uTime * 3.7 + phase * 1.9 );
}
`;

const BODY_VERTEX = /* glsl */ `
attribute float aPart; // 0 = paper, 1 = wooden trim
${LANTERN_COMMON_GLSL}
varying vec3 vNormalView;
varying vec3 vToCamera;
varying vec4 vInfo; // part, latitude on the body (-1..1), tint, flicker
void main() {
	// Hanging from an invisible thread: sway about a pivot above the lantern.
	float sway = sin( uTime * 0.6 + aLook.y * 11.0 ) * 0.1;
	float c = cos( sway );
	float s = sin( sway );
	vec3 p = position - vec3( 0.0, 0.7, 0.0 );
	p = vec3( c * p.x - s * p.y, s * p.x + c * p.y, p.z ) + vec3( 0.0, 0.7, 0.0 );
	vec3 n = vec3( c * normal.x - s * normal.y, s * normal.x + c * normal.y, normal.z );

	vec4 mv = modelViewMatrix * vec4( bdLanternCentre() + p * aLook.x, 1.0 );
	gl_Position = projectionMatrix * mv;
	vNormalView = normalMatrix * n;
	vToCamera = - mv.xyz;
	vInfo = vec4( aPart, position.y / BODY_HALF_HEIGHT, aLook.z, bdFlicker() );
}
`;

const BODY_FRAGMENT = /* glsl */ `
uniform vec3 uScarlet;
uniform vec3 uGold;
uniform vec3 uCore;
uniform vec3 uTrim;
uniform float uGlow;
varying vec3 vNormalView;
varying vec3 vToCamera;
varying vec4 vInfo;
void main() {
	float facing = clamp( dot( normalize( vNormalView ), normalize( vToCamera ) ), 0.0, 1.0 );
	float latitude = clamp( vInfo.y, -1.0, 1.0 );

	// A flame seen through paper: hot and yellow where the paper faces us around the
	// middle, deep in the paper colour toward the silhouette and the caps.
	vec3 tint = mix( uScarlet, uGold, vInfo.z );
	float core = facing * facing * ( 1.0 - 0.5 * latitude * latitude );
	// Faint bamboo ribs running around the body.
	float ribs = 1.0 - 0.16 * smoothstep( 0.7, 1.0, abs( sin( latitude * 7.0 ) ) );
	vec3 paper = mix( tint * 0.6, mix( tint, uCore, 0.6 ), core ) * ( ribs * vInfo.w * uGlow );

	vec3 trim = uTrim * ( 0.55 + 0.45 * facing );

	gl_FragColor = vec4( mix( paper, trim, step( 0.5, vInfo.x ) ), 1.0 );
	${OUTPUT_GLSL}
}
`;

const HALO_VERTEX = /* glsl */ `
${LANTERN_COMMON_GLSL}
varying vec2 vQuad;  // -1..1 across the quad
varying vec2 vLight; // tint, flicker
void main() {
	vec4 mv = modelViewMatrix * vec4( bdLanternCentre(), 1.0 );
	mv.xy += position.xy * ( HALO_RADIUS * aLook.x );
	gl_Position = projectionMatrix * mv;
	vQuad = position.xy;
	vLight = vec2( aLook.z, bdFlicker() );
}
`;

const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uHaloScarlet; // display-space (sRGB-encoded) colours, see below
uniform vec3 uHaloGold;
uniform float uStrength;
uniform float uFloor; // assumed display-space brightness of what is behind the glow
varying vec2 vQuad;
varying vec2 vLight;
${DITHER_GLSL}
void main() {
	// Gaussian falloff that reaches exactly zero at the edge of the quad ( exp( -3.2 ) = 0.0408 ).
	float g = max( exp( - dot( vQuad, vQuad ) * 3.2 ) - 0.0408, 0.0 );
	// Shaped in display space and converted back, so the falloff looks the same whether
	// the additive blend happens in the sRGB canvas (uFloor = 0) or in a linear composer
	// buffer (uFloor = typical backdrop brightness; see additiveFloorFor).
	vec3 display = mix( uHaloScarlet, uHaloGold, vLight.x ) * ( g * uStrength * vLight.y );
	display += ( bdHash12( gl_FragCoord.xy ) - 0.5 ) * uDither * min( g * 30.0, 1.0 );
	vec3 lit = pow( max( display + uFloor, vec3( 0.0 ) ), vec3( 2.2 ) ) - pow( vec3( uFloor ), vec3( 2.2 ) );
	gl_FragColor = vec4( max( lit, vec3( 0.0 ) ), 1.0 );
	${OUTPUT_GLSL}
}
`;

/** Attach a constant per-vertex `aPart` attribute and drop the UVs nobody reads. */
function tagPart(geometry: THREE.BufferGeometry, part: number): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(count).fill(part), 1));
  geometry.deleteAttribute("uv");
  return geometry;
}

/** One lantern, centred on the origin: paper body, two caps, a tassel and a hanging loop. */
function buildLanternGeometry(): THREE.BufferGeometry {
  const parts = [
    tagPart(
      new THREE.SphereGeometry(1, 16, 10).scale(BODY_RADIUS, BODY_HALF_HEIGHT, BODY_RADIUS),
      0,
    ),
    tagPart(new THREE.CylinderGeometry(0.15, 0.18, 0.08, 12).translate(0, 0.42, 0), 1),
    tagPart(new THREE.CylinderGeometry(0.18, 0.15, 0.08, 12).translate(0, -0.42, 0), 1),
    tagPart(new THREE.CylinderGeometry(0.04, 0.012, 0.34, 5).translate(0, -0.63, 0), 1),
    tagPart(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 4).translate(0, 0.55, 0), 1),
  ];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

/** The sRGB-encoded components of a colour, for shaders that work in display space. */
function displayColor(hex: string): THREE.Color {
  return new THREE.Color(hex).convertLinearToSRGB();
}

export type Lanterns = {
  readonly bodies: BackdropPart;
  readonly halos: BackdropPart;
};

export function createLanterns(
  shared: SharedUniforms,
  postProcessing: boolean,
  count: number,
): Lanterns {
  const specs = layoutLanterns(count);
  const orbit = new Float32Array(count * 4);
  const look = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const l = specs[i];
    orbit.set([l.radius, l.angle, l.height, l.speed], i * 4);
    look.set([l.scale, l.phase, l.tint, l.bob], i * 4);
  }
  // Both geometries share the same instanced attributes (one GPU buffer each).
  const orbitAttribute = new THREE.InstancedBufferAttribute(orbit, 4);
  const lookAttribute = new THREE.InstancedBufferAttribute(look, 4);

  // ── bodies ────────────────────────────────────────────────────────────────
  const lantern = buildLanternGeometry();
  const bodyGeometry = new THREE.InstancedBufferGeometry();
  bodyGeometry.setIndex(lantern.getIndex());
  bodyGeometry.setAttribute("position", lantern.getAttribute("position"));
  bodyGeometry.setAttribute("normal", lantern.getAttribute("normal"));
  bodyGeometry.setAttribute("aPart", lantern.getAttribute("aPart"));
  bodyGeometry.setAttribute("aOrbit", orbitAttribute);
  bodyGeometry.setAttribute("aLook", lookAttribute);
  bodyGeometry.instanceCount = count;

  const bodyMaterial = new THREE.ShaderMaterial({
    name: "BackdropLanterns",
    vertexShader: BODY_VERTEX,
    fragmentShader: BODY_FRAGMENT,
    defines: { BODY_HALF_HEIGHT: BODY_HALF_HEIGHT.toFixed(3) },
    uniforms: {
      uTime: shared.uTime,
      // Emissive colours are light, not paint: they stay un-compensated and go above 1
      // under the composer so the bloom pass picks them up.
      uScarlet: { value: new THREE.Color(BACKDROP_COLORS.lanternScarlet) },
      uGold: { value: new THREE.Color(BACKDROP_COLORS.lanternGold) },
      uCore: { value: new THREE.Color(BACKDROP_COLORS.lanternCore) },
      uTrim: { value: sceneColor(BACKDROP_COLORS.lanternTrim, postProcessing) },
      // On the plain canvas anything above 1 just clips (and shifts hue), so stay near 1 there.
      uGlow: { value: postProcessing ? 3.2 : 1.15 },
    },
    toneMapped: false,
  });

  const bodies = new THREE.Mesh(bodyGeometry, bodyMaterial);
  bodies.name = "BackdropLanterns";
  bodies.frustumCulled = false;
  bodies.matrixAutoUpdate = false;

  // ── halos ─────────────────────────────────────────────────────────────────
  const quad = new THREE.PlaneGeometry(2, 2); // x, y in -1..1
  const haloGeometry = new THREE.InstancedBufferGeometry();
  haloGeometry.setIndex(quad.getIndex());
  haloGeometry.setAttribute("position", quad.getAttribute("position"));
  haloGeometry.setAttribute("aOrbit", orbitAttribute);
  haloGeometry.setAttribute("aLook", lookAttribute);
  haloGeometry.instanceCount = count;

  const haloMaterial = new THREE.ShaderMaterial({
    name: "BackdropLanternHalos",
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    defines: { HALO_RADIUS: HALO_RADIUS.toFixed(2) },
    uniforms: {
      uTime: shared.uTime,
      uDither: shared.uDither,
      uHaloScarlet: { value: displayColor(BACKDROP_COLORS.haloScarlet) },
      uHaloGold: { value: displayColor(BACKDROP_COLORS.haloGold) },
      // A little weaker on High, where the bloom pass adds its own glow on top.
      uStrength: { value: postProcessing ? 0.28 : 0.34 },
      uFloor: { value: additiveFloorFor(postProcessing) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  const halos = new THREE.Mesh(haloGeometry, haloMaterial);
  halos.name = "BackdropLanternHalos";
  halos.renderOrder = -50;
  halos.frustumCulled = false;
  halos.matrixAutoUpdate = false;

  return {
    bodies: {
      object: bodies,
      dispose() {
        bodyGeometry.dispose();
        lantern.dispose();
        bodyMaterial.dispose();
      },
    },
    halos: {
      object: halos,
      dispose() {
        haloGeometry.dispose();
        quad.dispose();
        haloMaterial.dispose();
      },
    },
  };
}
