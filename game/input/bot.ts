// A computer-controlled wrestler.
//
// The bot plays fair: it reads only what a human can see on the screen (positions,
// velocities, who is dashing / bracing / flashing invulnerable, the island's edge and
// the match clock) and answers through the same stick + two buttons as everybody else.
//
// It thinks in WORLD space and converts to the screen-relative stick at the very end
// with `worldToInput`, the exact inverse of `inputToWorld`.
//
// Priorities, highest first:
//   1. survive  — never steer off the island; brake when sliding toward the edge
//   2. brace    — root itself when somebody dashes at it from close by
//   3. attack   — get on the island-centre side of the nearest opponent, shove it
//                 toward the edge, dash when lined up
//   4. wander   — nobody to fight: circle slowly around the centre
// Imperfection (reaction delay, aim noise, hesitation, a thinner safety margin) grows
// as `skill` drops. All randomness comes from a seeded PRNG, so a bot is reproducible.

import { gameConfig } from "../config";
import { angleDelta, clamp, lerp } from "../math";
import type { GameRuntime } from "../runtime";
import type { InputSource, PlayerInput, PlayerSlot, WrestlerRuntime } from "../types";

export type BotOptions = {
  /** 0 (clumsy) .. 1 (sharp). Default 0.6. */
  skill?: number;
  /** PRNG seed. Defaults to the slot the bot plays. */
  seed?: number;
};

type Stick = Pick<PlayerInput, "x" | "y">;

/**
 * Convert a world-space XZ direction into the screen-relative stick that produces it:
 * the exact inverse of `inputToWorld` (that matrix is its own inverse).
 * Magnitude is preserved. Writes into `out` and returns it.
 */
export function worldToInput<T extends Stick>(worldX: number, worldZ: number, cameraYaw: number, out: T): T {
  const s = Math.sin(cameraYaw);
  const c = Math.cos(cameraYaw);
  out.x = c * worldX - s * worldZ;
  out.y = -s * worldX - c * worldZ;
  return out;
}

// ── tuning ───────────────────────────────────────────────────────────────────

const WRESTLER = gameConfig.wrestler;
const BODY_RADIUS = WRESTLER.radius;
const MAX_SPEED = WRESTLER.maxSpeed;
const DEADZONE = WRESTLER.deadzone;
const DASH_SPEED = MAX_SPEED * WRESTLER.dash.speedMultiplier;
const CRUMBLE_STEPS = gameConfig.arena.crumble.steps;

const DEFAULT_SKILL = 0.6;

/** How far ahead (seconds) the bot extrapolates its own slide when judging the edge. */
const LOOKAHEAD = 0.35;
/** Once retreating, keep retreating until this far back inside the safe radius. */
const RETREAT_HYSTERESIS = 0.3;
/** Velocity error (units/s) that maps to a full stick deflection. */
const STEER_GAIN = 2.2;
/** Asking for a bit more than the speed cap keeps the stick pinned while charging. */
const CHARGE_SPEED = MAX_SPEED * 1.3;

/** Only switch target when the newcomer is at least this much closer. */
const TARGET_HYSTERESIS = 1;
/** Where to line up: this far from the target, on the island-centre side. */
const STANDOFF = BODY_RADIUS * 2 + 0.3;
/** Sideways error (units) under which the bot stops lining up and charges. */
const CHARGE_LATERAL = 0.7;
/** How wide to swing around a target when caught on its edge side. */
const WRAP_RADIUS = 1.5;
/** Targets closer than this to the centre have no meaningful "nearest edge". */
const CENTRE_RADIUS = 0.4;

/** Dash from this far when a miss would still end on the island… */
const DASH_RANGE_SAFE = 3.4;
/** …and only from this close (too late to dodge) when a miss would not. */
const DASH_RANGE_RISKY = 2.3;
/**
 * How far a dash that hits nothing carries the bot before it can stop: the lunge
 * itself (coasting under the normal damping) plus braking, with the stick alone, from
 * the speed it ends at. Deliberately pessimistic: a miss must never be fatal.
 */
const DASH_COAST =
  (DASH_SPEED * (1 - Math.exp(-WRESTLER.linearDamping * WRESTLER.dash.durationSeconds))) / WRESTLER.linearDamping;
const DASH_EXIT_SPEED = DASH_SPEED * Math.exp(-WRESTLER.linearDamping * WRESTLER.dash.durationSeconds);
const DASH_MISS_TRAVEL = DASH_COAST + (DASH_EXIT_SPEED * DASH_EXIT_SPEED) / (2 * WRESTLER.moveAcceleration);
/** How far past the point of contact a dash that connects still carries the bot. */
const DASH_HIT_OVERSHOOT = 1.4;
/** A dash must be predicted to end at least this far inside the edge. */
const DASH_EDGE_MARGIN = 0.35;
/** The hit must push the target at least this much outward (cosine). */
const DASH_PUSH_MIN = 0.2;
/** Hold the button this long / this many samples; the simulation only needs the edge. */
const DASH_HOLD_SECONDS = 0.08;
const DASH_HOLD_STEPS = 3;
/** Own lock-out after a press, independent of the simulation's cooldown. */
const DASH_LOCK_SECONDS = 0.5;

/** An opponent dashing at the bot from within this range is a threat. */
const BRACE_RANGE = 3.2;
/** How squarely (cosine) the dasher must be heading at the bot. */
const BRACE_ALIGN = 0.8;
/** Outward slide speed above which rooting stops the bot faster than counter-steering. */
const BRAKE_ENTER_SPEED = 6.5;
const BRAKE_EXIT_SPEED = 3.3;
const BRAKE_HOLD_SECONDS = 0.4;

/** Back in play: this long before the first decision. */
const RESPAWN_THINK_DELAY = 0.15;

const WANDER_RADIUS = 1.6;
const WANDER_RATE = 0.6;
const WANDER_SPEED = 2.2;

/**
 * The radius the bot treats as the island's edge: the walkable radius, or the radius
 * the island is about to shrink to once the clock says those tiles are cracking.
 */
export function botArenaRadius(runtime: GameRuntime): number {
  let radius = runtime.arenaRadius;
  for (let i = 0; i < CRUMBLE_STEPS.length; i++) {
    const step = CRUMBLE_STEPS[i];
    if (runtime.secondsLeft <= step.at && step.radius < radius) radius = step.radius;
  }
  return radius;
}

function sanitiseSkill(skill: number | undefined): number {
  if (skill === undefined || !Number.isFinite(skill)) return DEFAULT_SKILL;
  return clamp(skill, 0, 1);
}

/** Clearly off the ground (dropping in, popped up, or falling off): input is pointless. */
function isAirborne(me: WrestlerRuntime, distFromCentre: number, arenaRadius: number): boolean {
  if (me.y < BODY_RADIUS - 0.3) return true;
  if (me.grounded) return false;
  return me.y > BODY_RADIUS + 0.3 || distFromCentre > arenaRadius;
}

/** Worth chasing: in play, can be pushed, and still standing on the island. */
function isTargetable(other: WrestlerRuntime, runtime: GameRuntime): boolean {
  if (other.status !== "alive" || runtime.isInvulnerable(other)) return false;
  if (other.y < BODY_RADIUS - 0.5) return false;
  return Math.hypot(other.x, other.z) < runtime.arenaRadius + 0.3;
}

class BotSource implements InputSource {
  private readonly skill: number;
  private readonly seedOption: number | undefined;

  // PRNG (mulberry32), seeded on the first live sample because the default seed is the slot.
  private seeded = false;
  private rngState = 0;

  // Decisions, refreshed every `thinkInterval()` seconds of simulated time.
  private thinkLeft = 0;
  private targetSlot = -1;
  /** Radians of error added to wherever the bot means to go. */
  private aimNoise = 0;
  /** Which way to swing around a target when on its wrong side. */
  private orbitSide = 1;
  private hesitateLeft = 0;
  private wanderAngle = 0;
  private wanderDir = 1;

  // Survival.
  private retreating = false;
  /** Rolled once per retreat: will the bot think of rooting itself to stop a slide? */
  private brakeAllowed = false;
  private brakeHoldLeft = 0;

  // Dash.
  private dashHoldLeft = 0;
  private dashHoldSteps = 0;
  private dashLockLeft = 0;
  private dashDirX = 0;
  private dashDirZ = 1;

  // Brace reaction.
  private threatSlot = -1;
  private braceArmed = false;
  private braceReactLeft = 0;
  private braceHoldLeft = 0;

  // Scratch for the steering helpers (desired world velocity / rotated stick).
  private wantX = 0;
  private wantZ = 0;

  constructor(options: BotOptions | undefined) {
    this.skill = sanitiseSkill(options?.skill);
    this.seedOption = options?.seed;
  }

  sample(out: PlayerInput, slot: PlayerSlot, runtime: GameRuntime, dt: number): void {
    out.x = 0;
    out.y = 0;
    out.dash = false;
    out.brace = false;

    const me = runtime.wrestler(slot);
    const inPlay = runtime.phase === "playing" || runtime.phase === "suddenDeath";
    if (!me || me.status !== "alive" || !inPlay) {
      this.resetTransient();
      return;
    }
    if (!this.seeded) this.seed(this.seedOption ?? slot);

    const step = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.thinkLeft -= step;
    this.hesitateLeft -= step;
    this.dashHoldLeft -= step;
    this.dashLockLeft -= step;
    this.braceHoldLeft -= step;
    this.brakeHoldLeft -= step;
    if (this.dashHoldSteps > 0) this.dashHoldSteps--;

    const dist = Math.hypot(me.x, me.z);
    if (isAirborne(me, dist, runtime.arenaRadius)) {
      // Nothing to do until it lands (or is knocked out): let go of everything.
      this.releaseButtons();
      return;
    }

    const edgeRadius = botArenaRadius(runtime);
    // A sharper bot keeps a wider berth from the edge.
    const safeRadius = edgeRadius - (0.75 + 0.3 * this.skill);

    // Lose a target the moment it stops being one; picking the next waits for a think.
    let target = this.targetSlot >= 0 ? runtime.wrestler(this.targetSlot) : undefined;
    if (target && !isTargetable(target, runtime)) {
      target = undefined;
      this.targetSlot = -1;
    }

    // ── 1. survive ─────────────────────────────────────────────────────────
    const aheadX = me.x + me.vx * LOOKAHEAD;
    const aheadZ = me.z + me.vz * LOOKAHEAD;
    const reach = Math.max(dist, Math.hypot(aheadX, aheadZ));
    const wasRetreating = this.retreating;
    this.retreating = reach > (wasRetreating ? safeRadius - RETREAT_HYSTERESIS : safeRadius);
    if (this.retreating && !wasRetreating) {
      this.brakeAllowed = this.random() < 0.2 + 0.75 * this.skill;
    }

    // ── decisions, on the bot's own (slower) clock ─────────────────────────
    if (this.thinkLeft <= 0) {
      this.thinkLeft = 0.1 + 0.2 * (1 - this.skill) * this.random();
      target = this.think(me, runtime, edgeRadius);
    }

    // ── 2. brace against an incoming dash ──────────────────────────────────
    this.watchForDashes(me, runtime, step);
    if (this.braceHoldLeft > 0) {
      if (me.braceCooldownLeft > 0 && !me.bracing) {
        this.braceHoldLeft = 0; // the simulation refused or ended the brace
      } else {
        out.brace = true; // rooted: the stick stays neutral
        return;
      }
    }

    // ── committed to a dash: hold the button, pointing where it was aimed ──
    if (this.dashHoldLeft > 0 || this.dashHoldSteps > 0) {
      out.dash = true;
      this.writeStick(out, this.dashDirX, this.dashDirZ, runtime.cameraYaw);
      return;
    }
    // Mid-lunge with the button released: hands off and let it fly. Only once it is
    // already in the danger zone (a miss) does it start fighting its own momentum.
    if (me.dashing && dist <= safeRadius) return;

    // ── desired world velocity ─────────────────────────────────────────────
    let noise = this.aimNoise;
    if (this.retreating && dist > 1e-3) {
      const ux = me.x / dist;
      const uz = me.z / dist;
      this.wantX = -ux * CHARGE_SPEED;
      this.wantZ = -uz * CHARGE_SPEED;
      noise *= 0.25;
      this.brakeIfSliding(out, me, me.vx * ux + me.vz * uz);
    } else if (this.hesitateLeft > 0) {
      return; // a moment of doubt: hands off the stick
    } else {
      if (target) this.steerAtTarget(me, target);
      else this.steerWander(me, safeRadius, step);
      this.limitOutwardSpeed(me, dist, safeRadius);
    }

    // ── steering: push the stick along the velocity error ──────────────────
    let sx = (this.wantX - me.vx) / STEER_GAIN;
    let sz = (this.wantZ - me.vz) / STEER_GAIN;
    const len = Math.hypot(sx, sz);
    if (len > 1) {
      sx /= len;
      sz /= len;
    } else if (len < DEADZONE * 0.4) {
      sx = 0;
      sz = 0;
    } else if (len < DEADZONE * 1.05) {
      // Too small to register: nudge it just past the dead zone instead of stalling.
      const k = (DEADZONE * 1.05) / len;
      sx *= k;
      sz *= k;
    }
    const cos = Math.cos(noise);
    const sin = Math.sin(noise);
    this.writeStick(out, sx * cos - sz * sin, sx * sin + sz * cos, runtime.cameraYaw);
  }

  // ── decisions ────────────────────────────────────────────────────────────

  /** Refresh the slow decisions. Returns the (possibly new) target. */
  private think(me: WrestlerRuntime, runtime: GameRuntime, edgeRadius: number): WrestlerRuntime | undefined {
    const fallibility = 1 - this.skill;
    this.aimNoise = (this.random() * 2 - 1) * fallibility * 0.45;
    if (this.hesitateLeft <= 0 && this.random() < fallibility * 0.1) {
      this.hesitateLeft = 0.15 + this.random() * 0.3;
    }
    if (this.random() < 0.05) this.wanderDir = -this.wanderDir;

    // Nearest opponent, but stick with the current one unless another is clearly closer.
    const wrestlers = runtime.wrestlers;
    let nearest: WrestlerRuntime | undefined;
    let nearestDist = Infinity;
    let current: WrestlerRuntime | undefined;
    let currentDist = Infinity;
    for (let i = 0; i < wrestlers.length; i++) {
      const other = wrestlers[i];
      if (other.slot === me.slot || !isTargetable(other, runtime)) continue;
      const d = Math.hypot(other.x - me.x, other.z - me.z);
      if (other.slot === this.targetSlot) {
        current = other;
        currentDist = d;
      }
      if (d < nearestDist) {
        nearest = other;
        nearestDist = d;
      }
    }
    let target = current;
    if (nearest && (!current || nearestDist < currentDist - TARGET_HYSTERESIS)) {
      target = nearest;
      this.targetSlot = nearest.slot;
      this.orbitSide = this.random() < 0.5 ? 1 : -1;
    }

    if (target) this.considerDash(me, target, runtime, edgeRadius);
    return target;
  }

  /** Start a dash if the target is close, lined up, and the lunge will not end off the island. */
  private considerDash(me: WrestlerRuntime, target: WrestlerRuntime, runtime: GameRuntime, edgeRadius: number): void {
    if (this.retreating || this.hesitateLeft > 0 || this.braceHoldLeft > 0) return;
    if (this.dashLockLeft > 0 || this.dashHoldLeft > 0 || this.dashHoldSteps > 0) return;
    if (me.dashing || me.bracing || me.dashCooldownLeft > 0) return;
    // An invulnerable bot cannot push, and a rooted target barely moves: save the dash.
    if (runtime.isInvulnerable(me) || target.bracing) return;

    // Aim where the target will be when the lunge arrives.
    const gap = Math.hypot(target.x - me.x, target.z - me.z);
    const lead = gap / DASH_SPEED;
    let dx = target.x + target.vx * lead - me.x;
    let dz = target.z + target.vz * lead - me.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return;
    dx /= dist;
    dz /= dist;

    // "Roughly aligned with its heading": sloppier bots accept a wider angle.
    const tolerance = 0.35 + 0.35 * (1 - this.skill);
    if (Math.abs(angleDelta(me.facing, Math.atan2(dx, dz))) > tolerance) return;

    // The hit should send the target toward its nearest edge, not back to the middle.
    const targetRadius = Math.hypot(target.x, target.z);
    if (targetRadius >= 1 && (dx * target.x + dz * target.z) / targetRadius < DASH_PUSH_MIN) return;

    const limit = edgeRadius - DASH_EDGE_MARGIN;
    const missEnds = Math.hypot(me.x + dx * DASH_MISS_TRAVEL, me.z + dz * DASH_MISS_TRAVEL);
    if (missEnds < limit) {
      if (dist > DASH_RANGE_SAFE) return;
    } else {
      // A miss would be fatal: only lunge when the hit is all but certain, i.e. point-blank
      // at a target that is neither mid-dash itself nor bouncing through the air.
      if (dist > DASH_RANGE_RISKY || target.dashing || target.y > BODY_RADIUS + 0.3) return;
    }
    const hitTravel = Math.max(0, dist - BODY_RADIUS * 2) + DASH_HIT_OVERSHOOT;
    if (Math.hypot(me.x + dx * hitTravel, me.z + dz * hitTravel) > limit) return;

    // Everything says go; a hesitant bot still lets some chances pass.
    if (this.random() > 0.5 + 0.5 * this.skill) return;

    const wobble = this.aimNoise * 0.5;
    const cos = Math.cos(wobble);
    const sin = Math.sin(wobble);
    this.dashDirX = dx * cos - dz * sin;
    this.dashDirZ = dx * sin + dz * cos;
    this.dashHoldLeft = DASH_HOLD_SECONDS;
    this.dashHoldSteps = DASH_HOLD_STEPS;
    this.dashLockLeft = DASH_LOCK_SECONDS;
  }

  /**
   * Spot an opponent dashing at the bot from close range and, after a skill-scaled
   * reaction time, root for a moment. One roll per incoming dash.
   */
  private watchForDashes(me: WrestlerRuntime, runtime: GameRuntime, dt: number): void {
    const wrestlers = runtime.wrestlers;
    let threat = -1;
    for (let i = 0; i < wrestlers.length; i++) {
      const other = wrestlers[i];
      if (other.slot === me.slot || other.status !== "alive" || !other.dashing) continue;
      const dx = me.x - other.x;
      const dz = me.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > BRACE_RANGE || d < 1e-3) continue;
      const speed = Math.hypot(other.vx, other.vz);
      const hx = speed > 1 ? other.vx / speed : Math.sin(other.facing);
      const hz = speed > 1 ? other.vz / speed : Math.cos(other.facing);
      if ((hx * dx + hz * dz) / d > BRACE_ALIGN) {
        threat = other.slot;
        break;
      }
    }

    // The episode lasts as long as that opponent's dash does.
    if (this.threatSlot >= 0) {
      const dasher = runtime.wrestler(this.threatSlot);
      if (!dasher || dasher.status !== "alive" || !dasher.dashing) {
        this.threatSlot = -1;
        this.braceArmed = false;
      }
    }
    if (this.threatSlot < 0 && threat >= 0) {
      this.threatSlot = threat;
      this.braceArmed = this.random() < 0.25 + 0.7 * this.skill;
      this.braceReactLeft = lerp(0.24, 0.05, this.skill) * (0.8 + 0.4 * this.random());
    }
    if (!this.braceArmed) return;

    this.braceReactLeft -= dt;
    if (this.braceReactLeft > 0) return;
    this.braceArmed = false;
    const committed = this.dashHoldLeft > 0 || this.dashHoldSteps > 0 || me.dashing;
    if (threat < 0 || committed || me.braceCooldownLeft > 0 || runtime.isInvulnerable(me)) return;
    this.braceHoldLeft = Math.min(WRESTLER.brace.maxHoldSeconds, 0.3 + 0.3 * this.random());
  }

  /**
   * While sliding outward faster than it could ever run (a missed dash, a big hit),
   * rooting sheds speed faster than pushing the stick against it.
   */
  private brakeIfSliding(out: PlayerInput, me: WrestlerRuntime, outwardSpeed: number): void {
    if (me.dashing) return; // cannot root mid-lunge; try again when it ends
    if (this.brakeHoldLeft <= 0) {
      if (!this.brakeAllowed || outwardSpeed < BRAKE_ENTER_SPEED || me.braceCooldownLeft > 0) return;
      this.brakeAllowed = false; // once per retreat
      this.brakeHoldLeft = Math.min(WRESTLER.brace.maxHoldSeconds, BRAKE_HOLD_SECONDS);
    }
    if (outwardSpeed < BRAKE_EXIT_SPEED) {
      this.brakeHoldLeft = 0;
      return;
    }
    out.brace = true;
  }

  // ── steering targets (write the desired world velocity into wantX / wantZ) ──

  /**
   * Line up on the island-centre side of the target, then drive straight through it
   * toward its nearest edge.
   */
  private steerAtTarget(me: WrestlerRuntime, target: WrestlerRuntime): void {
    // Where the target is heading, so the bot cuts it off instead of trailing it.
    const lead = 0.12 + 0.2 * this.skill;
    const tx = target.x + target.vx * lead;
    const tz = target.z + target.vz * lead;
    const toX = tx - me.x;
    const toZ = tz - me.z;

    // Push direction: from the island centre out through the target. For a target
    // sitting on the centre every edge is equally near, so just push it away.
    let ox = tx;
    let oz = tz;
    let olen = Math.hypot(ox, oz);
    if (olen < CENTRE_RADIUS) {
      ox = toX;
      oz = toZ;
      olen = Math.hypot(ox, oz);
    }
    if (olen < 1e-3) {
      ox = Math.sin(me.facing);
      oz = Math.cos(me.facing);
    } else {
      ox /= olen;
      oz /= olen;
    }

    // Split the offset to the target into "along the push line" and "sideways".
    const along = toX * ox + toZ * oz;
    const sideX = toX - along * ox;
    const sideZ = toZ - along * oz;

    let goalX: number;
    let goalZ: number;
    let speed = CHARGE_SPEED;
    if (along > 0 && Math.hypot(sideX, sideZ) < CHARGE_LATERAL) {
      // Lined up behind it: charge through.
      goalX = tx + ox * 1.5;
      goalZ = tz + oz * 1.5;
    } else {
      // Head for the stand-off point; when caught on the edge side, swing around the
      // target rather than shoving it back toward the middle.
      const px = oz;
      const pz = -ox;
      const sideways = -(toX * px + toZ * pz); // bot's offset from the target along p
      const side = Math.abs(sideways) > 0.15 ? Math.sign(sideways) : this.orbitSide;
      const wrap = clamp(-along / 1.5, 0, 1) * WRAP_RADIUS * side;
      goalX = tx - ox * STANDOFF + px * wrap;
      goalZ = tz - oz * STANDOFF + pz * wrap;
      speed = Math.min(CHARGE_SPEED, 2 + Math.hypot(goalX - me.x, goalZ - me.z) * 3);
    }
    this.wantToward(me, goalX, goalZ, speed);
  }

  /** Nobody to fight: drift in a slow circle around the middle of the island. */
  private steerWander(me: WrestlerRuntime, safeRadius: number, dt: number): void {
    this.wanderAngle += this.wanderDir * WANDER_RATE * dt;
    const radius = Math.max(0, Math.min(WANDER_RADIUS, safeRadius * 0.4));
    const goalX = Math.sin(this.wanderAngle) * radius;
    const goalZ = Math.cos(this.wanderAngle) * radius;
    const gap = Math.hypot(goalX - me.x, goalZ - me.z);
    this.wantToward(me, goalX, goalZ, Math.min(WANDER_SPEED, gap * 2.5));
  }

  private wantToward(me: WrestlerRuntime, goalX: number, goalZ: number, speed: number): void {
    const dx = goalX - me.x;
    const dz = goalZ - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      this.wantX = 0;
      this.wantZ = 0;
      return;
    }
    this.wantX = (dx / d) * speed;
    this.wantZ = (dz / d) * speed;
  }

  /**
   * Cap the outward part of the desired velocity so that `LOOKAHEAD` seconds of it
   * never reaches past the safe radius: the bot slows as it nears the edge and only
   * slides along it, instead of running off after its target.
   */
  private limitOutwardSpeed(me: WrestlerRuntime, dist: number, safeRadius: number): void {
    if (dist < 1e-3) return;
    const ux = me.x / dist;
    const uz = me.z / dist;
    const maxOutward = Math.max((safeRadius - dist) / LOOKAHEAD, -MAX_SPEED);
    const outward = this.wantX * ux + this.wantZ * uz;
    if (outward <= maxOutward) return;
    this.wantX -= (outward - maxOutward) * ux;
    this.wantZ -= (outward - maxOutward) * uz;
  }

  // ── output ───────────────────────────────────────────────────────────────

  /** World-space stick → screen-relative, guaranteed finite and inside [-1, 1]. */
  private writeStick(out: PlayerInput, worldX: number, worldZ: number, cameraYaw: number): void {
    worldToInput(worldX, worldZ, cameraYaw, out);
    out.x = Number.isFinite(out.x) ? clamp(out.x, -1, 1) : 0;
    out.y = Number.isFinite(out.y) ? clamp(out.y, -1, 1) : 0;
  }

  private releaseButtons(): void {
    this.dashHoldLeft = 0;
    this.dashHoldSteps = 0;
    this.braceHoldLeft = 0;
    this.brakeHoldLeft = 0;
    this.braceArmed = false;
  }

  /** Forget everything short-lived (knocked out, between rounds): come back fresh. */
  private resetTransient(): void {
    this.releaseButtons();
    this.thinkLeft = RESPAWN_THINK_DELAY;
    this.targetSlot = -1;
    this.hesitateLeft = 0;
    this.retreating = false;
    this.brakeAllowed = false;
    this.dashLockLeft = 0;
    this.threatSlot = -1;
  }

  // ── PRNG ─────────────────────────────────────────────────────────────────

  private seed(seed: number): void {
    this.seeded = true;
    // Scramble so neighbouring seeds (slots 0..3) do not start out correlated.
    this.rngState = (Math.imul(Math.trunc(seed) ^ 0x9e3779b9, 0x85ebca6b) + 0x1f123bb5) | 0;
    this.wanderAngle = this.random() * Math.PI * 2;
    this.wanderDir = this.random() < 0.5 ? 1 : -1;
    this.orbitSide = this.random() < 0.5 ? 1 : -1;
    this.thinkLeft = 0.1 + 0.2 * this.random(); // do not react on the very first step
  }

  /** mulberry32: small, fast, deterministic. Returns a float in [0, 1). */
  private random(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/**
 * A bot for one slot. Deterministic for a given seed and sequence of samples; holds no
 * listeners or resources, so `dispose()` has nothing to release.
 */
export function createBotSource(options?: BotOptions): InputSource {
  return new BotSource(options);
}
