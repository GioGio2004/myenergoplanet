import { describe, expect, it } from "vitest";
import { gameConfig } from "../../config";
import { computeIslandLayout, tileArea } from "./layout";
import { buildTilePrismArrays } from "./tileGeometry";
import {
  DEFAULT_HEIGHT_VARIATION,
  DEFAULT_MAX_SAGITTA,
  buildTileItems,
  piecesForTile,
  segmentsForSpan,
  tileTopY,
} from "./tileItems";

const { radius, ringWidth, slabThickness } = gameConfig.arena;
const layout = computeIslandLayout({ radius, ringWidth });
const items = buildTileItems(layout, { thickness: slabThickness });

/** World XZ corners (a, b, c) of piece `p`'s top triangle. */
function corners(p: number, item: number) {
  const m = items.pieceLocal;
  const o = p * 16;
  const ax = m[o + 12] + items.pivot[item * 3];
  const az = m[o + 14] + items.pivot[item * 3 + 2];
  return {
    ax,
    az,
    bx: ax + m[o],
    bz: az + m[o + 2],
    cx: ax + m[o + 8],
    cz: az + m[o + 10],
    top: m[o + 13] + items.pivot[item * 3 + 1],
    thickness: m[o + 5],
  };
}

describe("tile prism geometry", () => {
  const { positions, normals, colors } = buildTilePrismArrays();

  it("is six flat triangles with outward, counter-clockwise faces", () => {
    expect(positions).toHaveLength(18 * 3);
    expect(normals).toHaveLength(18 * 3);
    expect(colors).toHaveLength(18 * 3);
    // Centroid of the prism.
    const centre = [1 / 3, -0.5, 1 / 3];
    for (let t = 0; t < 6; t++) {
      const o = t * 9;
      const a = [positions[o], positions[o + 1], positions[o + 2]];
      const b = [positions[o + 3], positions[o + 4], positions[o + 5]];
      const c = [positions[o + 6], positions[o + 7], positions[o + 8]];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const length = Math.hypot(n[0], n[1], n[2]);
      expect(length).toBeGreaterThan(0);
      for (let v = 0; v < 3; v++) {
        // Winding agrees with the stored normal…
        const stored = [normals[o + v * 3], normals[o + v * 3 + 1], normals[o + v * 3 + 2]];
        const dot = (n[0] * stored[0] + n[1] * stored[1] + n[2] * stored[2]) / length;
        expect(dot).toBeCloseTo(1);
      }
      // …and the normal points away from the prism's centre.
      const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const away =
        n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) + n[2] * (mid[2] - centre[2]);
      expect(away).toBeGreaterThan(0);
    }
  });

  it("spans y from -1 to 0 with a bright top and darker walls and underside", () => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 18; i++) {
      const y = positions[i * 3 + 1];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (normals[i * 3 + 1] > 0.5) expect(colors[i * 3]).toBe(1);
      if (normals[i * 3 + 1] < -0.5) expect(colors[i * 3]).toBeLessThan(0.5);
    }
    expect(minY).toBe(-1);
    expect(maxY).toBe(0);
  });
});

describe("tile items", () => {
  it("splits arcs until the chord error is under the tolerance", () => {
    expect(segmentsForSpan(0.01, 6, DEFAULT_MAX_SAGITTA)).toBe(1);
    for (const tile of layout.tiles) {
      const span = tile.endAngle - tile.startAngle;
      const segments = segmentsForSpan(span, tile.outerRadius, DEFAULT_MAX_SAGITTA);
      const sagitta = tile.outerRadius * (1 - Math.cos(span / segments / 2));
      expect(sagitta).toBeLessThanOrEqual(DEFAULT_MAX_SAGITTA + 1e-9);
    }
  });

  it("has one item per tile, grouped by ring, with contiguous pieces", () => {
    expect(items.itemCount).toBe(layout.tiles.length);
    expect(items.groupCount).toBe(layout.rings.length);
    for (const ring of layout.rings) {
      expect(items.groupStart[ring.index]).toBe(ring.firstTile);
    }
    expect(items.groupStart[items.groupCount]).toBe(items.itemCount);

    let pieces = 0;
    for (const tile of layout.tiles) {
      expect(items.pieceStart[tile.index]).toBe(pieces);
      pieces += piecesForTile(tile, DEFAULT_MAX_SAGITTA);
    }
    expect(items.pieceStart[items.itemCount]).toBe(pieces);
    expect(items.pieceCount).toBe(pieces);
    // Comfortably small: the whole floor is one cheap draw call.
    expect(pieces).toBeLessThan(700);
  });

  it("maps the unit prism without mirroring (positive determinant)", () => {
    for (let p = 0; p < items.pieceCount; p++) {
      const m = items.pieceLocal;
      const o = p * 16;
      // det of [X | Y | Z] with X = (m0, 0, m2), Y = (0, m5, 0), Z = (m8, 0, m10).
      const det = m[o + 5] * (m[o + 10] * m[o] - m[o + 8] * m[o + 2]);
      expect(det).toBeGreaterThan(0);
      expect(m[o + 15]).toBe(1);
    }
  });

  it("keeps every piece inside its tile and fills the tile", () => {
    for (const tile of layout.tiles) {
      let area = 0;
      for (let p = items.pieceStart[tile.index]; p < items.pieceStart[tile.index + 1]; p++) {
        const c = corners(p, tile.index);
        for (const [x, z] of [
          [c.ax, c.az],
          [c.bx, c.bz],
          [c.cx, c.cz],
        ]) {
          const r = Math.hypot(x, z);
          expect(r).toBeGreaterThanOrEqual(tile.innerRadius - 1e-4);
          expect(r).toBeLessThanOrEqual(tile.outerRadius + 1e-4);
        }
        area += 0.5 * Math.abs((c.bx - c.ax) * (c.cz - c.az) - (c.cx - c.ax) * (c.bz - c.az));
      }
      // Straight edges cut a sliver off the outer arc and add one on the inner arc.
      expect(area / tileArea(tile)).toBeGreaterThan(0.97);
      expect(area / tileArea(tile)).toBeLessThan(1.03);
    }
  });

  it("puts tile tops at y = 0 or a hair below, slab-thick", () => {
    for (const tile of layout.tiles) {
      const top = tileTopY(tile, DEFAULT_HEIGHT_VARIATION);
      if (tile.ring === 0) expect(top).toBe(0);
      expect(top).toBeLessThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(-DEFAULT_HEIGHT_VARIATION);
      for (let p = items.pieceStart[tile.index]; p < items.pieceStart[tile.index + 1]; p++) {
        const c = corners(p, tile.index);
        expect(c.top).toBeCloseTo(top, 5);
        expect(c.thickness).toBeCloseTo(slabThickness, 5);
      }
      expect(items.pivot[tile.index * 3]).toBeCloseTo(tile.x, 5);
      expect(items.pivot[tile.index * 3 + 2]).toBeCloseTo(tile.z, 5);
    }
  });

  it("gives ring tiles a unit tumble axis and an outward drift direction", () => {
    for (const tile of layout.tiles) {
      const i = tile.index;
      const axis = Math.hypot(items.axis[i * 3], items.axis[i * 3 + 1], items.axis[i * 3 + 2]);
      expect(axis).toBeCloseTo(1, 5);
      if (tile.ring === 0) continue;
      const ox = items.outward[i * 2];
      const oz = items.outward[i * 2 + 1];
      expect(Math.hypot(ox, oz)).toBeCloseTo(1, 5);
      expect(ox * tile.x + oz * tile.z).toBeCloseTo(tile.radius, 4);
    }
  });
});
