// ─────────────────────────────────────────────────────────────────────────────
// Liquid Sumo — the physics driver.
//
// Framework-free glue between the shared runtime, the match rules and the Rapier
// bodies. <PhysicsWorld/> owns the React side (mounting <Physics>, the floor and one
// body per wrestler) and calls `update()` from its single useFrame; everything that
// happens inside a simulation step lives here, in this order:
//
//   sync floor radius
//   per wrestler: park / place / sample input → dash, brace, steering
//   world step
//   read bodies back into the runtime records (position, velocity, grounded, edge, landing)
//   wrestler-vs-wrestler contacts and impacts
//   ring-outs
//   match.step
//   place wrestlers the rules just (re)spawned
//
// Nothing in here allocates per step; the only objects created are game events, which
// are rare (a dash, a hit, a landing).
// ─────────────────────────────────────────────────────────────────────────────

import type { RapierCollider, RapierRigidBody } from "@react-three/rapier";
import { spawnPoint } from "../config";
import { dampAngle, inputToWorld, type Vec2 } from "../math";
import type { GameRuntime } from "../runtime";
import type { MatchController, PlayerInput, PlayerSlot, WrestlerRuntime } from "../types";
import {
  ACTION_BRACE_OFF,
  ACTION_BRACE_ON,
  ACTION_DASH_STARTED,
  applyDeadzone,
  dashDragFactor,
  headingToCentre,
  isGrounded,
  pairCount,
  pairIndex,
  resetActions,
  resolveImpact,
  steerDeltaV,
  steeringControl,
  stepActions,
  substepCount,
  substepDt,
  wrapAngle,
  type ImpactInput,
  type ImpactOutput,
  type Stick,
} from "./movement";

// ── collision groups ─────────────────────────────────────────────────────────
// Rapier packs a pair of 16-bit masks into one number: memberships << 16 | filter.
// Two colliders interact when each one's memberships intersect the other's filter.

const GROUP_FLOOR = 1 << 0;
const GROUP_WRESTLER = 1 << 1;

/** The island: collides with everything. */
export const FLOOR_GROUPS = ((GROUP_FLOOR << 16) | 0xffff) >>> 0;
/** A wrestler in play: collides with the island and with other wrestlers. */
export const WRESTLER_GROUPS = ((GROUP_WRESTLER << 16) | GROUP_FLOOR | GROUP_WRESTLER) >>> 0;
/** An invulnerable wrestler: still stands on the island, passes through other wrestlers. */
export const GHOST_GROUPS = ((GROUP_WRESTLER << 16) | GROUP_FLOOR) >>> 0;

// ── driver-local tuning ──────────────────────────────────────────────────────

/** Longest real frame the simulation will try to catch up on (seconds). */
const MAX_FRAME_SECONDS = 0.1;
/** Two wrestlers closer than their diameters plus this are touching. */
const TOUCH_EPSILON = 0.03;
/** Facing settles on the stick direction in about this long (seconds) … */
const FACING_STICK_SMOOTH = 0.09;
/** … and on the direction of travel, when the stick is idle, in about this long. */
const FACING_DRIFT_SMOOTH = 0.2;
/** Below this horizontal speed an idle-stick wrestler keeps its heading. */
const FACING_DRIFT_MIN_SPEED = 0.8;
/** A landing slower than this (units/s) is not worth an event. */
const LAND_MIN_SPEED = 1.2;
/** A brace survives being off the ground for this long (hits pop wrestlers up a little). */
const BRACE_COYOTE_SECONDS = 0.14;
/** A body this far below the kill plane that nobody respawned is put back by force. */
const LOST_BODY_DEPTH = 40;

export type StepWorld = (dt: number) => void;

export interface PhysicsDriver {
  /** Register (or with `null`, forget) the Rapier body of a slot. Safe to call repeatedly. */
  attachBody(slot: PlayerSlot, body: RapierRigidBody | null): void;
  /** Register (or forget) the island's cylinder collider; its radius follows `runtime.arenaRadius`. */
  attachFloor(collider: RapierCollider | null): void;
  /**
   * Advance the game by one rendered frame. `realDelta` is the unscaled frame time,
   * `stepWorld(h)` must advance the Rapier world by exactly one step of `h` seconds.
   */
  update(realDelta: number, stepWorld: StepWorld): void;
  /**
   * Bring the records in line with the wrestlers' statuses without advancing time:
   * writes the lobby preview poses and performs pending teleports for attached bodies.
   */
  settle(): void;
}

/** Everything the driver remembers about one slot between steps. */
type SlotState = {
  /** The runtime record this state belongs to (records are replaced by `setPlayers`). */
  record: WrestlerRuntime | null;
  /** The body the physical flags below describe (bodies are recreated on remount). */
  body: RapierRigidBody | null;
  /** Body is in this step's simulation. */
  active: boolean;
  /** Mirrors of what has been applied to the body, so setters are only called on change. */
  enabled: boolean;
  ghost: boolean;
  braced: boolean;
  /** Linear damping currently set on the body (NaN = unknown, set it). */
  damping: number;
  /** `ActionMemory`: dash button state on the previous step. */
  dashHeld: boolean;
  /** The current dash started this step. */
  dashStarted: boolean;
  /** The current dash has not hit anything yet (its ease-out drag still applies). */
  dashClean: boolean;
  /** Seconds since the body last stood on the island. */
  airTime: number;
  wasGrounded: boolean;
  /** Vertical velocity after the previous step (the impact speed when it lands). */
  prevVy: number;
  ringOutReported: boolean;
  /** Velocity going into this step's solve. */
  preVx: number;
  preVy: number;
  preVz: number;
  /** Cached lobby preview spot, recomputed only when index / count change. */
  previewIndex: number;
  previewCount: number;
  previewX: number;
  previewZ: number;
};

function createSlotState(): SlotState {
  return {
    record: null,
    body: null,
    active: false,
    enabled: true,
    ghost: false,
    braced: false,
    damping: Number.NaN,
    dashHeld: false,
    dashStarted: false,
    dashClean: false,
    airTime: 0,
    wasGrounded: false,
    prevVy: 0,
    ringOutReported: false,
    preVx: 0,
    preVy: 0,
    preVz: 0,
    previewIndex: -1,
    previewCount: -1,
    previewX: 0,
    previewZ: 0,
  };
}

function isFiniteVec(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

export function createPhysicsDriver(runtime: GameRuntime, match: MatchController): PhysicsDriver {
  const config = runtime.config;
  const tuning = config.wrestler;
  const arena = config.arena;
  const slotCount = config.maxPlayers;
  const dashSpeed = tuning.maxSpeed * tuning.dash.speedMultiplier;
  const touchDistance = tuning.radius * 2 + TOUCH_EPSILON;
  const braceExtraMass = tuning.mass * (tuning.brace.massMultiplier - 1);

  const bodies: (RapierRigidBody | null)[] = [];
  const slots: SlotState[] = [];
  for (let i = 0; i < slotCount; i++) {
    bodies.push(null);
    slots.push(createSlotState());
  }

  const pairs = pairCount(slotCount);
  const pairTouching: boolean[] = [];
  const pairCooldown: number[] = [];
  for (let i = 0; i < pairs; i++) {
    pairTouching.push(false);
    pairCooldown.push(0);
  }

  let floor: RapierCollider | null = null;
  let floorRadius = Number.NaN;

  // Scratch objects, reused forever.
  const input: PlayerInput = { x: 0, y: 0, dash: false, brace: false };
  const stick: Stick = { x: 0, y: 0 };
  const worldStick: Vec2 = { x: 0, z: 0 };
  const steer: Vec2 = { x: 0, z: 0 };
  const vec = { x: 0, y: 0, z: 0 };
  const upright = { x: 0, y: 0, z: 0, w: 1 };
  const impactIn: ImpactInput = {
    nx: 0,
    ny: 0,
    nz: 0,
    approach: 0,
    closing: 0,
    massA: 1,
    massB: 1,
    aDashing: false,
    aBracing: false,
    bDashing: false,
    bBracing: false,
  };
  const impactOut: ImpactOutput = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, strength: 0 };

  // ── body helpers ───────────────────────────────────────────────────────────

  /** The live body of a slot, or null while it is mounting / after it was removed. */
  function bodyOf(slot: number): RapierRigidBody | null {
    const body = bodies[slot];
    if (body === null) return null;
    if (!body.isValid()) {
      bodies[slot] = null;
      return null;
    }
    return body;
  }

  function setVelocity(body: RapierRigidBody, x: number, y: number, z: number): void {
    vec.x = x;
    vec.y = y;
    vec.z = z;
    body.setLinvel(vec, true);
  }

  function setPose(body: RapierRigidBody, x: number, y: number, z: number): void {
    vec.x = x;
    vec.y = y;
    vec.z = z;
    body.setTranslation(vec, true);
    // Rotations are locked, but a body that went non-finite needs every part of its
    // state rewritten before the solver will touch it again.
    body.setRotation(upright, true);
    vec.x = 0;
    vec.y = 0;
    vec.z = 0;
    body.setAngvel(vec, true);
    body.resetForces(true);
    body.resetTorques(true);
  }

  function setEnabled(st: SlotState, body: RapierRigidBody, enabled: boolean): void {
    if (st.enabled === enabled) return;
    body.setEnabled(enabled);
    st.enabled = enabled;
  }

  /**
   * Brace makes the body heavier: total mass becomes `mass × massMultiplier`.
   * Rapier applies the change at the start of the next world step, i.e. in the very step
   * this is called for. (`recomputeMassPropertiesFromColliders()` is deliberately not
   * used: on a body that was just re-enabled it would compute a mass of zero, because
   * the colliders only come back with the next step.)
   */
  function setBraced(st: SlotState, body: RapierRigidBody, braced: boolean): void {
    if (st.braced === braced) return;
    body.setAdditionalMass(braced ? braceExtraMass : 0, true);
    st.braced = braced;
  }

  /**
   * Damping is a ground effect: heavy while braced, the ordinary slide otherwise, and
   * none at all in the air (Rapier damps every axis, and falling must feel free).
   */
  function dampingFor(w: WrestlerRuntime): number {
    if (w.bracing) return tuning.brace.linearDamping;
    return w.grounded ? tuning.linearDamping : 0;
  }

  function setDamping(st: SlotState, body: RapierRigidBody, damping: number): void {
    if (st.damping === damping) return;
    body.setLinearDamping(damping);
    st.damping = damping;
  }

  /** Invulnerable wrestlers stop colliding with other wrestlers but keep standing on the island. */
  function setGhost(st: SlotState, body: RapierRigidBody, ghost: boolean): void {
    if (st.ghost === ghost || body.numColliders() === 0) return;
    body.collider(0).setCollisionGroups(ghost ? GHOST_GROUPS : WRESTLER_GROUPS);
    st.ghost = ghost;
  }

  function forgetPairs(slot: number): void {
    for (let other = 0; other < slotCount; other++) {
      if (other !== slot) pairTouching[pairIndex(slot, other, slotCount)] = false;
    }
  }

  /** Drop any dash / brace in progress and all cooldowns; tells listeners a brace ended. */
  function clearActions(w: WrestlerRuntime, st: SlotState): void {
    const wasBracing = w.bracing;
    resetActions(w, st);
    st.dashStarted = false;
    st.dashClean = false;
    if (wasBracing) runtime.emit({ type: "brace", slot: w.slot, on: false });
  }

  function resetMotionMemory(st: SlotState): void {
    st.airTime = BRACE_COYOTE_SECONDS + 1;
    st.wasGrounded = false;
    st.prevVy = 0;
    st.ringOutReported = false;
  }

  /** Perform a teleport requested by the rules: place the body, at rest, facing the centre. */
  function place(w: WrestlerRuntime, st: SlotState, body: RapierRigidBody): void {
    const x = Number.isFinite(w.spawnX) ? w.spawnX : 0;
    const y = Number.isFinite(w.spawnY) ? w.spawnY : arena.respawnDropHeight;
    const z = Number.isFinite(w.spawnZ) ? w.spawnZ : 0;
    setEnabled(st, body, true);
    setPose(body, x, y, z);
    setVelocity(body, 0, 0, 0);
    w.teleport = false;
    w.x = x;
    w.y = y;
    w.z = z;
    w.vx = 0;
    w.vy = 0;
    w.vz = 0;
    w.grounded = false;
    w.onEdge = false;
    w.facing = headingToCentre(x, z, w.facing);
    clearActions(w, st);
    resetMotionMemory(st);
    forgetPairs(w.slot);
  }

  /**
   * An alive wrestler whose body is new (remount, hot reload) or was force-disabled:
   * put the body back where the record says the wrestler is, or failing that drop it
   * on its spawn point.
   */
  function reseat(w: WrestlerRuntime, st: SlotState, body: RapierRigidBody, index: number, count: number): void {
    setEnabled(st, body, true);
    if (isFiniteVec(w.x, w.y, w.z) && w.y > arena.killY) {
      setPose(body, w.x, w.y, w.z);
      if (!isFiniteVec(w.vx, w.vy, w.vz)) {
        w.vx = 0;
        w.vy = 0;
        w.vz = 0;
      }
      setVelocity(body, w.vx, w.vy, w.vz);
      st.ringOutReported = false;
    } else {
      cachePreview(st, index, count);
      w.spawnX = st.previewX;
      w.spawnY = arena.respawnDropHeight;
      w.spawnZ = st.previewZ;
      place(w, st, body);
    }
  }

  /** `spawnPoint` allocates, so its result is cached per slot until the roster changes. */
  function cachePreview(st: SlotState, index: number, count: number): void {
    if (st.previewIndex === index && st.previewCount === count) return;
    const p = spawnPoint(index, count);
    st.previewIndex = index;
    st.previewCount = count;
    st.previewX = p.x;
    st.previewZ = p.z;
  }

  /**
   * Bring one wrestler's body in line with its status: park idle / knocked-out bodies,
   * perform pending teleports, re-seat recreated bodies.
   * Returns the body when the wrestler takes part in the simulation, else null.
   */
  function syncWrestler(w: WrestlerRuntime, index: number, count: number): RapierRigidBody | null {
    const st = slots[w.slot];
    const body = bodyOf(w.slot);

    if (st.record !== w) {
      // A fresh record (new roster): nothing remembered about the old one applies.
      st.record = w;
      st.dashHeld = false;
      st.dashStarted = false;
      st.dashClean = false;
      resetMotionMemory(st);
      forgetPairs(w.slot);
    }
    let fresh = false;
    if (st.body !== body) {
      // A body this state has not seen before: one r3r just (re)created, or an existing
      // one taken over by a new driver (hot reload). Read what can be read from it and
      // reset the rest, so the mirrors below never lie.
      st.body = body;
      st.enabled = true;
      st.ghost = false;
      st.braced = false;
      st.damping = Number.NaN;
      if (body !== null) {
        fresh = true;
        st.enabled = body.isEnabled();
        st.ghost = body.numColliders() > 0 && body.collider(0).collisionGroups() === GHOST_GROUPS;
        // Besides clearing a brace left by a previous driver, this flags the body's mass
        // as dirty, which makes the next step pick up the collider mass r3r sets in an
        // effect after creating the collider (a live body ignores that otherwise).
        body.setAdditionalMass(0, true);
      }
    }

    if (w.status !== "alive") {
      if (body !== null && st.enabled) {
        setVelocity(body, 0, 0, 0);
        setEnabled(st, body, false);
      }
      if (w.dashing || w.bracing || w.dashCooldownLeft > 0 || w.braceCooldownLeft > 0 || st.dashHeld) {
        clearActions(w, st);
      }
      w.grounded = false;
      w.onEdge = false;
      if (w.status === "idle") {
        // Lobby preview: stand on the spawn point, looking at the centre.
        cachePreview(st, index, count);
        w.x = st.previewX;
        w.y = tuning.radius;
        w.z = st.previewZ;
        w.vx = 0;
        w.vy = 0;
        w.vz = 0;
        w.facing = headingToCentre(st.previewX, st.previewZ, w.facing);
        w.grounded = true;
      }
      // "out": the record keeps the position where the wrestler went out.
      return null;
    }

    // Alive, but the body is still mounting: a pending teleport simply stays pending.
    if (body === null) return null;

    if (w.teleport) place(w, st, body);
    else if (fresh || !st.enabled) reseat(w, st, body, index, count);
    return body;
  }

  // ── one wrestler, before the world step ────────────────────────────────────

  /**
   * Fill the `input` scratch with this step's controller sample for a wrestler, or
   * with neutral input when the rules do not let it move (intro, countdown, results).
   */
  function sampleInput(w: WrestlerRuntime, h: number): PlayerInput {
    // Sources may write only some fields, so start from neutral every time.
    input.x = 0;
    input.y = 0;
    input.dash = false;
    input.brace = false;
    const source = runtime.inputs[w.slot];
    if (source && match.canControl(w.slot)) {
      source.sample(input, w.slot, runtime, h);
      if (!Number.isFinite(input.x)) input.x = 0;
      if (!Number.isFinite(input.y)) input.y = 0;
    }
    return input;
  }

  function drive(w: WrestlerRuntime, st: SlotState, body: RapierRigidBody, h: number): void {
    const sample = sampleInput(w, h);
    const tilt = applyDeadzone(sample.x, sample.y, tuning.deadzone, stick);
    inputToWorld(stick.x, stick.y, runtime.cameraYaw, worldStick);

    // Dash / brace state machine.
    const canBrace = st.airTime <= BRACE_COYOTE_SECONDS;
    const flags = stepActions(w, st, sample.dash === true, sample.brace === true, canBrace, h, tuning);
    if (flags & ACTION_BRACE_ON) runtime.emit({ type: "brace", slot: w.slot, on: true });
    if (flags & ACTION_BRACE_OFF) runtime.emit({ type: "brace", slot: w.slot, on: false });

    const damping = dampingFor(w);
    let vx = w.vx;
    let vz = w.vz;
    let changed = false;

    st.dashStarted = (flags & ACTION_DASH_STARTED) !== 0;
    if (st.dashStarted) {
      // Lunge along the stick, or straight ahead when the stick is idle.
      let dirX = Math.sin(w.facing);
      let dirZ = Math.cos(w.facing);
      if (tilt > 0) {
        dirX = worldStick.x / tilt;
        dirZ = worldStick.z / tilt;
      }
      vx = dirX * dashSpeed;
      vz = dirZ * dashSpeed;
      changed = true;
      w.facing = Math.atan2(dirX, dirZ);
      st.dashClean = true;
      runtime.emit({ type: "dash", slot: w.slot, dirX, dirZ });
    } else if (w.dashing && st.dashClean) {
      // Ease the lunge out so it is back at walking speed when the dash ends.
      const drag = dashDragFactor(tuning.dash, damping, h);
      vx *= drag;
      vz *= drag;
      changed = true;
    }

    // Steering (a braced wrestler is rooted).
    if (!w.bracing && tilt > 0) {
      steerDeltaV(vx, vz, worldStick.x, worldStick.z, tuning, steeringControl(w.grounded, w.dashing), h, steer);
      if (steer.x !== 0 || steer.z !== 0) {
        vx += steer.x;
        vz += steer.z;
        changed = true;
      }
    }

    // Facing: the stick when it is used, else the direction of travel.
    if (!w.dashing && !w.bracing) {
      if (tilt > 0) {
        w.facing = wrapAngle(dampAngle(w.facing, Math.atan2(worldStick.x, worldStick.z), FACING_STICK_SMOOTH, h));
      } else if (vx * vx + vz * vz > FACING_DRIFT_MIN_SPEED * FACING_DRIFT_MIN_SPEED) {
        w.facing = wrapAngle(dampAngle(w.facing, Math.atan2(vx, vz), FACING_DRIFT_SMOOTH, h));
      }
    }

    // Bring the body in line with the logical state.
    setBraced(st, body, w.bracing);
    setDamping(st, body, damping);
    setGhost(st, body, runtime.isInvulnerable(w));
    if (changed) {
      w.vx = vx;
      w.vz = vz;
      setVelocity(body, vx, w.vy, vz);
    }
    st.preVx = w.vx;
    st.preVy = w.vy;
    st.preVz = w.vz;
  }

  // ── one wrestler, after the world step ─────────────────────────────────────

  function readBack(w: WrestlerRuntime, st: SlotState, body: RapierRigidBody, h: number): void {
    // Each getter allocates one small object inside Rapier; call each exactly once.
    const t = body.translation();
    const v = body.linvel();
    if (!isFiniteVec(t.x, t.y, t.z) || !isFiniteVec(v.x, v.y, v.z)) {
      // The solver blew up for this body. Take it out of the world and treat it as a
      // ring-out; the rules respawn it (or `reseat` does on the next step).
      setPose(body, 0, arena.killY - LOST_BODY_DEPTH, 0);
      setVelocity(body, 0, 0, 0);
      setEnabled(st, body, false);
      st.active = false;
      w.vx = 0;
      w.vy = 0;
      w.vz = 0;
      w.grounded = false;
      w.onEdge = false;
      if (!isFiniteVec(w.x, w.y, w.z)) {
        w.x = 0;
        w.y = arena.killY - 1;
        w.z = 0;
      }
      forgetPairs(w.slot);
      if (!st.ringOutReported) {
        st.ringOutReported = true;
        match.reportRingOut(w.slot);
      }
      return;
    }

    w.x = t.x;
    w.y = t.y;
    w.z = t.z;
    w.vx = v.x;
    w.vy = v.y;
    w.vz = v.z;

    const radial = Math.sqrt(w.x * w.x + w.z * w.z);
    const grounded = isGrounded(w.y, w.vy, radial, runtime.arenaRadius, tuning.radius);
    const landingSpeed = -st.prevVy;
    const landed = grounded && !st.wasGrounded && landingSpeed >= LAND_MIN_SPEED;
    w.grounded = grounded;
    w.onEdge = grounded && radial >= runtime.arenaRadius - arena.edgeWarningDistance;
    st.airTime = grounded ? 0 : st.airTime + h;
    st.wasGrounded = grounded;
    st.prevVy = w.vy;
    if (landed) runtime.emit({ type: "land", slot: w.slot, x: w.x, z: w.z, speed: landingSpeed });
  }

  // ── wrestler vs wrestler ───────────────────────────────────────────────────

  /** In this step's contact scan: simulated, placed, and able to push / be pushed. */
  function canTouch(w: WrestlerRuntime): boolean {
    return w.status === "alive" && slots[w.slot].active && !w.teleport && !runtime.isInvulnerable(w);
  }

  function massOf(w: WrestlerRuntime): number {
    return w.bracing ? tuning.mass * tuning.brace.massMultiplier : tuning.mass;
  }

  function scanContacts(h: number): void {
    for (let p = 0; p < pairs; p++) {
      if (pairCooldown[p] > 0) pairCooldown[p] = Math.max(0, pairCooldown[p] - h);
    }

    const ws = runtime.wrestlers;
    const count = ws.length;
    for (let i = 0; i < count; i++) {
      const a = ws[i];
      const aTouchable = canTouch(a);
      for (let j = i + 1; j < count; j++) {
        const b = ws[j];
        const p = pairIndex(a.slot, b.slot, slotCount);
        if (!aTouchable || !canTouch(b)) {
          pairTouching[p] = false;
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > touchDistance * touchDistance) {
          pairTouching[p] = false;
          continue;
        }

        match.reportContact(a.slot, b.slot);

        const sa = slots[a.slot];
        const sb = slots[b.slot];
        // A fresh impact: they just came together, or one of them dashed from point-blank.
        const fresh = !pairTouching[p] || sa.dashStarted || sb.dashStarted;
        pairTouching[p] = true;
        if (!fresh || pairCooldown[p] > 0) continue;

        // Contact normal from A to B (any direction will do if the centres coincide).
        const dist = Math.sqrt(distSq);
        let nx = 1;
        let ny = 0;
        let nz = 0;
        if (dist > 1e-5) {
          nx = dx / dist;
          ny = dy / dist;
          nz = dz / dist;
        }
        const approach = (sa.preVx - sb.preVx) * nx + (sa.preVy - sb.preVy) * ny + (sa.preVz - sb.preVz) * nz;
        if (approach < tuning.hit.minImpactSpeed) continue;

        const bodyA = sa.body;
        const bodyB = sb.body;
        if (bodyA === null || bodyB === null) continue;

        impactIn.nx = nx;
        impactIn.ny = ny;
        impactIn.nz = nz;
        impactIn.approach = approach;
        impactIn.closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
        impactIn.massA = massOf(a);
        impactIn.massB = massOf(b);
        impactIn.aDashing = a.dashing;
        impactIn.aBracing = a.bracing;
        impactIn.bDashing = b.dashing;
        impactIn.bBracing = b.bracing;
        resolveImpact(impactIn, tuning, impactOut);

        a.vx += impactOut.ax;
        a.vy += impactOut.ay;
        a.vz += impactOut.az;
        b.vx += impactOut.bx;
        b.vy += impactOut.by;
        b.vz += impactOut.bz;
        setVelocity(bodyA, a.vx, a.vy, a.vz);
        setVelocity(bodyB, b.vx, b.vy, b.vz);

        // The collision now owns both velocities: stop shaping any dash in progress.
        sa.dashClean = false;
        sb.dashClean = false;
        pairCooldown[p] = tuning.hit.pairCooldownSeconds;

        runtime.emit({
          type: "hit",
          a: a.slot,
          b: b.slot,
          strength: impactOut.strength,
          x: (a.x + b.x) * 0.5,
          y: (a.y + b.y) * 0.5,
          z: (a.z + b.z) * 0.5,
          dash: a.dashing || b.dashing,
          braced: a.bracing || b.bracing,
        });
      }
    }
  }

  // ── stepping ───────────────────────────────────────────────────────────────

  function syncFloor(): void {
    if (floor === null) return;
    if (!floor.isValid()) {
      floor = null;
      return;
    }
    const radius = runtime.arenaRadius;
    if (radius !== floorRadius && radius > 0 && Number.isFinite(radius)) {
      floor.setRadius(radius);
      floorRadius = radius;
    }
  }

  /** Park, place and re-seat every wrestler according to its current status. */
  function syncAll(): void {
    const ws = runtime.wrestlers;
    const count = ws.length;
    for (let i = 0; i < count; i++) {
      const w = ws[i];
      slots[w.slot].active = syncWrestler(w, i, count) !== null;
    }
  }

  function substep(h: number, stepWorld: StepWorld): void {
    syncFloor();

    // 1. Status, input, dash / brace, steering.
    let ws = runtime.wrestlers;
    let count = ws.length;
    for (let i = 0; i < count; i++) {
      const w = ws[i];
      const st = slots[w.slot];
      const body = syncWrestler(w, i, count);
      st.active = body !== null;
      if (body !== null) drive(w, st, body, h);
    }

    // 2. The world.
    stepWorld(h);

    // 3. Bodies → runtime records.
    for (let i = 0; i < count; i++) {
      const w = ws[i];
      const st = slots[w.slot];
      if (st.active && st.body !== null) readBack(w, st, st.body, h);
    }

    // 4. Touches and impacts.
    scanContacts(h);

    // 5. Ring-outs.
    ws = runtime.wrestlers;
    count = ws.length;
    for (let i = 0; i < count; i++) {
      const w = ws[i];
      const st = slots[w.slot];
      if (w.status !== "alive" || !st.active || w.teleport || w.y >= arena.killY) continue;
      if (!st.ringOutReported) {
        st.ringOutReported = true;
        match.reportRingOut(w.slot);
      } else if (w.y < arena.killY - LOST_BODY_DEPTH && st.body !== null) {
        // Reported, yet still alive and still falling: nobody respawned it. Take the
        // body out; `reseat` drops it back on its spawn point on the next step.
        setVelocity(st.body, 0, 0, 0);
        setEnabled(st, st.body, false);
      }
    }

    // 6. Rules.
    match.step(h);

    // 7. Whatever the rules (re)spawned or parked this step is placed before rendering.
    syncAll();
  }

  function settle(): void {
    syncFloor();
    syncAll();
  }

  return {
    settle,

    attachBody(slot, body) {
      if (slot >= 0 && slot < slotCount) bodies[slot] = body;
    },

    attachFloor(collider) {
      floor = collider;
      floorRadius = Number.NaN;
    },

    update(realDelta, stepWorld) {
      const real = realDelta > 0 && Number.isFinite(realDelta) ? Math.min(realDelta, MAX_FRAME_SECONDS) : 0;
      const scaled = runtime.advanceReal(real);
      const steps = substepCount(scaled, config.sim.hz, config.sim.maxStepsPerFrame);
      if (steps === 0) {
        // Time is frozen, but the lobby preview and pending teleports must still be valid.
        settle();
        return;
      }
      const h = substepDt(scaled, steps, config.sim.hz);
      for (let i = 0; i < steps; i++) substep(h, stepWorld);
    },
  };
}
