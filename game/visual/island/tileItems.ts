// Turns the tile layout into instances of ONE unit prism (see tileGeometry.ts).
//
// A wedge of a ring is not an affine image of any single shape (its inner and outer
// edges have a different length ratio on every ring), so each wedge is cut into
// straight-edged segments and each segment into two triangles. Any triangle IS an
// affine image of the unit right triangle, so one geometry and one draw call cover
// the whole floor. Pure numbers, no three.js.

import { hash01 } from "../../math";
import { createCrumbleItems, type CrumbleItems } from "./crumbleItems";
import type { IslandLayout, TileLayout } from "./layout";

/** A curved edge is split until its chord strays less than this from the true arc. */
export const DEFAULT_MAX_SAGITTA = 0.015;
/** Tile tops sit between `-heightVariation` and 0 (never above the physics floor). */
export const DEFAULT_HEIGHT_VARIATION = 0.025;

export type TileItemOptions = {
  /** Slab thickness: tiles reach from their top down by this much. */
  thickness: number;
  maxSagitta?: number;
  heightVariation?: number;
};

/** Straight segments needed for an arc of `span` radians at `outerRadius`. */
export function segmentsForSpan(span: number, outerRadius: number, maxSagitta: number): number {
  if (outerRadius <= maxSagitta) return 1;
  const maxAngle = 2 * Math.acos(1 - maxSagitta / outerRadius);
  return Math.max(1, Math.ceil(span / maxAngle - 1e-9));
}

function isPie(tile: TileLayout): boolean {
  return tile.innerRadius <= 1e-6;
}

/** Instances a tile needs: one triangle per segment for a pie slice, else two. */
export function piecesForTile(tile: TileLayout, maxSagitta: number): number {
  const segments = segmentsForSpan(tile.endAngle - tile.startAngle, tile.outerRadius, maxSagitta);
  return isPie(tile) ? segments : segments * 2;
}

/**
 * Height of a tile's top surface: a hair of unevenness, never above y = 0.
 * The centre pad is exactly at 0 (the starting lines are drawn on it).
 */
export function tileTopY(tile: TileLayout, heightVariation: number): number {
  if (tile.ring === 0) return 0;
  return -heightVariation * hash01(tile.index * 3 + 101);
}

/**
 * Write the matrix that maps the unit prism (right triangle (0,0) (1,0) (0,1) in XZ,
 * y from -1 to 0) onto the triangle a → b → c, `thickness` deep, relative to a pivot.
 */
function writeTriangle(
  out: Float32Array,
  o: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  topY: number,
  thickness: number,
  pivotX: number,
  pivotY: number,
  pivotZ: number,
): void {
  // Column-major: X column = a→b, Y column = up × thickness, Z column = a→c.
  out[o] = bx - ax;
  out[o + 1] = 0;
  out[o + 2] = bz - az;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = thickness;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = cx - ax;
  out[o + 9] = 0;
  out[o + 10] = cz - az;
  out[o + 11] = 0;
  out[o + 12] = ax - pivotX;
  out[o + 13] = topY - pivotY;
  out[o + 14] = az - pivotZ;
  out[o + 15] = 1;
}

/**
 * One item per tile (grouped by ring), with the instance matrices of its pieces.
 * Colours are left white; see `fillTileColors`.
 */
export function buildTileItems(layout: IslandLayout, options: TileItemOptions): CrumbleItems {
  const thickness = options.thickness;
  const maxSagitta = options.maxSagitta ?? DEFAULT_MAX_SAGITTA;
  const heightVariation = options.heightVariation ?? DEFAULT_HEIGHT_VARIATION;

  let pieceCount = 0;
  for (const tile of layout.tiles) pieceCount += piecesForTile(tile, maxSagitta);

  const items = createCrumbleItems(layout.tiles.length, pieceCount, layout.rings.length);
  for (const ring of layout.rings) items.groupStart[ring.index] = ring.firstTile;
  items.groupStart[layout.rings.length] = layout.tiles.length;

  let piece = 0;
  for (const tile of layout.tiles) {
    const i = tile.index;
    const topY = tileTopY(tile, heightVariation);
    const pivotX = tile.x;
    const pivotY = topY - thickness / 2;
    const pivotZ = tile.z;

    items.pieceStart[i] = piece;
    items.pivot[i * 3] = pivotX;
    items.pivot[i * 3 + 1] = pivotY;
    items.pivot[i * 3 + 2] = pivotZ;

    if (isPie(tile)) {
      // The centre pad has no outward direction; it would simply drop.
      items.axis[i * 3] = 1;
    } else {
      // Tumble about the tangent (so the outer edge dips first), each tile a little askew.
      let tx = Math.cos(tile.angle) + (hash01(i * 5 + 211) - 0.5) * 0.7;
      let ty = (hash01(i * 5 + 212) - 0.5) * 0.5;
      let tz = -Math.sin(tile.angle) + (hash01(i * 5 + 213) - 0.5) * 0.7;
      const inv = 1 / Math.hypot(tx, ty, tz);
      tx *= inv;
      ty *= inv;
      tz *= inv;
      items.axis[i * 3] = tx;
      items.axis[i * 3 + 1] = ty;
      items.axis[i * 3 + 2] = tz;
      items.outward[i * 2] = Math.sin(tile.angle);
      items.outward[i * 2 + 1] = Math.cos(tile.angle);
    }

    const span = tile.endAngle - tile.startAngle;
    const segments = segmentsForSpan(span, tile.outerRadius, maxSagitta);
    const ri = tile.innerRadius;
    const ro = tile.outerRadius;
    for (let s = 0; s < segments; s++) {
      const a0 = tile.startAngle + (span * s) / segments;
      const a1 = tile.startAngle + (span * (s + 1)) / segments;
      const s0 = Math.sin(a0);
      const c0 = Math.cos(a0);
      const s1 = Math.sin(a1);
      const c1 = Math.cos(a1);

      if (isPie(tile)) {
        // outer@a1 → outer@a0 → centre: the prism's z = 0 wall is the outer edge.
        writeTriangle(
          items.pieceLocal,
          piece * 16,
          s1 * ro,
          c1 * ro,
          s0 * ro,
          c0 * ro,
          0,
          0,
          topY,
          thickness,
          pivotX,
          pivotY,
          pivotZ,
        );
        piece++;
        continue;
      }

      // inner@a0 → inner@a1 → outer@a0: walls on the inner edge and the a0 side.
      writeTriangle(
        items.pieceLocal,
        piece * 16,
        s0 * ri,
        c0 * ri,
        s1 * ri,
        c1 * ri,
        s0 * ro,
        c0 * ro,
        topY,
        thickness,
        pivotX,
        pivotY,
        pivotZ,
      );
      piece++;
      // outer@a1 → outer@a0 → inner@a1: walls on the outer edge and the a1 side.
      writeTriangle(
        items.pieceLocal,
        piece * 16,
        s1 * ro,
        c1 * ro,
        s0 * ro,
        c0 * ro,
        s1 * ri,
        c1 * ri,
        topY,
        thickness,
        pivotX,
        pivotY,
        pivotZ,
      );
      piece++;
    }
  }
  items.pieceStart[layout.tiles.length] = piece;

  return items;
}
