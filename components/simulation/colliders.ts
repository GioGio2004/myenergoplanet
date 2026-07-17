// Collision world for the training ground.
// One source of truth: Arena renders these crates, Player collides with them.
//
// Technique: every obstacle is an AABB (axis-aligned bounding box) on the XZ
// plane; the character is a circle with radius PLAYER_RADIUS. Movement uses
// collide-and-slide — X and Z are resolved separately, so hitting a wall at an
// angle slides you along it instead of stopping you dead (standard TPS feel).

export interface Crate {
  x: number;
  z: number;
  s: number; // cube edge length
  ry: number; // visual rotation (radians)
}

export const CRATES: Crate[] = [
  { x: 6, z: -4, s: 1.2, ry: 0.3 },
  { x: -7, z: 5, s: 1.5, ry: 0.9 },
  { x: 12, z: 8, s: 1.0, ry: 0.0 },
  { x: -13, z: -9, s: 2.0, ry: 0.5 },
  { x: 2, z: 14, s: 1.3, ry: 1.2 },
  { x: -3, z: -14, s: 1.1, ry: 0.7 },
  { x: 16, z: -12, s: 1.6, ry: 0.2 },
  { x: -17, z: 12, s: 1.4, ry: 1.0 },
];

export const PLAYER_RADIUS = 0.38;

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// A crate is rotated for looks, so its world-space bounding box is wider than
// its edge length: half-extent = s/2 · (|cos ry| + |sin ry|). Precomputed once.
const AABBS: Aabb[] = CRATES.map((c) => {
  const half = (c.s / 2) * (Math.abs(Math.cos(c.ry)) + Math.abs(Math.sin(c.ry)));
  return { minX: c.x - half, maxX: c.x + half, minZ: c.z - half, maxZ: c.z + half };
});

function hits(x: number, z: number, r: number): boolean {
  for (const b of AABBS) {
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
      return true;
    }
  }
  return false;
}

// Collide-and-slide: try the X move and the Z move independently; each axis is
// cancelled only if IT would end inside something. Returns the resolved position.
export function collideMove(
  fromX: number,
  fromZ: number,
  dx: number,
  dz: number,
): { x: number; z: number } {
  let x = fromX;
  let z = fromZ;
  if (dx !== 0 && !hits(x + dx, z, PLAYER_RADIUS)) x += dx;
  if (dz !== 0 && !hits(x, z + dz, PLAYER_RADIUS)) z += dz;
  return { x, z };
}
