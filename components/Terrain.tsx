"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

// ─── Tile paths (only the tiles actually used in this map) ────────────────────
const P = {
  roomLarge: "/gameassets/landscape/room-large.glb",
  roomSmall: "/gameassets/landscape/room-small.glb",
  roomWide: "/gameassets/landscape/room-wide.glb",
  corridor: "/gameassets/landscape/corridor.glb",
  corridorEnd: "/gameassets/landscape/corridor-end.glb",
  corridorIntersect: "/gameassets/landscape/corridor-intersection.glb",
  gate: "/gameassets/landscape/gate.glb",
} as const;

// Preload only what we use
Object.values(P).forEach((path) => useGLTF.preload(path));

// ─── Tile scale & step ────────────────────────────────────────────────────────
// Kenney dungeon tiles are 2 world-units wide at scale=1.
// We render at scale=2 → each tile occupies 4 world units.
// Step between tile centres must equal tile size = 4.
const SCALE = 2;
const STEP = 4;

// ─── Single tile renderer ─────────────────────────────────────────────────────
function Tile({
  path,
  position,
  rotY = 0,
}: {
  path: string;
  position: [number, number, number];
  rotY?: number;
}) {
  const { scene } = useGLTF(path);
  const clone = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return c;
  }, [scene]);

  return (
    <primitive
      object={clone}
      position={position}
      rotation={[0, rotY, 0]}
      scale={SCALE}
    />
  );
}

// ─── Map layout ───────────────────────────────────────────────────────────────
//
//  Top-down diagram (each cell = 1 STEP = 4 world units):
//
//              [END]
//                |
//             [CORR]
//                |
//  [ROOM-W]--[CORR]--[INTERSECT]--[CORR]--[ROOM-E]
//                |
//             [CORR]
//                |
//             [GATE]
//
// The character spawns at [0,0,0] = the intersection centre.

type TileDef = { path: string; pos: [number, number, number]; rot?: number };

const MAP: TileDef[] = [
  // ── Hub: 4-way intersection ──────────────────────────────────────────────
  { path: P.corridorIntersect, pos: [0, 0, 0] },

  // ── North: corridor → dead-end ──────────────────────────────────────────
  { path: P.corridor, pos: [0, 0, -STEP] },
  { path: P.corridorEnd, pos: [0, 0, -STEP * 2], rot: Math.PI },

  // ── South: corridor → gate (entrance) ───────────────────────────────────
  { path: P.corridor, pos: [0, 0, STEP] },
  { path: P.gate, pos: [0, 0, STEP * 2] },

  // ── East: corridor → wide room ──────────────────────────────────────────
  { path: P.corridor, pos: [STEP, 0, 0], rot: Math.PI / 2 },
  { path: P.roomWide, pos: [STEP * 2, 0, 0], rot: Math.PI / 2 },

  // ── West: corridor → large room ─────────────────────────────────────────
  { path: P.corridor, pos: [-STEP, 0, 0], rot: -Math.PI / 2 },
  { path: P.roomLarge, pos: [-STEP * 2, 0, 0] },

  // ── NE pocket room ───────────────────────────────────────────────────────
  { path: P.corridor, pos: [STEP, 0, -STEP], rot: Math.PI / 2 },
  { path: P.roomSmall, pos: [STEP * 2, 0, -STEP] },

  // ── NW pocket room ───────────────────────────────────────────────────────
  { path: P.corridor, pos: [-STEP, 0, -STEP], rot: -Math.PI / 2 },
  { path: P.roomSmall, pos: [-STEP * 2, 0, -STEP] },
];

// ─── Terrain component ────────────────────────────────────────────────────────
export function Terrain() {
  return (
    <group name="terrain">
      {/* Flat safety ground — character always has floor even at tile seams */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.05, 0]}
        receiveShadow
      >
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#1a0f0a" roughness={1} />
      </mesh>

      {MAP.map((def, i) => (
        <Tile key={i} path={def.path} position={def.pos} rotY={def.rot ?? 0} />
      ))}
    </group>
  );
}
