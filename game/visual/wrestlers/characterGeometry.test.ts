import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PLAYER_STYLES, QUALITY_PRESETS, type BeltPattern, type TopknotStyle } from "../../config";
import {
  HEAD_TOP_Y,
  PART,
  bodyRadius,
  buildCharacterGeometry,
} from "./characterGeometry";
import { BODY_RADIUS } from "./deform";

const TOPKNOTS: TopknotStyle[] = ["bun", "fan", "twin", "loop"];
const BELTS: BeltPattern[] = ["plain", "stripe", "knot", "double"];

function partCounts(geometry: THREE.BufferGeometry): Map<number, number> {
  const parts = geometry.getAttribute("aPart");
  const counts = new Map<number, number>();
  for (let i = 0; i < parts.count; i++) {
    const p = parts.getX(i);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

/** Bounding box of the vertices of one part. */
function partBox(geometry: THREE.BufferGeometry, part: number): THREE.Box3 {
  const position = geometry.getAttribute("position");
  const parts = geometry.getAttribute("aPart");
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    if (parts.getX(i) === part) box.expandByPoint(v.fromBufferAttribute(position, i));
  }
  return box;
}

describe("bodyRadius", () => {
  it("matches the physics sphere at the foot and stays close to it around the belly", () => {
    expect(bodyRadius(Math.PI)).toBeCloseTo(BODY_RADIUS, 6);
    for (let theta = 1.0; theta <= Math.PI; theta += 0.05) {
      const r = bodyRadius(theta);
      expect(r).toBeGreaterThan(BODY_RADIUS * 0.97);
      expect(r).toBeLessThan(BODY_RADIUS * 1.06);
    }
  });

  it("has a head bump on top, joined without a crease", () => {
    expect(bodyRadius(0)).toBeCloseTo(HEAD_TOP_Y, 6);
    let previous = bodyRadius(0);
    for (let theta = 0.005; theta <= Math.PI; theta += 0.005) {
      const r = bodyRadius(theta);
      expect(Math.abs(r - previous)).toBeLessThan(0.02); // continuous
      previous = r;
    }
  });
});

describe("buildCharacterGeometry", () => {
  const combos = TOPKNOTS.flatMap((topknot) => BELTS.map((beltPattern) => ({ topknot, beltPattern })));

  it.each(combos)("builds a valid mesh for $topknot + $beltPattern", (style) => {
    const geometry = buildCharacterGeometry(style, 32);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const parts = geometry.getAttribute("aPart");
    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    if (!index) return;
    expect(normal.count).toBe(position.count);
    expect(parts.count).toBe(position.count);
    expect(index.count % 3).toBe(0);

    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i);
      n.fromBufferAttribute(normal, i);
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(n.length()).toBeCloseTo(1, 3);
      // The shader normalises positions: nothing may sit at the origin.
      expect(p.length()).toBeGreaterThan(0.2);
    }

    // Every triangle faces the way its vertex normals do (consistent outward winding).
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const face = new THREE.Vector3();
    const average = new THREE.Vector3();
    let flipped = 0;
    let checked = 0;
    for (let i = 0; i < index.count; i += 3) {
      const ia = index.getX(i);
      const ib = index.getX(i + 1);
      const ic = index.getX(i + 2);
      expect(Math.max(ia, ib, ic)).toBeLessThan(position.count);
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      face.subVectors(b, a).cross(c.sub(a));
      if (face.length() < 1e-9) continue; // degenerate sliver at a pole
      average
        .fromBufferAttribute(normal, ia)
        .add(n.fromBufferAttribute(normal, ib))
        .add(n.fromBufferAttribute(normal, ic));
      checked++;
      if (face.dot(average) <= 0) flipped++;
    }
    expect(checked).toBeGreaterThan(500);
    expect(flipped).toBe(0);

    // Stands on the floor: the lowest point is the foot of the physics sphere.
    expect(geometry.boundingBox?.min.y).toBeCloseTo(-BODY_RADIUS, 3);
    // Reads as the same size as the physics body (the bow may stick out a little).
    expect(geometry.boundingBox?.max.x).toBeLessThan(BODY_RADIUS + 0.12);
    expect(geometry.boundingBox?.max.z).toBeLessThan(BODY_RADIUS + 0.2);
    geometry.dispose();
  });

  it("contains body, belt, topknot and two eyes for every player style", () => {
    for (const style of PLAYER_STYLES) {
      const geometry = buildCharacterGeometry(style, 48);
      const counts = partCounts(geometry);
      for (const part of [PART.body, PART.belt, PART.hair, PART.eye]) {
        expect(counts.get(part) ?? 0).toBeGreaterThan(20);
      }
      // Eyes sit on the front of the head, one on each side.
      const eyes = partBox(geometry, PART.eye);
      expect(eyes.min.z).toBeGreaterThan(0.1);
      expect(eyes.min.x).toBeLessThan(-0.05);
      expect(eyes.max.x).toBeGreaterThan(0.05);
      expect(eyes.min.y).toBeGreaterThan(0.5);
      // The belt wraps the waist, below the equator-ish and above the foot.
      const belt = partBox(geometry, PART.belt);
      expect(belt.max.y).toBeLessThan(0.15);
      expect(belt.min.y).toBeGreaterThan(-0.5);
      expect(belt.max.x).toBeGreaterThan(BODY_RADIUS);
      // The topknot rises above the head.
      expect(partBox(geometry, PART.hair).max.y).toBeGreaterThan(HEAD_TOP_Y + 0.05);
      geometry.dispose();
    }
  });

  it("gives each topknot a clearly different silhouette", () => {
    const size = (topknot: TopknotStyle) => {
      const geometry = buildCharacterGeometry({ topknot, beltPattern: "plain" }, 32);
      const box = partBox(geometry, PART.hair);
      geometry.dispose();
      return box.getSize(new THREE.Vector3());
    };
    const bun = size("bun");
    const fan = size("fan");
    const twin = size("twin");
    const loop = size("loop");
    // Fan: a wide, low leaf. Twin: the widest pair. Loop: the tallest, thin. Bun: round.
    expect(fan.x).toBeGreaterThan(bun.x * 1.5);
    expect(fan.x).toBeGreaterThan(fan.y * 1.8);
    expect(fan.y).toBeLessThan(loop.y * 0.8);
    expect(twin.x).toBeGreaterThan(bun.x * 1.8);
    expect(loop.y).toBeGreaterThan(bun.y * 1.25);
    expect(loop.z).toBeLessThan(loop.x * 0.5);
    expect(Math.abs(bun.x - bun.z)).toBeLessThan(0.02);
  });

  it("gives each belt pattern different markings", () => {
    const build = (beltPattern: BeltPattern) => buildCharacterGeometry({ topknot: "bun", beltPattern }, 32);
    const accentBelow = (geometry: THREE.BufferGeometry) => {
      // Accent vertices on the belt (the bun's cord is an accent too, but up on the head).
      const position = geometry.getAttribute("position");
      const parts = geometry.getAttribute("aPart");
      let count = 0;
      for (let i = 0; i < position.count; i++) {
        if (parts.getX(i) === PART.accent && position.getY(i) < 0.3) count++;
      }
      return count;
    };
    const plain = build("plain");
    const stripe = build("stripe");
    const knot = build("knot");
    const double = build("double");

    expect(accentBelow(plain)).toBe(0);
    expect(accentBelow(stripe)).toBeGreaterThan(100); // the bright centre stripe
    expect(accentBelow(knot)).toBeGreaterThan(20); // the knot itself
    expect(accentBelow(double)).toBe(0);

    // The bow sticks out in front; the other belts are rotationally symmetric.
    const knotBox = partBox(knot, PART.belt);
    const plainBox = partBox(plain, PART.belt);
    expect(knotBox.max.z).toBeGreaterThan(-knotBox.min.z + 0.03);
    expect(plainBox.max.z).toBeCloseTo(-plainBox.min.z, 2);
    expect(knotBox.min.y).toBeLessThan(plainBox.min.y - 0.05); // hanging tails

    // Double: two bands with a gap of bare body between them around the belt line.
    const position = double.getAttribute("position");
    const parts = double.getAttribute("aPart");
    let inGap = 0;
    for (let i = 0; i < position.count; i++) {
      if (parts.getX(i) === PART.belt && Math.abs(position.getY(i) - -0.1) < 0.04) inGap++;
    }
    expect(inGap).toBe(0);
    const doubleBox = partBox(double, PART.belt);
    expect(doubleBox.max.y - doubleBox.min.y).toBeGreaterThan(0.3);

    for (const g of [plain, stripe, knot, double]) g.dispose();
  });

  it("scales its vertex count with the quality preset and stays light", () => {
    const counts = (["low", "medium", "high"] as const).map((level) => {
      const geometry = buildCharacterGeometry(PLAYER_STYLES[2], QUALITY_PRESETS[level].sphereSegments);
      const count = geometry.getAttribute("position").count;
      geometry.dispose();
      return count;
    });
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBeLessThan(16000);
  });
});
