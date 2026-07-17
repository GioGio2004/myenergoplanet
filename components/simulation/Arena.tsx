"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeElements } from "@react-three/fiber";
import { CRATES } from "@/components/simulation/colliders";
import { registerHitable } from "@/components/simulation/shooting";

// Training-ground arena: flat floor, boundary walls, and crates for cover.
// Crate positions live in colliders.ts (single source of truth: what you see is
// exactly what blocks you). Every solid surface registers as a bullet-hitable,
// so cover actually stops shots.

// Mesh that bullets can hit — registers itself with the shooting system.
function HitableMesh(props: ThreeElements["mesh"] & { children?: React.ReactNode }) {
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    return registerHitable(ref.current);
  }, []);
  return <mesh ref={ref} {...props} />;
}

export function Arena() {
  // Checkerboard floor texture generated in code (crisp, zero download).
  const floorTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1b2a38";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#20323f";
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if ((x + y) % 2 === 0) ctx.fillRect(x * 32, y * 32, 32, 32);
    ctx.strokeStyle = "#2c4254";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(15, 15);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  return (
    <group>
      {/* Floor */}
      <HitableMesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={floorTex} roughness={0.95} />
      </HitableMesh>

      {/* Boundary walls */}
      {(
        [
          [0, -30, 60.4, 0],
          [0, 30, 60.4, 0],
          [-30, 0, 60.4, Math.PI / 2],
          [30, 0, 60.4, Math.PI / 2],
        ] as const
      ).map(([x, z, len, ry], i) => (
        <HitableMesh
          key={i}
          position={[x, 1.1, z]}
          rotation={[0, ry, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[len, 2.2, 0.4]} />
          <meshStandardMaterial color="#243447" roughness={0.9} />
        </HitableMesh>
      ))}

      {/* Crates / cover blocks */}
      {CRATES.map((c, i) => (
        <HitableMesh
          key={`crate-${i}`}
          position={[c.x, c.s / 2, c.z]}
          rotation={[0, c.ry, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[c.s, c.s, c.s]} />
          <meshStandardMaterial color={i % 2 ? "#8a5a2b" : "#6e7f8d"} roughness={0.85} />
        </HitableMesh>
      ))}

      {/* Centre marker so you always know where spawn is */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[1.6, 1.75, 48]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}
