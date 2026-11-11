import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { gameConfig } from "../../config";
import { FALL_SECONDS } from "./crumblePose";
import { fillTileColors } from "./palette";
import { buildRockArrays, createRockGeometry } from "./rockGeometry";
import { createBaleGeometry } from "./ropeGeometry";
import { ROPE_INSET, RopeRingRig, baleCountFor, buildRopeItems } from "./ropeRig";
import { DirtTilesRig } from "./tilesRig";

const { arena } = gameConfig;
const [firstStep, secondStep] = arena.crumble.steps;

function settle(rig: { update(dt: number, reduceMotion: boolean): void }, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) rig.update(1 / 60, false);
}

/** Highest point any vertex of any instance reaches. */
function highestPoint(mesh: THREE.InstancedMesh): number {
  const position = mesh.geometry.attributes.position;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let top = -Infinity;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    for (let k = 0; k < position.count; k++) {
      v.fromBufferAttribute(position, k).applyMatrix4(m);
      top = Math.max(top, v.y);
    }
  }
  return top;
}

describe("DirtTilesRig", () => {
  it("is one instanced mesh whose top surface is the physics floor (y = 0)", () => {
    const rig = new DirtTilesRig();
    expect(rig.mesh.isInstancedMesh).toBe(true);
    expect(rig.mesh.frustumCulled).toBe(false);
    expect(rig.mesh.receiveShadow).toBe(true);
    expect(rig.mesh.count).toBeGreaterThan(rig.layout.tiles.length);
    expect(highestPoint(rig.mesh)).toBeLessThanOrEqual(1e-6);
    expect(highestPoint(rig.mesh)).toBeGreaterThan(-0.03);
    expect(rig.active).toBe(false);
    rig.dispose();
  });

  it("cracks and drops exactly the rings outside each crumble step", () => {
    const rig = new DirtTilesRig();
    rig.warn(firstStep.radius, arena.crumble.warnSeconds);
    expect(rig.active).toBe(true);
    settle(rig, arena.crumble.warnSeconds);
    for (let ring = 0; ring < 6; ring++) expect(rig.ringStanding(ring)).toBe(true);
    // The shake never lifts a tile noticeably above the floor.
    expect(highestPoint(rig.mesh)).toBeLessThan(0.02);

    rig.crumble(firstStep.radius);
    expect(rig.ringStanding(5)).toBe(false);
    expect(rig.ringStanding(4)).toBe(true);
    settle(rig, FALL_SECONDS + 0.1);
    expect(rig.active).toBe(false);

    rig.warn(secondStep.radius, arena.crumble.warnSeconds);
    settle(rig, arena.crumble.warnSeconds);
    rig.crumble(secondStep.radius);
    expect(rig.ringStanding(4)).toBe(false);
    expect(rig.ringStanding(3)).toBe(true);
    settle(rig, FALL_SECONDS + 0.1);
    expect(rig.active).toBe(false);

    // What is left is the radius-4 island, still flat at y = 0.
    expect(highestPoint(rig.mesh)).toBeLessThanOrEqual(1e-6);
    expect(highestPoint(rig.mesh)).toBeGreaterThan(-0.03);

    rig.reset();
    for (let ring = 0; ring < 6; ring++) expect(rig.ringStanding(ring)).toBe(true);
    rig.dispose();
  });

  it("can start from an already shrunken island", () => {
    const rig = new DirtTilesRig();
    rig.syncTo(secondStep.radius);
    expect(rig.active).toBe(false);
    expect(rig.ringStanding(3)).toBe(true);
    expect(rig.ringStanding(4)).toBe(false);
    expect(rig.ringStanding(5)).toBe(false);
    rig.syncTo(arena.radius);
    expect(rig.ringStanding(5)).toBe(true);
    rig.dispose();
  });

  it("paints warm mid-tone earth with subtle variation", () => {
    const rig = new DirtTilesRig();
    const colors = fillTileColors(rig.layout, new Float32Array(rig.layout.tiles.length * 3));
    const color = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    let minL = 1;
    let maxL = 0;
    for (let i = 0; i < rig.layout.tiles.length; i++) {
      color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
      color.getHSL(hsl, THREE.SRGBColorSpace);
      // Orange-brown hues only, never saturated enough to compete with the wrestlers.
      expect(hsl.h * 360).toBeGreaterThan(20);
      expect(hsl.h * 360).toBeLessThan(42);
      expect(hsl.s).toBeLessThan(0.4);
      minL = Math.min(minL, hsl.l);
      maxL = Math.max(maxL, hsl.l);
    }
    expect(minL).toBeGreaterThan(0.45);
    expect(maxL).toBeLessThan(0.68);
    expect(maxL - minL).toBeGreaterThan(0.04);
    rig.dispose();
  });
});

describe("RopeRingRig", () => {
  it("lays bales end to end around the ring, low on the ground", () => {
    const rig = new RopeRingRig({ lowDetail: false, castShadow: true });
    expect(rig.radius).toBeCloseTo(arena.radius - ROPE_INSET);
    const count = baleCountFor(rig.radius);
    expect(rig.mesh.count).toBe(count);
    expect(rig.mesh.castShadow).toBe(true);

    const items = buildRopeItems(rig.radius, count);
    const m = new THREE.Matrix4();
    const x = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const px = items.pivot[i * 3];
      const pz = items.pivot[i * 3 + 2];
      expect(Math.hypot(px, pz)).toBeCloseTo(rig.radius, 4);
      // The bale's long axis (local X) lies along the ring, not across it.
      m.fromArray(items.pieceLocal, i * 16);
      x.setFromMatrixColumn(m, 0).normalize();
      const radial = (x.x * px + x.z * pz) / rig.radius;
      expect(Math.abs(radial)).toBeLessThan(0.05);
      expect(Math.abs(x.y)).toBeLessThan(1e-6);
      expect(m.determinant()).toBeGreaterThan(0);
    }
    // Low enough that a wrestler's body hides most of it when standing on the rope.
    expect(highestPoint(rig.mesh)).toBeLessThan(0.22);
    expect(highestPoint(rig.mesh)).toBeGreaterThan(0.12);
    rig.dispose();
  });

  it("falls with the first crumble and stays gone", () => {
    const rig = new RopeRingRig({ lowDetail: true, castShadow: false });
    rig.warn(arena.radius, 2); // nothing shrinks: no reaction
    expect(rig.active).toBe(false);
    rig.warn(firstStep.radius, 2);
    expect(rig.active).toBe(true);
    rig.crumble(firstStep.radius);
    settle(rig, FALL_SECONDS + 0.1);
    expect(rig.active).toBe(false);
    expect(highestPoint(rig.mesh)).toBeLessThan(-10);

    // Later crumbles: there is simply no rope.
    rig.warn(secondStep.radius, 2);
    rig.crumble(secondStep.radius);
    expect(rig.active).toBe(false);

    rig.reset();
    expect(highestPoint(rig.mesh)).toBeGreaterThan(0.1);
    rig.syncTo(firstStep.radius);
    expect(highestPoint(rig.mesh)).toBeLessThan(-10);
    rig.dispose();
  });

  it("builds a bale with matching attributes at both detail levels", () => {
    for (const lowDetail of [false, true]) {
      const bale = createBaleGeometry({ length: 1.1, radius: 0.13, lowDetail });
      expect(bale.index).not.toBeNull();
      const count = bale.attributes.position.count;
      expect(bale.attributes.normal.count).toBe(count);
      expect(bale.attributes.color.count).toBe(count);
      expect(bale.attributes.uv).toBeUndefined();
      bale.computeBoundingBox();
      const box = bale.boundingBox!;
      // Lies along X, about as long as asked, a little fatter than the bare radius.
      expect(box.max.x - box.min.x).toBeCloseTo(1.1, 1);
      expect(box.max.y).toBeLessThan(0.17);
      expect(box.max.y).toBeGreaterThan(0.13);
      expect(bale.index!.count / 3).toBeLessThan(lowDetail ? 260 : 480);
      bale.dispose();
    }
  });
});

describe("island rock", () => {
  const options = { topY: -0.5, maxRadius: 3.85, depth: 7.2, lowDetail: false };

  it("hangs below the slab and stays under the smallest island", () => {
    const { positions, colors } = buildRockArrays(options);
    expect(positions.length % 9).toBe(0);
    expect(colors).toHaveLength(positions.length);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    for (let i = 0; i < positions.length; i += 3) {
      expect(Number.isFinite(positions[i] + positions[i + 1] + positions[i + 2])).toBe(true);
      maxR = Math.max(maxR, Math.hypot(positions[i], positions[i + 2]));
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
    }
    const smallest = Math.min(...arena.crumble.steps.map((s) => s.radius));
    expect(maxR).toBeLessThanOrEqual(options.maxRadius + 1e-4);
    expect(maxR).toBeLessThan(smallest);
    expect(maxR).toBeGreaterThan(3);
    // Nothing pokes up through the dirt floor.
    expect(maxY).toBeLessThan(-arena.slabThickness * 0.5);
    expect(minY).toBeCloseTo(options.topY - options.depth, 5);
  });

  it("is made of closed lumps whose facets all face outward", () => {
    const { positions, parts } = buildRockArrays(options);
    // Main body, three stalactites, four shards.
    expect(parts).toHaveLength(8);
    let covered = 0;
    for (const part of parts) {
      expect(part.firstTriangle).toBe(covered);
      covered += part.triangleCount;

      // Every lump is (nearly) convex, so each facet must face away from its centroid.
      const first = part.firstTriangle * 9;
      const end = first + part.triangleCount * 9;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let o = first; o < end; o += 3) {
        cx += positions[o];
        cy += positions[o + 1];
        cz += positions[o + 2];
      }
      const vertices = part.triangleCount * 3;
      cx /= vertices;
      cy /= vertices;
      cz /= vertices;

      let outward = 0;
      for (let o = first; o < end; o += 9) {
        const ax = positions[o];
        const ay = positions[o + 1];
        const az = positions[o + 2];
        const e1x = positions[o + 3] - ax;
        const e1y = positions[o + 4] - ay;
        const e1z = positions[o + 5] - az;
        const e2x = positions[o + 6] - ax;
        const e2y = positions[o + 7] - ay;
        const e2z = positions[o + 8] - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const midX = (ax + positions[o + 3] + positions[o + 6]) / 3;
        const midY = (ay + positions[o + 4] + positions[o + 7]) / 3;
        const midZ = (az + positions[o + 5] + positions[o + 8]) / 3;
        if (nx * (midX - cx) + ny * (midY - cy) + nz * (midZ - cz) > 0) outward++;
      }
      expect(outward / part.triangleCount).toBeGreaterThan(0.95);
    }
    expect(covered).toBe(positions.length / 9);
  });

  it("fades from lit earth near the top to dark ink blue at the tip", () => {
    const { positions, colors } = buildRockArrays(options);
    const sum = { upper: [0, 0, 0], lower: [0, 0, 0] };
    const n = { upper: 0, lower: 0 };
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      const band = y > -3.5 && y < -2 ? "upper" : y < -6 ? "lower" : null;
      if (!band) continue;
      sum[band][0] += colors[i];
      sum[band][1] += colors[i + 1];
      sum[band][2] += colors[i + 2];
      n[band]++;
    }
    expect(n.upper).toBeGreaterThan(0);
    expect(n.lower).toBeGreaterThan(0);
    // Earth: red dominates. Tip: blue dominates.
    expect(sum.upper[0]).toBeGreaterThan(sum.upper[2]);
    expect(sum.lower[2]).toBeGreaterThan(sum.lower[0] * 2);
  });

  it("builds a flat-shaded geometry at both detail levels", () => {
    const high = createRockGeometry(options);
    const low = createRockGeometry({ ...options, lowDetail: true });
    expect(high.index).toBeNull();
    expect(high.attributes.normal.count).toBe(high.attributes.position.count);
    expect(low.attributes.position.count).toBeLessThan(high.attributes.position.count);
    expect(high.attributes.position.count / 3).toBeLessThan(500);
    high.dispose();
    low.dispose();
  });
});
