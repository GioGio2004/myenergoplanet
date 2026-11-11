// The shockwave draw call: one instanced flat ring with a tiny unlit shader.
// Per-instance (alpha, thickness) lets each ring thin out and fade like an ink stroke.

import * as THREE from "three";
import { PALETTE } from "../../config";
import { writeShockwaveInstances, type ShockwavePool } from "./shockwavePool";

/** Inner radius of the template ring; the vertex shader remaps it per instance. */
const TEMPLATE_INNER = 0.5;

const VERTEX = /* glsl */ `
attribute vec2 aRing; // x = alpha, y = band thickness as a fraction of the radius
varying float vBand;
varying float vAlpha;

void main() {
	float r = length( position.xz );
	float band = clamp( ( r - ${TEMPLATE_INNER.toFixed(1)} ) / ${(1 - TEMPLATE_INNER).toFixed(1)}, 0.0, 1.0 ); // 0 = inner rim, 1 = outer rim
	vec2 dir = position.xz / max( r, 0.0001 );
	float radius = 1.0 - aRing.y * ( 1.0 - band );
	vec4 local = vec4( dir.x * radius, 0.0, dir.y * radius, 1.0 );
	#ifdef USE_INSTANCING
		local = instanceMatrix * local;
	#endif
	vBand = band;
	vAlpha = aRing.x;
	gl_Position = projectionMatrix * modelViewMatrix * local;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vBand;
varying float vAlpha;

void main() {
	// Crisp leading (outer) edge, soft trailing wash on the inside: a brush ring.
	float profile = smoothstep( 0.0, 0.75, vBand ) * ( 1.0 - smoothstep( 0.86, 1.0, vBand ) );
	float alpha = vAlpha * profile;
	if ( alpha < 0.004 ) discard;
	gl_FragColor = vec4( uColor, alpha );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export class ShockwaveMesh {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly ringAttribute: THREE.InstancedBufferAttribute;
  private readonly matrices: Float32Array;
  private readonly ringData: Float32Array;

  constructor(capacity: number) {
    // RingGeometry faces +Z; lay it flat so it faces up.
    this.geometry = new THREE.RingGeometry(TEMPLATE_INNER, 1, 56, 1).rotateX(-Math.PI / 2);
    this.geometry.deleteAttribute("uv");
    this.geometry.deleteAttribute("normal");
    this.ringData = new Float32Array(capacity * 2);
    this.ringAttribute = new THREE.InstancedBufferAttribute(this.ringData, 2);
    this.ringAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("aRing", this.ringAttribute);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(PALETTE.ricePaper) } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Sits a hair above the dohyo; the offset keeps it from z-fighting at grazing angles.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = "splash-shockwaves";
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2; // after the opaque world and other ground decals
    this.mesh = mesh;
    this.matrices = mesh.instanceMatrix.array as Float32Array;
  }

  /** Copy the live rings into the instance buffers. `overshoot = false` for reduced motion. */
  sync(pool: ShockwavePool, overshoot: boolean): void {
    const count = writeShockwaveInstances(pool, this.matrices, this.ringData, overshoot);
    this.mesh.count = count;
    if (count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.ringAttribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
