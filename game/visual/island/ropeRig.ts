// The tawara: a ring of half-buried straw bales marking the edge of the dohyo.
// ONE InstancedMesh; the whole rope is a single crumble group that cracks and
// drops (bale by bale) together with the outermost ring of tiles.

import * as THREE from "three";
import { gameConfig } from "../../config";
import { hash01 } from "../../math";
import { CrumbleField } from "./crumbleField";
import { createCrumbleItems, type CrumbleItems } from "./crumbleItems";
import { ISLAND_COLORS } from "./palette";
import { createBaleGeometry } from "./ropeGeometry";

const TAU = Math.PI * 2;

/** The rope's centre line sits this far inside the island's edge. */
export const ROPE_INSET = 0.35;
const BALE_RADIUS = 0.13;
/** Target tip-to-tip length of a bale, and the gap between neighbours. */
const BALE_LENGTH = 1.12;
const BALE_GAP = 0.05;
/** Height of the bale's axis: mostly above ground, its belly pressed into the clay. */
const BALE_Y = 0.035;

export type RopeRigOptions = {
  /** Island radius at the start of a match. */
  arenaRadius?: number;
  lowDetail: boolean;
  castShadow: boolean;
};

const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _zero = new THREE.Vector3();

/** Number of bales that fit around a circle of `radius`. */
export function baleCountFor(radius: number): number {
  return Math.max(6, Math.round((TAU * radius) / (BALE_LENGTH + BALE_GAP)));
}

/** One item (and one instance) per bale, all in group 0. */
export function buildRopeItems(radius: number, count: number): CrumbleItems {
  const items = createCrumbleItems(count, count, 1);
  items.groupStart[0] = 0;
  items.groupStart[1] = count;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);

    items.pieceStart[i] = i;
    items.pivot[i * 3] = sin * radius;
    items.pivot[i * 3 + 1] = BALE_Y + (hash01(i * 9 + 401) - 0.5) * 0.016;
    items.pivot[i * 3 + 2] = cos * radius;

    // Tumble about the bale's own tangent-ish axis, drift outward.
    let ax = cos + (hash01(i * 9 + 402) - 0.5) * 0.8;
    let ay = (hash01(i * 9 + 403) - 0.5) * 0.8;
    let az = -sin + (hash01(i * 9 + 404) - 0.5) * 0.8;
    const inv = 1 / Math.hypot(ax, ay, az);
    ax *= inv;
    ay *= inv;
    az *= inv;
    items.axis[i * 3] = ax;
    items.axis[i * 3 + 1] = ay;
    items.axis[i * 3 + 2] = az;
    items.outward[i * 2] = sin;
    items.outward[i * 2 + 1] = cos;

    // The bale geometry lies along X; a turn of `angle` about Y lays it along the
    // tangent. Hand-laid: each one rolled differently and a touch out of line.
    const yaw = angle + (hash01(i * 9 + 405) - 0.5) * 0.05;
    const roll = hash01(i * 9 + 406) * TAU;
    _quaternion.setFromEuler(_euler.set(roll, yaw, 0, "YXZ"));
    _scale.set(0.97 + hash01(i * 9 + 407) * 0.06, 1, 1);
    _matrix.compose(_zero, _quaternion, _scale);
    _matrix.toArray(items.pieceLocal, i * 16);

    // Instance tint multiplies the straw colours: sun-bleached to slightly damp.
    const value = 0.88 + hash01(i * 9 + 408) * 0.16;
    items.color[i * 3] = value;
    items.color[i * 3 + 1] = value * 0.985;
    items.color[i * 3 + 2] = value * 0.95;
  }
  items.pieceStart[count] = count;
  return items;
}

export class RopeRingRig {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Radius of the rope's centre line. */
  readonly radius: number;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly field: CrumbleField;

  constructor({ arenaRadius = gameConfig.arena.radius, lowDetail, castShadow }: RopeRigOptions) {
    this.radius = arenaRadius - ROPE_INSET;
    const count = baleCountFor(this.radius);
    const length = (TAU * this.radius) / count - BALE_GAP;
    const items = buildRopeItems(this.radius, count);

    this.geometry = createBaleGeometry({ length, radius: BALE_RADIUS, lowDetail });
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0,
      vertexColors: true,
    });

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    mesh.name = "island-rope-ring";
    mesh.frustumCulled = false; // falling bales leave the (never refreshed) bounds
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; // stays at the identity
    this.mesh = mesh;

    this.field = new CrumbleField(mesh, items, {
      warnColor: ISLAND_COLORS.ropeCracked,
      fadeColor: ISLAND_COLORS.ropeDissolve,
      seed: 23,
    });
  }

  /** True while the rope is shaking or falling. */
  get active(): boolean {
    return this.field.active;
  }

  /** The ground under the rope is about to go: it starts shaking with the tiles. */
  warn(radius: number, seconds: number): void {
    if (radius < this.radius) this.field.warn(0, seconds);
  }

  /** The island shrank to `radius`: if that takes the rope's ground away, it falls. */
  crumble(radius: number): void {
    if (radius < this.radius) this.field.drop(0);
  }

  /** A fresh match: the rope is whole again, instantly. */
  reset(): void {
    this.field.reset();
  }

  /** Match the rope to a walkable radius with no animation (mounting mid-match). */
  syncTo(radius: number): void {
    this.field.reset();
    if (radius < this.radius) this.field.hide(0);
  }

  update(dt: number, reduceMotion: boolean): void {
    this.field.update(dt, reduceMotion);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
