"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { registerHitable, registerTarget } from "@/components/simulation/shooting";
import { TARGET_HP, TARGET_RESPAWN } from "@/components/simulation/anims";
import { simStore } from "@/components/simulation/store";

// Shooting-range targets: a post with a silhouette board. 3 hits → it topples,
// respawns a few seconds later. All state lives in refs (per-frame), score goes
// through simStore so the HUD updates.

const SPOTS: { x: number; z: number; ry: number }[] = [
  { x: 0, z: -22, ry: 0 },
  { x: 14, z: -18, ry: -0.4 },
  { x: -15, z: -16, ry: 0.5 },
  { x: 24, z: 2, ry: -1.2 },
  { x: -24, z: 4, ry: 1.3 },
  { x: 8, z: 20, ry: Math.PI - 0.4 },
  { x: -9, z: 22, ry: Math.PI + 0.35 },
];

function Target({ id, x, z, ry }: { id: string; x: number; z: number; ry: number }) {
  const swing = useRef<THREE.Group>(null); // rotates when toppling
  const board = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);

  const hp = useRef(TARGET_HP);
  const dead = useRef(false);
  const respawnAt = useRef(0);
  const flashUntil = useRef(0);
  const flashing = useRef(false);

  // One shared material per target so the hit-flash tints board + head. It is
  // created and attached in an effect (never during render) and mutated only
  // through this ref in the frame loop — both compiler-approved paths.
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);

  useEffect(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: "#c9d4dd",
      roughness: 0.7,
      emissive: "#000000",
    });
    matRef.current = mat;

    const offs: (() => void)[] = [];
    if (board.current) {
      board.current.userData.targetId = id;
      board.current.material = mat;
      offs.push(registerHitable(board.current));
    }
    if (head.current) {
      head.current.userData.targetId = id;
      head.current.material = mat;
      offs.push(registerHitable(head.current));
    }
    offs.push(() => {
      mat.dispose();
      matRef.current = null;
    });
    offs.push(
      registerTarget(id, () => {
        if (dead.current) return;
        hp.current -= 1;
        flashUntil.current = performance.now() + 110;
        if (hp.current <= 0) {
          dead.current = true;
          respawnAt.current = performance.now() + TARGET_RESPAWN * 1000;
          simStore.set({ score: simStore.get().score + 1 });
        }
      }),
    );
    return () => offs.forEach((f) => f());
  }, [id]);

  useFrame((_, dt) => {
    const now = performance.now();

    // Hit flash (emissive pulse) — only touch the material on state change
    const mat = matRef.current;
    const isFlashing = now < flashUntil.current;
    if (mat && isFlashing !== flashing.current) {
      flashing.current = isFlashing;
      mat.emissive.set(isFlashing ? "#f97316" : "#000000");
      mat.emissiveIntensity = isFlashing ? 1.4 : 0;
    }

    // Topple / respawn
    const s = swing.current;
    if (!s) return;
    if (dead.current) {
      s.rotation.x = THREE.MathUtils.lerp(s.rotation.x, -Math.PI / 2, Math.min(1, 9 * dt));
      if (now >= respawnAt.current) {
        dead.current = false;
        hp.current = TARGET_HP;
      }
    } else {
      s.rotation.x = THREE.MathUtils.lerp(s.rotation.x, 0, Math.min(1, 7 * dt));
    }
  });

  return (
    <group position={[x, 0, z]} rotation={[0, ry, 0]}>
      {/* Post (static) */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 1.1, 8]} />
        <meshStandardMaterial color="#5a6a76" roughness={0.9} />
      </mesh>
      {/* Swinging silhouette — pivots at the top of the post. The shared
          flash material is attached in the mount effect. */}
      <group ref={swing} position={[0, 1.1, 0]}>
        <mesh ref={board} position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.6, 0.85, 0.07]} />
        </mesh>
        <mesh ref={head} position={[0, 1.02, 0]} castShadow>
          <sphereGeometry args={[0.17, 16, 12]} />
        </mesh>
      </group>
    </group>
  );
}

export function Targets() {
  return (
    <group>
      {SPOTS.map((s, i) => (
        <Target key={i} id={`target-${i}`} x={s.x} z={s.z} ry={s.ry} />
      ))}
    </group>
  );
}
