import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CrumbleField, CrumbleState } from "./crumbleField";
import { createCrumbleItems } from "./crumbleItems";
import { FALL_SECONDS, MIN_SCALE } from "./crumblePose";

/** Two groups: group 0 has one single-piece item, group 1 has two items of two pieces each. */
function setup() {
  const items = createCrumbleItems(3, 5, 2);
  items.groupStart.set([0, 1, 3]);
  items.pieceStart.set([0, 1, 3, 5]);
  for (let i = 0; i < 3; i++) {
    items.pivot.set([i * 2, -0.3, i], i * 3);
    items.axis.set([1, 0, 0], i * 3);
    items.outward.set([0, 1], i * 2);
    items.color.set([0.8, 0.6, 0.4], i * 3);
  }
  const m = new THREE.Matrix4();
  for (let p = 0; p < 5; p++) {
    m.makeScale(1 + p, 1, 1).setPosition(0.1 * p, 0, 0);
    m.toArray(items.pieceLocal, p * 16);
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 5);
  const field = new CrumbleField(mesh, items, { warnColor: "#000000", fadeColor: "#0000ff" });
  return { items, mesh, field };
}

function snapshot(mesh: THREE.InstancedMesh) {
  return {
    matrices: Array.from(mesh.instanceMatrix.array),
    colors: Array.from(mesh.instanceColor!.array),
  };
}

function scaleOf(mesh: THREE.InstancedMesh, piece: number): number {
  const a = mesh.instanceMatrix.array;
  const o = piece * 16;
  return Math.hypot(a[o + 4], a[o + 5], a[o + 6]); // length of the Y column
}

describe("CrumbleField", () => {
  it("writes the resting pose on creation", () => {
    const { mesh, field } = setup();
    expect(field.active).toBe(false);
    expect(mesh.instanceColor).not.toBeNull();
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(4, m);
    const position = new THREE.Vector3().setFromMatrixPosition(m);
    // Piece 4 belongs to item 2: pivot (4, -0.3, 2) + local offset (0.4, 0, 0).
    expect(position.x).toBeCloseTo(4.4);
    expect(position.y).toBeCloseTo(-0.3);
    expect(position.z).toBeCloseTo(2);
    expect(m.elements[0]).toBeCloseTo(5);
    const color = new THREE.Color();
    mesh.getColorAt(4, color);
    expect(color.r).toBeCloseTo(0.8);
    expect(color.b).toBeCloseTo(0.4);
  });

  it("does nothing while every group is at rest", () => {
    const { mesh, field } = setup();
    const version = mesh.instanceMatrix.version;
    const before = snapshot(mesh);
    field.update(0.5, false);
    expect(mesh.instanceMatrix.version).toBe(version);
    expect(snapshot(mesh)).toEqual(before);
  });

  it("shakes and darkens only the warned group", () => {
    const { mesh, field } = setup();
    const rest = snapshot(mesh);
    field.warn(1, 2);
    expect(field.active).toBe(true);
    expect(field.stateOf(0)).toBe(CrumbleState.Solid);
    expect(field.stateOf(1)).toBe(CrumbleState.Warning);
    for (let i = 0; i < 60; i++) field.update(1 / 60, false);
    const now = snapshot(mesh);
    // Group 0 = piece 0: untouched.
    expect(now.matrices.slice(0, 16)).toEqual(rest.matrices.slice(0, 16));
    expect(now.colors.slice(0, 3)).toEqual(rest.colors.slice(0, 3));
    // Group 1 = pieces 1..4: moved a little and darker.
    expect(now.matrices.slice(16)).not.toEqual(rest.matrices.slice(16));
    for (let p = 1; p < 5; p++) {
      expect(now.colors[p * 3]).toBeLessThan(rest.colors[p * 3]);
      expect(Math.abs(now.matrices[p * 16 + 12] - rest.matrices[p * 16 + 12])).toBeLessThan(0.1);
      expect(scaleOf(mesh, p)).toBeCloseTo(1);
    }
    // Pieces of one item share the item's colour.
    expect(now.colors.slice(3, 6)).toEqual(now.colors.slice(6, 9));
  });

  it("keeps shaking at full strength if the drop is late", () => {
    const { field } = setup();
    field.warn(0, 0.5);
    for (let i = 0; i < 120; i++) field.update(1 / 60, false);
    expect(field.stateOf(0)).toBe(CrumbleState.Warning);
    expect(field.active).toBe(true);
  });

  it("drops a group, then parks it out of sight and goes idle", () => {
    const { mesh, field } = setup();
    field.warn(1, 1);
    for (let i = 0; i < 60; i++) field.update(1 / 60, false);
    field.drop(1);
    expect(field.stateOf(1)).toBe(CrumbleState.Falling);

    for (let i = 0; i < 40; i++) field.update(1 / 60, false);
    // Mid-fall: below its resting height, still visible.
    expect(mesh.instanceMatrix.array[1 * 16 + 13]).toBeLessThan(-0.5);
    expect(field.active).toBe(true);

    const frames = Math.ceil(FALL_SECONDS * 60) + 2;
    for (let i = 0; i < frames; i++) field.update(1 / 60, false);
    expect(field.stateOf(1)).toBe(CrumbleState.Gone);
    expect(field.active).toBe(false);
    for (let p = 1; p < 5; p++) {
      expect(scaleOf(mesh, p)).toBeLessThanOrEqual(MIN_SCALE * 1.01);
      expect(mesh.instanceMatrix.array[p * 16 + 13]).toBeLessThan(-10);
    }
    // The other group never moved.
    expect(scaleOf(mesh, 0)).toBeCloseTo(1);
    expect(mesh.instanceMatrix.array[13]).toBeCloseTo(-0.3);

    // Finished: no more work.
    const version = mesh.instanceMatrix.version;
    field.update(0.1, false);
    expect(mesh.instanceMatrix.version).toBe(version);
  });

  it("can drop without a warning, and ignores repeats", () => {
    const { field } = setup();
    field.drop(0);
    field.drop(0);
    field.warn(0, 1); // too late: already falling
    expect(field.stateOf(0)).toBe(CrumbleState.Falling);
    for (let i = 0; i < 200; i++) field.update(1 / 60, true);
    expect(field.stateOf(0)).toBe(CrumbleState.Gone);
    expect(field.active).toBe(false);
    field.drop(0);
    field.warn(0, 1);
    expect(field.stateOf(0)).toBe(CrumbleState.Gone);
    expect(field.active).toBe(false);
  });

  it("hides a group instantly", () => {
    const { mesh, field } = setup();
    field.warn(1, 1);
    field.hide(1);
    expect(field.stateOf(1)).toBe(CrumbleState.Gone);
    expect(field.active).toBe(false);
    expect(scaleOf(mesh, 3)).toBeLessThanOrEqual(MIN_SCALE * 1.01);
    field.hide(1);
    expect(field.active).toBe(false);
  });

  it("restores everything exactly on reset", () => {
    const { mesh, field } = setup();
    const rest = snapshot(mesh);
    field.warn(0, 1);
    field.drop(1);
    for (let i = 0; i < 30; i++) field.update(1 / 60, false);
    expect(snapshot(mesh)).not.toEqual(rest);
    field.reset();
    expect(field.active).toBe(false);
    expect(field.stateOf(0)).toBe(CrumbleState.Solid);
    expect(field.stateOf(1)).toBe(CrumbleState.Solid);
    expect(snapshot(mesh)).toEqual(rest);
  });

  it("ignores groups that do not exist", () => {
    const { field } = setup();
    field.warn(7, 1);
    field.drop(-1);
    field.hide(2.5);
    expect(field.active).toBe(false);
  });

  it("never writes NaN", () => {
    const { mesh, field } = setup();
    field.warn(0, 0);
    field.drop(1);
    for (let i = 0; i < 300; i++) {
      field.update(i % 7 === 0 ? 0 : 1 / 50, i % 2 === 0);
      if (i === 100) field.drop(0);
    }
    for (const v of mesh.instanceMatrix.array) expect(Number.isFinite(v)).toBe(true);
    for (const v of mesh.instanceColor!.array) expect(Number.isFinite(v)).toBe(true);
  });
});
