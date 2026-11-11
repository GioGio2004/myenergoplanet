// Drives the instance matrices and colours of an InstancedMesh whose pieces can crack
// (warning shake) and fall away, group by group. Plain three.js, no React: components
// only ever call methods on it. Does no work at all while every group is at rest.

import * as THREE from "three";
import { hash01 } from "../../math";
import type { CrumbleItems } from "./crumbleItems";
import {
  CRUMBLE_RAND_STRIDE,
  FALL_SECONDS,
  MIN_SCALE,
  applyFall,
  createPose,
  shakeFrequency,
  writeWarnPose,
  type CrumblePose,
} from "./crumblePose";

export const CrumbleState = {
  /** At rest, untouched by `update`. */
  Solid: 0,
  /** Cracking: darkening and shaking harder and harder. */
  Warning: 1,
  /** Dropping, tumbling and shrinking away. */
  Falling: 2,
  /** Hidden until the next `reset`. */
  Gone: 3,
} as const;
export type CrumbleStateValue = (typeof CrumbleState)[keyof typeof CrumbleState];

export type CrumbleFieldOptions = {
  /** Instance colour a fully cracked piece blends toward. */
  warnColor: THREE.ColorRepresentation;
  /** Instance colour a falling piece dissolves into. */
  fadeColor: THREE.ColorRepresentation;
  /** Mixed into the per-item random numbers. */
  seed?: number;
};

/** How strongly a cracked piece takes on the warning colour at `shade` = 1. */
const WARN_COLOR_MIX = 0.85;
/** Where hidden pieces are parked (far below the island, shrunk to nothing). */
const GONE_DEPTH = 60;

// Scratch objects shared by every field: the animation never allocates.
const _pose: CrumblePose = createPose();
const _position = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _rigid = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _color = new THREE.Color();

export class CrumbleField {
  private readonly items: CrumbleItems;
  private readonly instanceMatrix: THREE.InstancedBufferAttribute;
  private readonly instanceColor: THREE.InstancedBufferAttribute;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  private readonly rand: Float32Array;

  private readonly state: Uint8Array;
  /** Seconds spent in the current state. */
  private readonly time: Float32Array;
  private readonly warnSeconds: Float32Array;
  /** 0..1 progress through the warning; frozen when the group drops. */
  private readonly level: Float32Array;
  /** Accumulated shake phase, radians. */
  private readonly phase: Float32Array;
  /** Groups currently in Warning or Falling. */
  private activeGroups = 0;

  private readonly warnR: number;
  private readonly warnG: number;
  private readonly warnB: number;
  private readonly fadeR: number;
  private readonly fadeG: number;
  private readonly fadeB: number;

  /**
   * Takes over `mesh.instanceMatrix` / `mesh.instanceColor` and writes the resting pose.
   * The mesh must have been created with `items.pieceCount` instances.
   */
  constructor(mesh: THREE.InstancedMesh, items: CrumbleItems, options: CrumbleFieldOptions) {
    if (mesh.instanceMatrix.count < items.pieceCount) {
      throw new Error("CrumbleField: the mesh has fewer instances than the items need");
    }
    this.items = items;

    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Created up front so the shader variant (USE_INSTANCING_COLOR) never changes mid-match.
    const instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(mesh.instanceMatrix.count * 3).fill(1),
      3,
    );
    instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = instanceColor;

    this.instanceMatrix = mesh.instanceMatrix;
    this.instanceColor = instanceColor;
    this.matrices = mesh.instanceMatrix.array as Float32Array;
    this.colors = instanceColor.array as Float32Array;

    const seed = options.seed ?? 1;
    this.rand = new Float32Array(items.itemCount * CRUMBLE_RAND_STRIDE);
    for (let i = 0; i < this.rand.length; i++) this.rand[i] = hash01(seed * 7919 + i);

    this.state = new Uint8Array(items.groupCount);
    this.time = new Float32Array(items.groupCount);
    this.warnSeconds = new Float32Array(items.groupCount);
    this.level = new Float32Array(items.groupCount);
    this.phase = new Float32Array(items.groupCount);

    _color.set(options.warnColor);
    this.warnR = _color.r;
    this.warnG = _color.g;
    this.warnB = _color.b;
    _color.set(options.fadeColor);
    this.fadeR = _color.r;
    this.fadeG = _color.g;
    this.fadeB = _color.b;

    this.reset();
  }

  /** True while any group is cracking or falling: only then does `update` do anything. */
  get active(): boolean {
    return this.activeGroups > 0;
  }

  get groupCount(): number {
    return this.items.groupCount;
  }

  stateOf(group: number): CrumbleStateValue {
    return this.state[group] as CrumbleStateValue;
  }

  /** Everything back to its resting place, instantly. */
  reset(): void {
    this.state.fill(CrumbleState.Solid);
    this.time.fill(0);
    this.level.fill(0);
    this.phase.fill(0);
    this.activeGroups = 0;
    for (let i = 0; i < this.items.itemCount; i++) this.writeRest(i);
    this.flush();
  }

  /** Start cracking a resting group; it shakes harder and harder over `seconds`. */
  warn(group: number, seconds: number): void {
    if (!this.isGroup(group) || this.state[group] !== CrumbleState.Solid) return;
    this.state[group] = CrumbleState.Warning;
    this.time[group] = 0;
    this.warnSeconds[group] = Math.max(seconds, 1e-3);
    this.level[group] = 0;
    this.phase[group] = 0;
    this.activeGroups++;
  }

  /** Let a group fall away (from rest or from its warning shake). */
  drop(group: number): void {
    if (!this.isGroup(group)) return;
    const state = this.state[group];
    if (state === CrumbleState.Falling || state === CrumbleState.Gone) return;
    if (state === CrumbleState.Solid) {
      this.level[group] = 0;
      this.phase[group] = 0;
      this.activeGroups++;
    }
    this.state[group] = CrumbleState.Falling;
    this.time[group] = 0;
  }

  /** Remove a group instantly, with no animation. */
  hide(group: number): void {
    if (!this.isGroup(group) || this.state[group] === CrumbleState.Gone) return;
    if (this.state[group] !== CrumbleState.Solid) this.activeGroups--;
    this.state[group] = CrumbleState.Gone;
    this.writeGroupGone(group);
    this.flush();
  }

  /** Advance the animations by `dt` (already time-scaled) seconds. */
  update(dt: number, reduceMotion: boolean): void {
    if (this.activeGroups === 0) return;
    const { groupStart, outward } = this.items;
    const rand = this.rand;

    for (let g = 0; g < this.items.groupCount; g++) {
      const state = this.state[g];
      if (state !== CrumbleState.Warning && state !== CrumbleState.Falling) continue;

      this.time[g] += dt;
      const time = this.time[g];
      if (state === CrumbleState.Warning) {
        // Keeps shaking at full strength if the drop comes later than announced.
        this.level[g] = Math.min(1, time / this.warnSeconds[g]);
      } else if (time >= FALL_SECONDS) {
        this.state[g] = CrumbleState.Gone;
        this.activeGroups--;
        this.writeGroupGone(g);
        continue;
      }
      const level = this.level[g];
      this.phase[g] += dt * shakeFrequency(level);
      const phase = this.phase[g];

      for (let i = groupStart[g]; i < groupStart[g + 1]; i++) {
        const o = i * CRUMBLE_RAND_STRIDE;
        writeWarnPose(_pose, level, phase, rand, o, reduceMotion);
        if (state === CrumbleState.Falling) {
          applyFall(_pose, time, rand, o, outward[i * 2], outward[i * 2 + 1], reduceMotion);
        }
        this.writePose(i, _pose);
      }
    }
    this.flush();
  }

  private isGroup(group: number): boolean {
    return Number.isInteger(group) && group >= 0 && group < this.items.groupCount;
  }

  private flush(): void {
    this.instanceMatrix.needsUpdate = true;
    this.instanceColor.needsUpdate = true;
  }

  private writeGroupGone(group: number): void {
    const { groupStart } = this.items;
    _pose.dx = 0;
    _pose.dy = -GONE_DEPTH;
    _pose.dz = 0;
    _pose.angle = 0;
    _pose.scale = MIN_SCALE;
    _pose.shade = 0;
    _pose.fade = 1;
    for (let i = groupStart[group]; i < groupStart[group + 1]; i++) this.writePose(i, _pose);
  }

  /** Resting pose: each piece's local matrix moved to the item's pivot, base colour. */
  private writeRest(item: number): void {
    const { pieceStart, pieceLocal, pivot, color } = this.items;
    const px = pivot[item * 3];
    const py = pivot[item * 3 + 1];
    const pz = pivot[item * 3 + 2];
    const r = color[item * 3];
    const g = color[item * 3 + 1];
    const b = color[item * 3 + 2];
    for (let p = pieceStart[item]; p < pieceStart[item + 1]; p++) {
      const m = p * 16;
      for (let k = 0; k < 16; k++) this.matrices[m + k] = pieceLocal[m + k];
      this.matrices[m + 12] += px;
      this.matrices[m + 13] += py;
      this.matrices[m + 14] += pz;
      this.colors[p * 3] = r;
      this.colors[p * 3 + 1] = g;
      this.colors[p * 3 + 2] = b;
    }
  }

  /** Every piece of the item moved rigidly (about the pivot) by `pose`. */
  private writePose(item: number, pose: CrumblePose): void {
    const { pieceStart, pieceLocal, pivot, axis, color } = this.items;
    const i3 = item * 3;

    _position.set(pivot[i3] + pose.dx, pivot[i3 + 1] + pose.dy, pivot[i3 + 2] + pose.dz);
    _axis.set(axis[i3], axis[i3 + 1], axis[i3 + 2]);
    _quaternion.setFromAxisAngle(_axis, pose.angle);
    _scale.setScalar(pose.scale);
    _rigid.compose(_position, _quaternion, _scale);

    // base → cracked → dissolved, in linear space.
    const shade = pose.shade * WARN_COLOR_MIX;
    let r = color[i3] + (this.warnR - color[i3]) * shade;
    let g = color[i3 + 1] + (this.warnG - color[i3 + 1]) * shade;
    let b = color[i3 + 2] + (this.warnB - color[i3 + 2]) * shade;
    r += (this.fadeR - r) * pose.fade;
    g += (this.fadeG - g) * pose.fade;
    b += (this.fadeB - b) * pose.fade;

    for (let p = pieceStart[item]; p < pieceStart[item + 1]; p++) {
      _local.fromArray(pieceLocal, p * 16);
      _world.multiplyMatrices(_rigid, _local);
      _world.toArray(this.matrices, p * 16);
      this.colors[p * 3] = r;
      this.colors[p * 3 + 1] = g;
      this.colors[p * 3 + 2] = b;
    }
  }
}
