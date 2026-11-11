// The one geometry every dirt tile is built from: a unit triangular prism.
//
// Footprint: the right triangle A (0,0), B (1,0), C (0,1) in XZ. Top face at y = 0,
// bottom at y = -1. It has walls on the two legs (A–B and A–C) but none on the
// hypotenuse: two prisms always meet there to form one tile segment, so that wall
// would only ever be hidden inside the tile.

import * as THREE from "three";

/** Vertex-colour multipliers: walls fade to dark toward the underside. */
const TOP_SHADE = 1;
const WALL_BOTTOM_SHADE = 0.4;
const UNDERSIDE_SHADE = 0.32;

/** 18 vertices (6 triangles), flat-shaded. Exported as raw arrays so it can be tested without WebGL. */
export function buildTilePrismArrays(): {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
} {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const push = (
    v: readonly (readonly [number, number, number])[],
    normal: readonly [number, number, number],
  ) => {
    for (const [x, y, z] of v) {
      positions.push(x, y, z);
      normals.push(normal[0], normal[1], normal[2]);
      const shade = normal[1] < -0.5 ? UNDERSIDE_SHADE : y > -0.5 ? TOP_SHADE : WALL_BOTTOM_SHADE;
      colors.push(shade, shade, shade);
    }
  };

  const A = [0, 0, 0] as const;
  const B = [1, 0, 0] as const;
  const C = [0, 0, 1] as const;
  const A1 = [0, -1, 0] as const;
  const B1 = [1, -1, 0] as const;
  const C1 = [0, -1, 1] as const;

  // Counter-clockwise seen from outside.
  push([A, C, B], [0, 1, 0]); // top
  push([A1, B1, C1], [0, -1, 0]); // underside
  push([A, B, B1], [0, 0, -1]); // wall on A–B
  push([A, B1, A1], [0, 0, -1]);
  push([A, C1, C], [-1, 0, 0]); // wall on A–C
  push([A, A1, C1], [-1, 0, 0]);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
  };
}

export function createTilePrismGeometry(): THREE.BufferGeometry {
  const { positions, normals, colors } = buildTilePrismArrays();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}
