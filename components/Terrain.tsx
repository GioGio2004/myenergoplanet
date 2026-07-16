"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

// Preload so it's ready before the start screen disappears
useGLTF.preload("/gameassets/main-island.glb");

// ─── Sizing ────────────────────────────────────────────────────────────────────
// The GLB is a Sketchfab FBX export. After its internal coordinate-correction
// matrices the island spans roughly:
//   X : −42 → +61  (≈103 units wide)
//   Y : −17 → +19  (≈36 units tall, sea-level ≈ Y=0 in scene space)
//   Z : −20 → +51  (≈71 units deep)
//
// At ISLAND_SCALE = 0.45 the footprint becomes ≈ 46 × 32 world units — large
// enough to walk around, small enough for the camera arm to frame it nicely.
//
// Offset strategy
// ───────────────
// We compute Box3 on the *unscaled* clone (scene space).  The position prop on
// the primitive is in world/parent space, and with scale S, a scene vertex at
// position v_scene lands at:
//
//   v_world = v_scene × S + position
//
// So to centre the island horizontally and keep sea-level (v_scene.y ≈ 0) at
// world Y = 0:
//
//   px = −center.x × S        (cancels horizontal offset)
//   py = 0                     (scene Y=0 stays at world Y=0)
//   pz = −center.z × S        (cancels depth offset)

const ISLAND_SCALE = 0.45;

export function Terrain() {
  const { scene } = useGLTF("/gameassets/main-island.glb");

  const { clone, px, py, pz } = useMemo(() => {
    const c = scene.clone(true);

    // Enable shadows on every submesh
    c.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    // Compute AABB in scene space (before our ISLAND_SCALE is applied).
    // updateMatrixWorld ensures all internal node transforms are resolved.
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);

    if (box.isEmpty()) {
      // Safeguard: scene not ready yet — place at origin
      return { clone: c, px: 0, py: 0, pz: 0 };
    }

    const center = new THREE.Vector3();
    box.getCenter(center);

    // See derivation above: position = −center × S for X and Z.
    // Y: leave at 0 so the island's natural sea-level sits at world Y=0.
    return {
      clone: c,
      px: -center.x * ISLAND_SCALE,
      py: 0,
      pz: -center.z * ISLAND_SCALE,
    };
  }, [scene]);

  return (
    <group name="terrain">
      {/* Ocean floor / safety plane — keeps the character from falling through
          mesh gaps and fills the space beneath the island with colour */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -2, 0]}
        receiveShadow
      >
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#061020" roughness={1} />
      </mesh>

      {/* The island */}
      <primitive
        object={clone}
        scale={ISLAND_SCALE}
        position={[px, py, pz]}
      />
    </group>
  );
}
