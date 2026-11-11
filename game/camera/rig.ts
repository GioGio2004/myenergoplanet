// The camera rig: everything the CameraDirector decides, as plain logic. No React and
// no three.js, so the whole behaviour (phases, framing, shake, knockout follow) can be
// simulated in tests against a real GameRuntime. CameraDirector.tsx only feeds it the
// frame delta / aspect / events and copies the resulting pose onto the three.js camera.
//
// Nothing here allocates per frame: the rig is mutated in place and the scratch objects
// below live at module scope.

import { gameConfig } from "../config";
import { clamp, damp, lerp } from "../math";
import type { GameRuntime } from "../runtime";
import type { Phase } from "../types";
import {
  DEG2RAD,
  aspectDistanceScale,
  blendProgress,
  bumpEnvelope,
  clampToRadius,
  createSpring,
  enclosingCircle,
  farthestDistance,
  fitSphereDistance,
  frameDistance,
  orbitOffset,
  punchEnvelope,
  shakeNoise,
  snapSpring,
  stepSpring,
  sweepRate,
  wrapAngle,
  type Circle,
  type Spring,
  type Vec2Like,
  type Vec3Like,
} from "./framing";

const CAM = gameConfig.camera;
const ARENA = gameConfig.arena;
const RULES = gameConfig.rules;

/** Camera tunables that are not part of the shared config contract. */
export const TUNING = {
  near: 0.1,
  far: 400,
  /** Real frame delta is clamped to this (tab switches, hitches). */
  maxDelta: 0.1,
  /** The camera never drops below the island surface plane + this. */
  minHeight: 1.0,
  fallbackAspect: 16 / 9,
  minPitch: 8 * DEG2RAD,
  maxPitch: 84 * DEG2RAD,

  /** Height of the look-at point above the island surface during play. */
  lookHeight: 0.45,
  /** The look-at target stays within this fraction of the arena radius from the centre. */
  targetLimit: 0.4,
  /**
   * Every framed wrestler stays at least this far inside the fitted ground disc, even
   * when the look-at target is not the group centre (clamped / leaning toward an edge).
   */
  subjectMargin: 1.8,
  /** Alive wrestlers below this height have already left the picture. */
  ignoreBelowY: -1,
  /** Look-at rises by this much per unit of mean wrestler height (drop-ins, pops). */
  airLift: 0.3,
  maxAirLift: 2.5,
  /** Spring time of the pitch (final-stretch blend). */
  pitchSmooth: 1.4,
  /** Smoothing of the orbit speed between phases. */
  yawRateSmooth: 0.45,
  /** Orbit speed multiplier with reduced motion. */
  reducedOrbitScale: 0.4,

  /** Hits weaker than this are nudges: no shake, no punch-in. */
  hitThreshold: 0.35,
  /** Pitch wobble (look-at only) relative to the positional shake. */
  shakePitchFactor: 0.6,
  /** Shake strength (0..1 of shake.maxOffset) when a ring of tiles falls away. */
  crumbleShake: 0.55,
  /** A small thud when wrestlers slam down from the intro drop. */
  landShake: 0.22,
  landMinSpeed: 14,
  /** How fast the punch-in bites, seconds. */
  punchAttack: 0.035,

  knockout: {
    /** How far the look-at blends toward the knockout position at the peak. */
    strength: 0.55,
    reducedStrength: 0.3,
    attack: 0.2,
    release: 0.45,
    /** The followed point is kept within arenaRadius + this. */
    maxReach: 2.5,
    minY: -2.5,
  },

  lobby: {
    orbitSpeed: 0.06,
    /** Lobby pitch as a fraction of the default pitch: slightly flatter, more scenic. */
    pitchScale: 0.85,
    lookHeight: 0.3,
    smooth: 1.2,
    /** Slow "breathing" so the beauty shot is never perfectly mechanical. */
    breatheRate: 0.45,
    breatheDistance: 0.5,
    breathePitch: 1.2 * DEG2RAD,
  },

  intro: {
    /** Start distance as a multiple of maxDistance. */
    startDistanceScale: 1.2,
    startPitch: 22 * DEG2RAD,
    /** Extra look-at height at the start: keeps the airspace above the island in frame. */
    lift: 2.0,
    /** Quick enough to catch the wrestlers dropping in (they land within ~1 s). */
    smooth: 0.45,
    /** The pull-back is the longest move (results close-up → wide shot): a bit softer. */
    zoomSmooth: 0.6,
    yawRateSmooth: 0.12,
    /** Reduced motion: a gentle, short move instead of the sweep. */
    reducedSmooth: 1.1,
    reducedDistanceScale: 1.12,
    reducedPitchOffset: -5 * DEG2RAD,
    reducedLift: 0.4,
    reducedSweep: 0.15,
  },

  countdown: { smooth: 0.9 },

  results: {
    pitch: 20 * DEG2RAD,
    /** Look slightly above the winner's centre (topknot in frame). */
    lookLift: 0.25,
    maxLookHeight: 3,
    /** Sphere around the winner that must fit even in narrow windows. */
    subjectRadius: 1.8,
    smooth: 1.1,
  },
} as const;

/** Everything the rig remembers between frames. Plain numbers, mutated in place. */
export type Rig = {
  /** False until the first frame has snapped the springs to a valid pose. */
  ready: boolean;
  phase: Phase;
  /** Real seconds since `phase` began. */
  phaseClock: number;
  /** Real seconds since mount (noise / breathing time base). */
  clock: number;

  /** Heading of the camera around its look-at target. This is `runtime.cameraYaw`. */
  yaw: number;
  yawRate: number;
  pitch: Spring;
  distance: Spring;
  targetX: Spring;
  targetY: Spring;
  targetZ: Spring;

  /** Current shake amplitude in world units, decays exponentially. */
  shake: number;
  /** Punch-in: peak amount, seconds since the hit, and the smoothed applied value. */
  punchAmount: number;
  punchAge: number;
  punch: number;

  /** Knockout follow: seconds since the knockout (Infinity = inactive) and its position. */
  knockoutAge: number;
  knockoutX: number;
  knockoutY: number;
  knockoutZ: number;

  /** A 'crumbleWarn' was seen this match → final-stretch framing. */
  crumbleSeen: boolean;
};

export function createRig(): Rig {
  return {
    ready: false,
    phase: "lobby",
    phaseClock: 0,
    clock: 0,
    yaw: 0,
    yawRate: 0,
    pitch: createSpring(),
    distance: createSpring(),
    targetX: createSpring(),
    targetY: createSpring(),
    targetZ: createSpring(),
    shake: 0,
    punchAmount: 0,
    punchAge: Infinity,
    punch: 0,
    knockoutAge: Infinity,
    knockoutX: 0,
    knockoutY: 0,
    knockoutZ: 0,
    crumbleSeen: false,
  };
}

// ── module-scope scratch (written and consumed within one frame, never retained) ──

/** The pose the current phase asks for; the springs chase it. */
const want = {
  x: 0,
  y: 0,
  z: 0,
  distance: 0,
  pitch: 0,
  yawRate: 0,
  moveSmooth: 0,
  zoomSmooth: 0,
  pitchSmooth: 0,
  yawRateSmooth: 0,
};

/** Bounding circle, mean lift and edge lean of the wrestlers currently in the picture. */
const group = { x: 0, z: 0, radius: 0, count: 0, lift: 0, leanX: 0, leanZ: 0 };

const pointsX = new Float64Array(gameConfig.maxPlayers);
const pointsZ = new Float64Array(gameConfig.maxPlayers);
const circle: Circle = { x: 0, z: 0, radius: 0 };
const vec2: Vec2Like = { x: 0, z: 0 };
const offset: Vec3Like = { x: 0, y: 0, z: 0 };

/** Bounding circle of the alive wrestlers, how high they are, and who is on the edge. */
function measureGroup(runtime: GameRuntime): void {
  const wrestlers = runtime.wrestlers;
  let count = 0;
  let lift = 0;
  let leanX = 0;
  let leanZ = 0;

  for (let i = 0; i < wrestlers.length && count < pointsX.length; i++) {
    const w = wrestlers[i];
    if (w.status !== "alive") continue;
    // Also rejects NaN / infinite positions so a bad physics frame cannot poison the springs.
    if (!(w.y >= TUNING.ignoreBelowY) || !Number.isFinite(w.x + w.y + w.z)) continue;
    pointsX[count] = w.x;
    pointsZ[count] = w.z;
    count++;
    lift += Math.max(0, w.y - gameConfig.wrestler.radius);
    if (w.onEdge) {
      // On the edge the outward radial points at the drop: lean that way to show the abyss.
      const len = Math.sqrt(w.x * w.x + w.z * w.z);
      if (len > 1e-3) {
        leanX += w.x / len;
        leanZ += w.z / len;
      }
    }
  }

  enclosingCircle(pointsX, pointsZ, count, circle);
  const leanLen = Math.sqrt(leanX * leanX + leanZ * leanZ);
  if (leanLen > 1) {
    leanX /= leanLen;
    leanZ /= leanLen;
  }

  group.x = circle.x;
  group.z = circle.z;
  group.radius = circle.radius;
  group.count = count;
  group.lift = count > 0 ? lift / count : 0;
  group.leanX = leanX;
  group.leanZ = leanZ;
}

/**
 * DEFAULT FRAMING: look at the group of alive wrestlers and back off just far enough
 * to fit them. `fitPitch` is the pitch the fit distance is computed for.
 */
function wantGroupFraming(
  runtime: GameRuntime,
  aspect: number,
  dramatic: boolean,
  fitPitch: number,
  orbitScale: number,
): void {
  measureGroup(runtime);
  const hasGroup = group.count > 0;

  clampToRadius(
    hasGroup ? group.x : 0,
    hasGroup ? group.z : 0,
    runtime.arenaRadius * TUNING.targetLimit,
    vec2,
  );
  want.x = vec2.x + group.leanX * CAM.edgeLean;
  want.z = vec2.z + group.leanZ * CAM.edgeLean;
  want.y = TUNING.lookHeight + Math.min(TUNING.maxAirLift, group.lift * TUNING.airLift);

  // Nobody in play: frame the island centre about as wide as the spawn circle.
  // Otherwise fit the bounding circle + padding, but never so tight that a wrestler far
  // from the (clamped, leaning) look-at point would touch the frame.
  const radius = hasGroup
    ? Math.max(
        group.radius,
        farthestDistance(pointsX, pointsZ, group.count, want.x, want.z) +
          TUNING.subjectMargin -
          CAM.framePadding,
      )
    : ARENA.spawnRadius;

  want.pitch = (dramatic ? CAM.finalPitchDegrees : CAM.pitchDegrees) * DEG2RAD;
  want.distance = frameDistance(
    radius,
    CAM.framePadding,
    CAM.fov,
    aspect,
    fitPitch,
    CAM.minDistance,
    CAM.maxDistance,
  );
  want.yawRate = (dramatic ? CAM.finalOrbitSpeed : CAM.orbitSpeed) * orbitScale;
  want.moveSmooth = CAM.positionSmoothTime;
  want.zoomSmooth = CAM.zoomSmoothTime;
  want.pitchSmooth = TUNING.pitchSmooth;
  want.yawRateSmooth = TUNING.yawRateSmooth;
}

/** Briefly pull the look-at toward where the victim went over the edge, dipping down. */
function applyKnockoutFollow(rig: Rig, runtime: GameRuntime, reduceMotion: boolean): void {
  if (rig.knockoutAge >= CAM.knockoutFollowSeconds) return;
  const ko = TUNING.knockout;
  const weight =
    bumpEnvelope(rig.knockoutAge / CAM.knockoutFollowSeconds, ko.attack, ko.release) *
    (reduceMotion ? ko.reducedStrength : ko.strength);
  clampToRadius(rig.knockoutX, rig.knockoutZ, runtime.arenaRadius + ko.maxReach, vec2);
  want.x = lerp(want.x, vec2.x, weight);
  want.z = lerp(want.z, vec2.z, weight);
  want.y = lerp(want.y, Math.max(rig.knockoutY, ko.minY), weight);
}

/** Fill `want` with the pose the current phase asks for. */
function solveWantedPose(
  rig: Rig,
  runtime: GameRuntime,
  aspect: number,
  reduceMotion: boolean,
): void {
  const orbitScale = reduceMotion ? TUNING.reducedOrbitScale : 1;
  const defaultPitch = CAM.pitchDegrees * DEG2RAD;

  switch (rig.phase) {
    case "lobby": {
      // Calm beauty shot: wide slow orbit around the island centre.
      const lobby = TUNING.lobby;
      const breathe = reduceMotion ? 0 : 1;
      const pitch = defaultPitch * lobby.pitchScale;
      want.x = 0;
      want.z = 0;
      want.y = lobby.lookHeight;
      want.pitch =
        pitch + Math.sin(rig.clock * lobby.breatheRate * 0.8 + 1) * lobby.breathePitch * breathe;
      want.distance =
        CAM.maxDistance * aspectDistanceScale(CAM.fov, aspect, pitch) +
        Math.sin(rig.clock * lobby.breatheRate) * lobby.breatheDistance * breathe;
      want.yawRate = lobby.orbitSpeed * orbitScale;
      want.moveSmooth = lobby.smooth;
      want.zoomSmooth = lobby.smooth;
      want.pitchSmooth = lobby.smooth;
      want.yawRateSmooth = TUNING.yawRateSmooth;
      break;
    }

    case "intro": {
      // Sweeping fly-in: start far and low, orbit while closing in and rising to the
      // default framing. The end pose is the live group framing, so the hand-over to
      // the countdown is seamless.
      const intro = TUNING.intro;
      wantGroupFraming(runtime, aspect, false, defaultPitch, orbitScale);
      const u = RULES.introSeconds > 0 ? clamp(rig.phaseClock / RULES.introSeconds, 0, 1) : 1;
      const e = blendProgress(rig.phaseClock, RULES.introSeconds);

      const startDistance = reduceMotion
        ? want.distance * intro.reducedDistanceScale
        : CAM.maxDistance *
          aspectDistanceScale(CAM.fov, aspect, defaultPitch) *
          intro.startDistanceScale;
      const startPitch = reduceMotion ? defaultPitch + intro.reducedPitchOffset : intro.startPitch;
      const lift = reduceMotion ? intro.reducedLift : intro.lift;
      const sweep = CAM.introOrbitRadians * (reduceMotion ? intro.reducedSweep : 1);

      want.x *= e;
      want.z *= e;
      want.y += lift * (1 - e);
      want.distance = lerp(startDistance, want.distance, e);
      want.pitch = lerp(startPitch, want.pitch, e);
      if (RULES.introSeconds > 0) want.yawRate += (sweep * sweepRate(u)) / RULES.introSeconds;
      want.moveSmooth = reduceMotion ? intro.reducedSmooth : intro.smooth;
      want.zoomSmooth = reduceMotion ? intro.reducedSmooth : intro.zoomSmooth;
      want.pitchSmooth = reduceMotion ? intro.reducedSmooth : intro.smooth;
      want.yawRateSmooth = intro.yawRateSmooth;
      break;
    }

    case "results": {
      // Close-up orbit around the winner (or the island centre on a draw).
      const results = TUNING.results;
      const winner = runtime.winner !== null ? runtime.wrestler(runtime.winner) : undefined;
      if (
        winner &&
        winner.y >= TUNING.ignoreBelowY &&
        Number.isFinite(winner.x + winner.y + winner.z)
      ) {
        want.x = winner.x;
        want.z = winner.z;
        want.y = Math.min(winner.y, results.maxLookHeight) + results.lookLift;
      } else {
        want.x = 0;
        want.z = 0;
        want.y = gameConfig.wrestler.radius + results.lookLift;
      }
      want.pitch = results.pitch;
      want.distance = Math.max(
        CAM.resultsDistance,
        fitSphereDistance(results.subjectRadius, CAM.fov, aspect),
      );
      want.yawRate = CAM.resultsOrbitSpeed * orbitScale;
      want.moveSmooth = results.smooth;
      want.zoomSmooth = results.smooth;
      want.pitchSmooth = results.smooth;
      want.yawRateSmooth = TUNING.yawRateSmooth;
      break;
    }

    case "countdown": {
      // Settle into the default framing, a touch slower than in play.
      wantGroupFraming(runtime, aspect, false, defaultPitch, orbitScale);
      want.moveSmooth = TUNING.countdown.smooth;
      want.zoomSmooth = TUNING.countdown.smooth;
      want.pitchSmooth = TUNING.countdown.smooth;
      break;
    }

    default: {
      // playing / suddenDeath. The final stretch (and sudden death) drops to the lower,
      // more dramatic pitch and a faster orbit; the springs do the blending.
      const dramatic =
        rig.phase === "suddenDeath" || rig.crumbleSeen || runtime.getHud().finalStretch;
      // Fit for the pitch the camera actually has right now, so nobody is cropped mid-blend.
      const fitPitch = rig.ready ? rig.pitch.value : defaultPitch;
      wantGroupFraming(runtime, aspect, dramatic, fitPitch, orbitScale);
      applyKnockoutFollow(rig, runtime, reduceMotion);
      break;
    }
  }

  want.pitch = clamp(want.pitch, TUNING.minPitch, TUNING.maxPitch);
}

/** Advance the rig by `dt` REAL seconds (so slow motion never freezes the camera). */
export function updateRig(
  rig: Rig,
  runtime: GameRuntime,
  dt: number,
  aspect: number,
  reduceMotion: boolean,
): void {
  // A poisoned spring (NaN) would black out the screen for good: re-snap instead.
  if (
    rig.ready &&
    !Number.isFinite(
      rig.yaw +
        rig.yawRate +
        rig.pitch.value +
        rig.distance.value +
        rig.targetX.value +
        rig.targetY.value +
        rig.targetZ.value,
    )
  ) {
    rig.ready = false;
  }

  if (runtime.phase !== rig.phase) {
    rig.phase = runtime.phase;
    rig.phaseClock = 0;
    if (rig.phase === "intro" || rig.phase === "lobby") {
      // A new match: forget the previous one's final stretch and knockout.
      rig.crumbleSeen = false;
      rig.knockoutAge = Infinity;
    }
  } else {
    rig.phaseClock += dt;
  }
  rig.clock += dt;
  rig.knockoutAge += dt;
  rig.punchAge += dt;

  solveWantedPose(rig, runtime, aspect, reduceMotion);

  if (!rig.ready) {
    // First frame (or recovery): start exactly on the wanted pose, keeping the heading
    // the controls are already using.
    snapSpring(rig.targetX, want.x);
    snapSpring(rig.targetY, want.y);
    snapSpring(rig.targetZ, want.z);
    snapSpring(rig.distance, want.distance);
    snapSpring(rig.pitch, want.pitch);
    rig.yaw = Number.isFinite(runtime.cameraYaw) ? runtime.cameraYaw : 0;
    rig.yawRate = want.yawRate;
    rig.ready = true;
  } else {
    stepSpring(rig.targetX, want.x, want.moveSmooth, dt);
    stepSpring(rig.targetY, want.y, want.moveSmooth, dt);
    stepSpring(rig.targetZ, want.z, want.moveSmooth, dt);
    stepSpring(rig.distance, want.distance, want.zoomSmooth, dt);
    stepSpring(rig.pitch, want.pitch, want.pitchSmooth, dt);
    rig.yawRate = damp(rig.yawRate, want.yawRate, want.yawRateSmooth, dt);
  }
  rig.yaw = wrapAngle(rig.yaw + rig.yawRate * dt);
  // Screen-relative controls depend on this being exactly the heading `applyRig` uses
  // to place the camera around its look-at target.
  runtime.cameraYaw = rig.yaw;

  // Shake decays exponentially; the punch-in bites fast and recovers over punchIn.seconds.
  rig.shake *= Math.exp(-CAM.shake.decayPerSecond * dt);
  if (rig.shake < 1e-3 || reduceMotion) rig.shake = 0;

  const punchGoal = reduceMotion ? 0 : punchGoalOf(rig);
  rig.punch = damp(rig.punch, punchGoal, TUNING.punchAttack, dt);
  if (punchGoal === 0 && rig.punch < 1e-4) rig.punch = 0;
}

/** Where the punch-in wants to be right now (distance units closer to the target). */
export function punchGoalOf(rig: Rig): number {
  if (CAM.punchIn.seconds <= 0) return 0;
  return rig.punchAmount * punchEnvelope(rig.punchAge / CAM.punchIn.seconds);
}


// ── event reactions ─────────────────────────────────────────────────────────

/** Raise the shake to `strength` (0..1 of shake.maxOffset); never lowers a bigger one. */
function addShake(rig: Rig, strength: number): void {
  rig.shake = Math.max(rig.shake, clamp(strength, 0, 1) * CAM.shake.maxOffset);
}

/** A real impact between two wrestlers: shake + punch-in, unless it was only a nudge. */
export function onHit(rig: Rig, strength: number, reduceMotion: boolean): void {
  if (reduceMotion || !(strength >= TUNING.hitThreshold)) return;
  const s = clamp(strength, 0, 1);
  addShake(rig, s);
  // Restart the punch only if this hit is harder than what is left of the last one,
  // so a flurry of hits never makes the zoom stutter.
  const amount = CAM.punchIn.amount * s;
  if (amount > punchGoalOf(rig)) {
    rig.punchAmount = amount;
    rig.punchAge = 0;
  }
}

/** Someone went over the edge at (x, y, z): slow motion and a brief follow of the fall. */
export function onKnockout(
  rig: Rig,
  runtime: GameRuntime,
  x: number,
  y: number,
  z: number,
  reduceMotion: boolean,
): void {
  if (Number.isFinite(x + y + z)) {
    rig.knockoutAge = 0;
    rig.knockoutX = x;
    rig.knockoutY = y;
    rig.knockoutZ = z;
  }
  if (!reduceMotion) runtime.requestSlowMo(CAM.knockoutSlowMo.scale, CAM.knockoutSlowMo.seconds);
}

/** Tiles started cracking: from now on this match uses the final-stretch framing. */
export function onCrumbleWarn(rig: Rig): void {
  rig.crumbleSeen = true;
}

/** A ring of tiles fell away: a medium shake. */
export function onCrumble(rig: Rig, reduceMotion: boolean): void {
  if (!reduceMotion) addShake(rig, TUNING.crumbleShake);
}

/** A wrestler slammed onto the island at `speed`: a small thud for the big drops only. */
export function onLand(rig: Rig, speed: number, reduceMotion: boolean): void {
  if (!reduceMotion && speed >= TUNING.landMinSpeed) addShake(rig, TUNING.landShake);
}

// ── final pose ──────────────────────────────────────────────────────────────

/** World-space camera position and the point it looks at (up is always +Y). */
export type CameraPose = {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
};

export function createPose(): CameraPose {
  return { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0 };
}

/**
 * Compose the final camera pose from the rig: orbit pose + punch-in + shake.
 *
 * Invariant the controls rely on: the camera sits at exactly
 * (sin yaw, ·, cos yaw) × horizontal distance from its look-at point, with
 * yaw = `rig.yaw` = `runtime.cameraYaw`. Shake and the height clamp never break it.
 */
export function composePose(rig: Rig, out: CameraPose): CameraPose {
  const distance = Math.max(1, rig.distance.value - rig.punch);
  const pitch = clamp(rig.pitch.value, TUNING.minPitch, TUNING.maxPitch);
  orbitOffset(rig.yaw, pitch, distance, offset);

  let lookX = rig.targetX.value;
  let lookY = rig.targetY.value;
  let lookZ = rig.targetZ.value;
  let camX = lookX + offset.x;
  let camY = lookY + offset.y;
  let camZ = lookZ + offset.z;

  if (rig.shake > 0) {
    // Positional shake moves camera AND look-at together along screen-right and
    // world-up, the pitch wobble moves only the look-at height: neither changes the
    // heading of the camera around its target, so `cameraYaw` stays exact.
    const side = shakeNoise(rig.clock, 0) * rig.shake;
    const up = shakeNoise(rig.clock, 1) * rig.shake;
    const tilt = shakeNoise(rig.clock, 2) * rig.shake * TUNING.shakePitchFactor;
    const rightX = Math.cos(rig.yaw);
    const rightZ = -Math.sin(rig.yaw);
    camX += rightX * side;
    camZ += rightZ * side;
    lookX += rightX * side;
    lookZ += rightZ * side;
    camY += up;
    lookY += up + tilt;
  }

  // Never dip below the island surface (+ margin). Only Y changes: heading is kept.
  if (camY < TUNING.minHeight) camY = TUNING.minHeight;

  out.x = camX;
  out.y = camY;
  out.z = camZ;
  out.lookX = lookX;
  out.lookY = lookY;
  out.lookZ = lookZ;
  return out;
}
