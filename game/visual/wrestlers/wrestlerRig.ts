// ─────────────────────────────────────────────────────────────────────────────
// Everything one wrestler draws, as plain three.js objects driven imperatively:
//   body   — the merged liquid character mesh (1 draw call + 1 in the shadow pass)
//   marker — the ground ring (+ blob shadow when real shadows are off)
//   tag    — the name sprite
// The React layer only mounts `root`, forwards events and calls `update` per frame.
// Nothing here touches the physics; it reads the shared WrestlerRuntime record.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import type { PlayerStyle } from "../../config";
import { clamp, damp } from "../../math";
import type { GameRuntime } from "../../runtime";
import type { GameEventOf, WrestlerRuntime } from "../../types";
import { buildCharacterGeometry } from "./characterGeometry";
import {
  BODY_RADIUS,
  createPose,
  kickBrace,
  kickDash,
  kickHit,
  kickLand,
  resetPose,
  smoothstep,
  stepPose,
  type Pose,
} from "./deform";
import { GroundMarker } from "./groundMarker";
import { createLiquid, type Liquid } from "./liquidMaterial";
import { NameTag } from "./nameTag";

export type WrestlerRigOptions = {
  /** Width segments of the body (the quality preset's `sphereSegments`). */
  segments: number;
  /** Real shadow maps are on: cast them. Otherwise draw a cheap blob shadow. */
  shadows: boolean;
};

/** A body parked below this height (the lobby's off-stage spot) is not drawn. */
const PARKED_BELOW_Y = -20;
/** Gap between the top of the topknot and the tip of the name tag. */
const TAG_GAP = 0.2;
/** Camera distance at which the tag has its nominal size. */
const TAG_REFERENCE_DISTANCE = 15;
/** The ring keeps this much opacity high in the air, to show where the drop will land. */
const MARKER_AIR_ALPHA = 0.3;
const BLOB_SHADOW_ALPHA = 0.36;

export class WrestlerRig {
  /** Mount this (e.g. `<primitive object={rig.root} />`). */
  readonly root = new THREE.Group();

  private readonly pivot = new THREE.Group();
  private readonly body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private readonly liquid: Liquid;
  private readonly marker: GroundMarker;
  private readonly tag: NameTag;
  private readonly pose: Pose;
  private readonly blobShadow: boolean;
  /** Rest height of the top of the topknot above the body centre. */
  private readonly topRest: number;
  private tagY = 0;
  private shown = false;
  private name: string | null = null;

  constructor(style: PlayerStyle, slot: number, options: WrestlerRigOptions) {
    this.blobShadow = !options.shadows;
    this.pose = createPose(slot + 1);
    this.liquid = createLiquid(style, (slot + 1) * 3.71);

    const geometry = buildCharacterGeometry(style, options.segments);
    this.topRest = geometry.boundingBox ? geometry.boundingBox.max.y : 1;

    this.body = new THREE.Mesh(geometry, this.liquid.material);
    this.body.name = `wrestler-body-${slot}`;
    this.body.customDepthMaterial = this.liquid.depthMaterial;
    this.body.customDistanceMaterial = this.liquid.distanceMaterial;
    this.body.castShadow = options.shadows;
    this.body.receiveShadow = options.shadows;
    // The shader moves vertices well outside the rest bounds (stretch, sway, wobble).
    this.body.frustumCulled = false;
    // After the ground decals (-2), before every other transparent object (0): with
    // depth writes on, the rest of the scene sorts against the body as if it were opaque.
    this.body.renderOrder = -1;

    this.marker = new GroundMarker(style);
    this.tag = new NameTag(style);

    this.pivot.add(this.body);
    this.root.name = `wrestler-${slot}`;
    this.root.add(this.pivot, this.marker.mesh, this.tag.sprite);
    this.root.visible = false;
  }

  setName(name: string): void {
    this.name = name;
    this.tag.setName(name);
  }

  /** Forget all motion: after a teleport, a respawn, or when the record is replaced. */
  reset(): void {
    resetPose(this.pose);
    this.shown = false;
  }

  // ── events ─────────────────────────────────────────────────────────────────

  /** `w` is this rig's wrestler, `other` the one it collided with (if still known). */
  onHit(
    e: GameEventOf<"hit">,
    w: WrestlerRuntime,
    other: WrestlerRuntime | undefined,
    reduceMotion: boolean,
  ): void {
    // Normal = from the contact point into this body; fall back to "away from the other".
    let nx = w.x - e.x;
    let ny = w.y - e.y;
    let nz = w.z - e.z;
    if (Math.hypot(nx, ny, nz) < 0.05 && other) {
      nx = w.x - other.x;
      ny = w.y - other.y;
      nz = w.z - other.z;
    }
    kickHit(this.pose, nx, ny, nz, e.strength, w.bracing, reduceMotion);
  }

  onLand(e: GameEventOf<"land">, reduceMotion: boolean): void {
    kickLand(this.pose, e.speed, reduceMotion);
  }

  onDash(reduceMotion: boolean): void {
    kickDash(this.pose, reduceMotion);
  }

  onBrace(e: GameEventOf<"brace">, reduceMotion: boolean): void {
    kickBrace(this.pose, e.on, reduceMotion);
  }

  // ── per frame ──────────────────────────────────────────────────────────────

  /**
   * Sync every visual with the wrestler's record. `dt` is the scaled, clamped frame
   * delta. Allocation-free.
   */
  update(
    w: WrestlerRuntime,
    runtime: GameRuntime,
    camera: THREE.Camera,
    dt: number,
    reduceMotion: boolean,
  ): void {
    const visible = w.status !== "out" && w.y > PARKED_BELOW_Y;
    if (!visible) {
      if (this.root.visible) {
        this.root.visible = false;
        this.reset();
      }
      return;
    }
    this.root.visible = true;
    // Catches a name edited in place on the record (no roster change, no re-render).
    if (w.name !== this.name) this.setName(w.name);

    const pose = this.pose;
    const invulnerable = w.status === "alive" && runtime.isInvulnerable(w);
    stepPose(pose, w, invulnerable, dt, reduceMotion);

    // ── body ────────────────────────────────────────────────────────────────
    this.pivot.position.set(w.x, w.y, w.z);
    this.pivot.rotation.set(0, pose.facing, 0);

    const u = this.liquid.uniforms;
    u.uTime.value = pose.time;
    u.uAmp.value = pose.amp;
    u.uSway.value.set(pose.swayLocalX, pose.swayLocalZ);
    u.uDeform.value.fromArray(pose.deform);
    u.uShift.value = pose.shift;
    u.uRim.value = pose.rim;
    u.uBeltGlow.value = pose.beltGlow;
    u.uFlash.value = pose.flash;
    this.liquid.material.opacity = pose.opacity;

    // ── ground marker (and blob shadow) ─────────────────────────────────────
    // Height of the foot above the island top: 0 standing, >0 airborne, <0 sunk past the edge.
    const lift = w.y - BODY_RADIUS;
    const sunk = smoothstep(-0.9, -0.15, lift);
    const airborne = smoothstep(0.2, 2.6, lift);
    const markerAlpha = (1 - (1 - MARKER_AIR_ALPHA) * airborne) * sunk;
    let shadowAlpha = 0;
    let shadowRadius = 0.7;
    if (this.blobShadow) {
      const high = clamp(lift, 0, 6);
      shadowAlpha = BLOB_SHADOW_ALPHA * (1 - smoothstep(0, 6, high)) * sunk;
      shadowRadius = 0.78 * pose.width * (1 + 0.1 * high);
    }
    this.marker.set(
      w.x,
      w.z,
      pose.facing,
      markerAlpha,
      pose.brace,
      pose.pulse,
      shadowAlpha,
      shadowRadius,
      runtime.arenaRadius,
    );

    // ── name tag ────────────────────────────────────────────────────────────
    // Follows the head, but eased so the text stays steady through squashes.
    const tagTarget = w.y + pose.shift + pose.height * this.topRest + TAG_GAP;
    this.tagY = this.shown ? damp(this.tagY, tagTarget, 0.07, dt) : tagTarget;
    const cx = camera.position.x - w.x;
    const cy = camera.position.y - this.tagY;
    const cz = camera.position.z - w.z;
    // Roughly constant on-screen size across the camera's zoom range.
    const zoom = clamp(Math.hypot(cx, cy, cz) / TAG_REFERENCE_DISTANCE, 0.8, 1.7);
    this.tag.place(w.x, this.tagY, w.z, zoom);

    this.shown = true;
  }

  /**
   * Free GPU resources. three's dispose leaves the objects usable (they re-upload on
   * the next render), so this is safe under StrictMode's effect replay.
   */
  dispose(): void {
    this.body.geometry.dispose();
    this.liquid.dispose();
    this.marker.dispose();
    this.tag.dispose();
  }
}
