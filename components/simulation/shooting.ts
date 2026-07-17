"use client";

import * as THREE from "three";

// ── Bullet-collision registry ────────────────────────────────────────────────
// Everything a bullet can hit registers itself here (crates, walls, floor,
// target boards). The Player raycasts ONLY against this list — never the whole
// scene — so tracers/flashes/the character itself can't swallow bullets.

const hitables = new Set<THREE.Object3D>();

export function registerHitable(obj: THREE.Object3D): () => void {
  hitables.add(obj);
  return () => {
    hitables.delete(obj);
  };
}

export function getHitables(): THREE.Object3D[] {
  return Array.from(hitables);
}

// ── Damage routing ───────────────────────────────────────────────────────────
// Target meshes carry userData.targetId; each Target component registers a
// damage handler under that id. The Player looks the id up on hit.

type DamageFn = (dmg: number, point: THREE.Vector3) => void;
const damageHandlers = new Map<string, DamageFn>();

export function registerTarget(id: string, fn: DamageFn): () => void {
  damageHandlers.set(id, fn);
  return () => {
    damageHandlers.delete(id);
  };
}

export function damageTarget(id: string, dmg: number, point: THREE.Vector3): boolean {
  const fn = damageHandlers.get(id);
  if (!fn) return false;
  fn(dmg, point);
  return true;
}
