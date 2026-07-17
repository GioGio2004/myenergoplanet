"use client";

import * as THREE from "three";
import { GUN_POS, GUN_ROT, GUN_SCALE } from "@/components/simulation/anims";

// Mount a rifle onto a character's right-hand bone. Shared by the local Player
// and every RemotePlayer so all avatars carry the weapon identically.
// Returns the holder group (its child [0] is the gun scene) or null if the rig
// has no right hand.
export function mountGunToHand(
  characterRoot: THREE.Object3D,
  gunSource: THREE.Object3D,
): THREE.Group | null {
  let handBone: THREE.Object3D | null = null;
  characterRoot.traverse((o) => {
    if (
      !handBone &&
      (o as THREE.Bone).isBone &&
      o.name.includes("RightHand") &&
      !/Thumb|Index|Middle|Ring|Pinky/.test(o.name)
    ) {
      handBone = o;
    }
  });
  if (!handBone) return null;

  const holder = new THREE.Group();
  holder.name = "gun-holder";
  const gunScene = gunSource.clone(true);
  gunScene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.frustumCulled = false;
    }
  });
  holder.add(gunScene);
  holder.position.set(...GUN_POS);
  holder.rotation.set(...GUN_ROT);
  holder.scale.setScalar(GUN_SCALE);
  (handBone as THREE.Object3D).add(holder);
  return holder;
}

// Apply a skin tint to a character clone. Materials are CLONED first — the FBX
// cache shares material instances, so tinting without cloning would recolour
// every player at once.
export function applySkinTint(root: THREE.Object3D, tint: string | null): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      const pm = c as THREE.MeshPhongMaterial;
      if (tint && pm.color) pm.color.set(tint);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
}

// Weapon finish: same clone-then-tint rule as skins, applied to the mounted
// gun holder (the group returned by mountGunToHand).
export function tintGun(gunRoot: THREE.Object3D, tint: string | null): void {
  applySkinTint(gunRoot, tint);
}
