import { describe, expect, it } from "vitest";
import { gameConfig } from "../../config";
import { hash01 } from "../../math";
import {
  DEFAULT_TILE_ARC,
  DEFAULT_TILE_GAP,
  computeIslandLayout,
  firstRingOutside,
  ringCountFor,
  ringIndexAt,
  tileArea,
  tileContains,
  tileIndexAt,
  tilesInRing,
} from "./layout";

const TAU = Math.PI * 2;
const { radius, ringWidth } = gameConfig.arena;
const layout = computeIslandLayout({ radius, ringWidth });

describe("island layout", () => {
  it("has a centre pad and one ring per ringWidth out to the radius", () => {
    expect(ringCountFor(radius, ringWidth)).toBe(6);
    expect(layout.rings).toHaveLength(6);
    expect(layout.rings[0].tileCount).toBe(1);
    expect(layout.rings[0].innerRadius).toBe(0);
    expect(layout.rings[layout.rings.length - 1].outerRadius).toBe(radius);
    for (const ring of layout.rings) {
      expect(ring.nominalInner).toBeCloseTo(ring.index * ringWidth);
      expect(ring.nominalOuter).toBeCloseTo((ring.index + 1) * ringWidth);
    }
  });

  it("handles a radius that is not a multiple of the ring width", () => {
    const odd = computeIslandLayout({ radius: 4.5, ringWidth: 1 });
    expect(odd.rings).toHaveLength(5);
    expect(odd.rings[4].nominalOuter).toBe(4.5);
    expect(odd.rings[4].outerRadius).toBe(4.5);
    expect(ringCountFor(0.4, 1)).toBe(1);
  });

  it("counts tiles consistently", () => {
    let total = 0;
    for (const ring of layout.rings) {
      expect(ring.firstTile).toBe(total);
      expect(ring.tileCount).toBe(
        tilesInRing(ring.index, ring.nominalInner, ring.nominalOuter, DEFAULT_TILE_ARC),
      );
      total += ring.tileCount;
    }
    expect(layout.tiles).toHaveLength(total);
    // More tiles on every ring further out.
    for (let r = 1; r < layout.rings.length; r++) {
      expect(layout.rings[r].tileCount).toBeGreaterThan(layout.rings[r - 1].tileCount);
    }
    // 1 + 8 + 14 + 19 + 25 + 30 with the default arc length.
    expect(total).toBe(97);
  });

  it("gives every tile its ring, index and a centre inside itself", () => {
    layout.tiles.forEach((tile, i) => {
      expect(tile.index).toBe(i);
      const ring = layout.rings[tile.ring];
      expect(i).toBeGreaterThanOrEqual(ring.firstTile);
      expect(i).toBeLessThan(ring.firstTile + ring.tileCount);
      expect(tile.indexInRing).toBe(i - ring.firstTile);
      expect(tile.innerRadius).toBe(ring.innerRadius);
      expect(tile.outerRadius).toBe(ring.outerRadius);
      expect(tile.endAngle).toBeGreaterThan(tile.startAngle);
      expect(Math.hypot(tile.x, tile.z)).toBeCloseTo(tile.radius);
      expect(ringIndexAt(layout, tile.radius)).toBe(tile.ring);
      expect(tileContains(tile, tile.x, tile.z)).toBe(true);
      expect(tileIndexAt(layout, tile.x, tile.z)).toBe(i);
      expect(tile.hash).toBeGreaterThanOrEqual(0);
      expect(tile.hash).toBeLessThan(1);
    });
  });

  it("uses the same angle convention as spawnPoint (angle 0 = +Z)", () => {
    const tile = layout.tiles[layout.rings[3].firstTile];
    expect(tile.x).toBeCloseTo(Math.sin(tile.angle) * tile.radius);
    expect(tile.z).toBeCloseTo(Math.cos(tile.angle) * tile.radius);
  });

  it("keeps tiles of a ring about one target arc long", () => {
    for (const ring of layout.rings) {
      if (ring.index === 0) continue;
      const mid = (ring.nominalInner + ring.nominalOuter) / 2;
      const arc = (TAU / ring.tileCount) * mid;
      expect(arc).toBeGreaterThan(DEFAULT_TILE_ARC * 0.85);
      expect(arc).toBeLessThan(DEFAULT_TILE_ARC * 1.15);
    }
  });

  it("never overlaps: rings are separated radially, tiles angularly, by the gap", () => {
    for (let r = 1; r < layout.rings.length; r++) {
      const gap = layout.rings[r].innerRadius - layout.rings[r - 1].outerRadius;
      expect(gap).toBeCloseTo(DEFAULT_TILE_GAP);
    }
    for (const ring of layout.rings) {
      if (ring.tileCount < 2) continue;
      const mid = (ring.nominalInner + ring.nominalOuter) / 2;
      let covered = 0;
      for (let i = 0; i < ring.tileCount; i++) {
        const tile = layout.tiles[ring.firstTile + i];
        const next = layout.tiles[ring.firstTile + ((i + 1) % ring.tileCount)];
        const nextStart = i === ring.tileCount - 1 ? next.startAngle + TAU : next.startAngle;
        const gapAngle = nextStart - tile.endAngle;
        expect(gapAngle).toBeGreaterThan(0);
        expect(gapAngle * mid).toBeCloseTo(DEFAULT_TILE_GAP);
        covered += tile.endAngle - tile.startAngle;
      }
      // The ring is fully used apart from the gaps.
      expect(covered + ring.tileCount * (DEFAULT_TILE_GAP / mid)).toBeCloseTo(TAU);
    }
  });

  it("never puts a point on two tiles, and covers nearly all of the disc", () => {
    const samples = 20000;
    let inside = 0;
    for (let s = 0; s < samples; s++) {
      // Uniform over the disc.
      const r = radius * Math.sqrt(hash01(s * 2 + 1));
      const a = TAU * hash01(s * 2 + 2);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      let hits = 0;
      for (const tile of layout.tiles) if (tileContains(tile, x, z)) hits++;
      expect(hits).toBeLessThanOrEqual(1);
      expect(tileIndexAt(layout, x, z) >= 0).toBe(hits === 1);
      inside += hits;
    }
    expect(inside / samples).toBeGreaterThan(0.9);

    let area = 0;
    for (const tile of layout.tiles) area += tileArea(tile);
    const disc = Math.PI * radius * radius;
    expect(area).toBeLessThan(disc);
    expect(area / disc).toBeGreaterThan(0.9);
    expect(inside / samples).toBeCloseTo(area / disc, 1);
  });

  it("is off the island beyond the radius", () => {
    expect(ringIndexAt(layout, radius + 0.01)).toBe(-1);
    expect(tileIndexAt(layout, radius + 0.5, 0)).toBe(-1);
    expect(ringIndexAt(layout, radius)).toBe(layout.rings.length - 1);
  });

  it("staggers the rings so seams do not line up", () => {
    const starts = layout.rings.slice(1).map((ring) => layout.tiles[ring.firstTile].startAngle);
    expect(new Set(starts.map((a) => a.toFixed(4))).size).toBe(starts.length);
  });

  it("is deterministic and seedable", () => {
    const again = computeIslandLayout({ radius, ringWidth });
    expect(again).toEqual(layout);
    const other = computeIslandLayout({ radius, ringWidth, seed: 2 });
    expect(other.tiles[20].hash).not.toBe(layout.tiles[20].hash);
  });

  it("knows which rings fall for each crumble step", () => {
    expect(firstRingOutside(layout, radius)).toBe(layout.rings.length);
    const [first, second] = gameConfig.arena.crumble.steps;
    expect(firstRingOutside(layout, first.radius)).toBe(5);
    expect(firstRingOutside(layout, second.radius)).toBe(4);
    // A radius inside a ring keeps that ring until its centre line is outside.
    expect(firstRingOutside(layout, 4.6)).toBe(5);
    expect(firstRingOutside(layout, 4.4)).toBe(4);
    expect(firstRingOutside(layout, 0)).toBe(0);
  });

  it("rejects nonsense", () => {
    expect(() => computeIslandLayout({ radius: 0, ringWidth: 1 })).toThrow();
    expect(() => computeIslandLayout({ radius: 6, ringWidth: 1, gap: 1 })).toThrow();
  });
});
