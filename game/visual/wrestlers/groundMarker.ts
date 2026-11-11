// ─────────────────────────────────────────────────────────────────────────────
// The flat ring on the dohyo under each wrestler: the strongest "which one am I"
// cue. One quad, one draw call, everything drawn in the fragment shader:
//   - the ring in the player colour with an ink outline (readable on any floor),
//   - a bead on the ring pointing where the wrestler faces,
//   - a ring pulse while bracing,
//   - an optional soft blob shadow (when real shadows are off).
// Nothing is drawn beyond the island's current edge.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { PALETTE, type PlayerStyle } from "../../config";

/** Half the side of the quad, world units. Must contain the largest brace pulse. */
const HALF_SIZE = 1.8;
/** Height above the island top (y = 0): clear of z-fighting, visually on the floor. */
const HEIGHT = 0.02;

type MarkerUniforms = {
  uColor: THREE.IUniform<THREE.Color>;
  uInk: THREE.IUniform<THREE.Color>;
  /** World XZ of the wrestler. */
  uCenter: THREE.IUniform<THREE.Vector2>;
  /** Unit heading in world XZ. */
  uFacing: THREE.IUniform<THREE.Vector2>;
  uAlpha: THREE.IUniform<number>;
  /** 0..1: the ring thickens while bracing. */
  uBrace: THREE.IUniform<number>;
  /** Brace pulse phase 0..1, negative for none. */
  uPulse: THREE.IUniform<number>;
  /** Blob shadow opacity (0 disables it). */
  uShadow: THREE.IUniform<number>;
  uShadowRadius: THREE.IUniform<number>;
  /** Current walkable radius: the marker is clipped at the island's edge. */
  uArenaRadius: THREE.IUniform<number>;
};

const VERTEX = /* glsl */ `
varying vec2 vWorldXZ;
void main() {
	vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
	vWorldXZ = worldPosition.xz;
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uInk;
uniform vec2 uCenter;
uniform vec2 uFacing;
uniform float uAlpha;
uniform float uBrace;
uniform float uPulse;
uniform float uShadow;
uniform float uShadowRadius;
uniform float uArenaRadius;
varying vec2 vWorldXZ;

const float RING_RADIUS = 0.76;
const float BEAD_RADIUS = 0.1;
const float OUTLINE = 0.034;

void main() {
	vec2 p = vWorldXZ - uCenter;
	float d = length( p );
	float aa = fwidth( d ) * 1.2 + 0.0015;

	// Ring plus heading bead, as one signed distance.
	float ringWidth = mix( 0.085, 0.15, uBrace );
	float sdRing = abs( d - RING_RADIUS ) - ringWidth * 0.5;
	float sdBead = length( p - uFacing * RING_RADIUS ) - BEAD_RADIUS;
	float sd = min( sdRing, sdBead );
	float shape = 1.0 - smoothstep( - aa, aa, sd );
	float outline = 1.0 - smoothstep( - aa, aa, sd - OUTLINE );

	// Faint wash of the player colour inside the ring.
	float wash = ( 1.0 - smoothstep( RING_RADIUS - 0.3, RING_RADIUS, d ) ) * 0.14;

	// Brace pulse: a thin ring running outwards and fading.
	float pulseOn = step( 0.0, uPulse );
	float pulseT = clamp( uPulse, 0.0, 1.0 );
	float pulseRadius = RING_RADIUS + 0.9 * pulseT;
	float pulse = pulseOn * ( 1.0 - smoothstep( 0.025, 0.06 + aa, abs( d - pulseRadius ) ) ) * ( 1.0 - pulseT ) * ( 1.0 - pulseT );

	float colorAlpha = max( shape, max( wash, pulse * 0.85 ) ) * uAlpha;
	float inkAlpha = outline * 0.6 * uAlpha;

	// Soft contact shadow, strongest under the middle of the body.
	float shadowFall = 1.0 - smoothstep( 0.0, uShadowRadius, d );
	float shadowAlpha = uShadow * shadowFall * shadowFall;

	// Composite back to front: shadow / outline (both ink), then the colour.
	float under = max( inkAlpha, shadowAlpha );
	float alpha = colorAlpha + under * ( 1.0 - colorAlpha );
	vec3 color = ( uColor * colorAlpha + uInk * under * ( 1.0 - colorAlpha ) ) / max( alpha, 1e-4 );

	// Nothing floats past the edge of the island.
	alpha *= 1.0 - smoothstep( uArenaRadius - 0.05, uArenaRadius + 0.01, length( vWorldXZ ) );
	if ( alpha < 0.004 ) discard;

	gl_FragColor = vec4( color, alpha );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

export class GroundMarker {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly uniforms: MarkerUniforms;

  constructor(style: PlayerStyle) {
    this.uniforms = {
      uColor: { value: new THREE.Color(style.color) },
      uInk: { value: new THREE.Color(PALETTE.ink) },
      uCenter: { value: new THREE.Vector2() },
      uFacing: { value: new THREE.Vector2(0, 1) },
      uAlpha: { value: 0 },
      uBrace: { value: 0 },
      uPulse: { value: -1 },
      uShadow: { value: 0 },
      uShadowRadius: { value: 0.7 },
      uArenaRadius: { value: 6 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // The palette colour is the identity cue: keep it exact, not tone mapped.
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const geometry = new THREE.PlaneGeometry(HALF_SIZE * 2, HALF_SIZE * 2);
    geometry.rotateX(-Math.PI / 2); // lie flat, facing up
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "wrestler-ground-marker";
    this.mesh.frustumCulled = false;
    // Ground decals first, then the (transparent-pass) bodies standing on them.
    this.mesh.renderOrder = -2;
    this.mesh.visible = false;
  }

  /**
   * Place and style the marker for this frame. `alpha` 0 hides the ring (the blob
   * shadow has its own `shadow` opacity). `pulse` is 0..1, or negative for none.
   */
  set(
    x: number,
    z: number,
    facing: number,
    alpha: number,
    brace: number,
    pulse: number,
    shadow: number,
    shadowRadius: number,
    arenaRadius: number,
  ): void {
    const visible = alpha > 0.004 || shadow > 0.004;
    this.mesh.visible = visible;
    if (!visible) return;
    this.mesh.position.set(x, HEIGHT, z);
    const u = this.uniforms;
    u.uCenter.value.set(x, z);
    u.uFacing.value.set(Math.sin(facing), Math.cos(facing));
    u.uAlpha.value = alpha;
    u.uBrace.value = brace;
    u.uPulse.value = pulse;
    u.uShadow.value = shadow;
    u.uShadowRadius.value = shadowRadius;
    u.uArenaRadius.value = arenaRadius;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
