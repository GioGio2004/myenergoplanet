// The droplet draw call: ONE InstancedMesh of glossy teardrops with per-instance colour.
// Plain three.js (no React) so the component only ever calls methods on it.

import * as THREE from "three";
import { writeParticleInstances, type ParticlePool } from "./particlePool";

/** Extra length per unit of speed, and its cap (a droplet at rest is a sphere). */
const STRETCH_PER_SPEED = 0.085;
const MAX_STRETCH = 1.1;

/**
 * Reshape a unit sphere (in place) into a teardrop: the +Y half stays round (the nose,
 * which the instance matrix points along the velocity), the -Y half tapers into a tail.
 * Normals are recomputed analytically from the profile curve, so there is no seam.
 */
export function shapeTeardrop(positions: Float32Array, normals: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (y >= 0) continue;

    const t = Math.min(-y, 0.999); // 0 at the equator → 1 at the tail tip
    const ring = Math.sqrt(1 - t * t); // sphere radius at this latitude
    const taper = 1 - 0.5 * t * t;
    positions[i] = x * taper;
    positions[i + 1] = y * (1 + 0.6 * t);
    positions[i + 2] = z * taper;

    // Profile (rho(t), Y(t)) = (ring * taper, -t (1 + 0.6 t)); outward normal = (-dY/dt, drho/dt).
    const dRho = (-t / ring) * taper - ring * t;
    const nRho = 1 + 1.2 * t;
    const inv = 1 / Math.hypot(nRho, dRho);
    const radial = Math.hypot(x, z);
    if (radial < 1e-6) {
      normals[i] = 0;
      normals[i + 1] = -1;
      normals[i + 2] = 0;
    } else {
      normals[i] = (x / radial) * nRho * inv;
      normals[i + 1] = dRho * inv;
      normals[i + 2] = (z / radial) * nRho * inv;
    }
  }
}

function createTeardropGeometry(widthSegments: number, heightSegments: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  shapeTeardrop(
    geometry.attributes.position.array as Float32Array,
    geometry.attributes.normal.array as Float32Array,
  );
  geometry.deleteAttribute("uv"); // unused: saves two floats per vertex
  return geometry;
}

// Self-lit body + fresnel rim, so droplets read as the same glowing liquid as the
// wrestlers even on their shadowed side. `diffuseColor` already carries the instance colour.
const RIM_TOKEN = "#include <emissivemap_fragment>";
const RIM_FRAGMENT = /* glsl */ `
#include <emissivemap_fragment>
{
	float dropletFresnel = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 2.5 );
	totalEmissiveRadiance += diffuseColor.rgb * 0.22
		+ mix( diffuseColor.rgb, vec3( 1.0 ), 0.55 ) * ( dropletFresnel * 0.45 );
}`;

function createDropletMaterial(): THREE.MeshStandardMaterial {
  // White base colour: the final albedo is material.color × instanceColor.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.16,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    // If a future three.js renames the chunk, fall back to the plain glossy material.
    if (shader.fragmentShader.includes(RIM_TOKEN)) {
      shader.fragmentShader = shader.fragmentShader.replace(RIM_TOKEN, RIM_FRAGMENT);
    }
  };
  material.customProgramCacheKey = () => "sumo-droplet-v1";
  return material;
}

export type DropletMeshOptions = {
  /** Pool size = maximum instance count. */
  capacity: number;
  /** Fewer triangles per droplet (Low preset). */
  lowDetail: boolean;
  castShadow: boolean;
};

export class DropletMesh {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;

  constructor({ capacity, lowDetail, castShadow }: DropletMeshOptions) {
    this.geometry = lowDetail ? createTeardropGeometry(8, 6) : createTeardropGeometry(12, 8);
    this.material = createDropletMaterial();

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = "splash-droplets";
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Create the colour attribute up front so the shader variant never changes mid-match.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; // nothing alive yet: three skips the draw call entirely
    mesh.frustumCulled = false; // instances move every frame; the bounds would be stale
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false; // stays at the identity
    this.mesh = mesh;
    this.matrices = mesh.instanceMatrix.array as Float32Array;
    this.colors = mesh.instanceColor.array as Float32Array;
  }

  /** Copy the live droplets into the instance buffers. Call once per frame after the update. */
  sync(pool: ParticlePool): void {
    const mesh = this.mesh;
    const count = writeParticleInstances(
      pool,
      this.matrices,
      this.colors,
      STRETCH_PER_SPEED,
      MAX_STRETCH,
    );
    mesh.count = count;
    if (count > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Free GPU resources. The object stays usable (three re-uploads on the next render). */
  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
