import { describe, expect, it } from "vitest";
import { gameConfig, spawnPoint } from "../config";
import { angleDelta } from "../math";
import { GameRuntime } from "../runtime";
import type { Phase, PlayerSetup, PlayerSlot } from "../types";
import { DEG2RAD, headingFromOffset } from "./framing";
import {
  TUNING,
  composePose,
  createPose,
  createRig,
  onCrumble,
  onCrumbleWarn,
  onHit,
  onKnockout,
  onLand,
  updateRig,
  type CameraPose,
  type Rig,
} from "./rig";

const CAM = gameConfig.camera;
const ARENA = gameConfig.arena;
const RULES = gameConfig.rules;
const DT = 1 / 60;
const WIDE = 16 / 9;
const REST_Y: number = gameConfig.wrestler.radius;

const SETUPS: PlayerSetup[] = [
  { slot: 0, name: "A", control: "bot" },
  { slot: 1, name: "B", control: "bot" },
  { slot: 2, name: "C", control: "bot" },
  { slot: 3, name: "D", control: "bot" },
];

type Sim = {
  runtime: GameRuntime;
  rig: Rig;
  pose: CameraPose;
  reduceMotion: boolean;
  aspect: number;
};

function createSim(players = 2, reduceMotion = false, aspect = WIDE): Sim {
  const runtime = new GameRuntime();
  runtime.setPlayers(SETUPS.slice(0, players));
  return { runtime, rig: createRig(), pose: createPose(), reduceMotion, aspect };
}

function place(sim: Sim, slot: PlayerSlot, x: number, z: number, y = REST_Y): void {
  const w = sim.runtime.wrestler(slot);
  if (!w) throw new Error(`no wrestler in slot ${slot}`);
  w.status = "alive";
  w.x = x;
  w.y = y;
  w.z = z;
}

function frame(sim: Sim, dt = DT): CameraPose {
  updateRig(sim.rig, sim.runtime, dt, sim.aspect, sim.reduceMotion);
  return composePose(sim.rig, sim.pose);
}

/** Run `seconds` of frames; `each` sees the pose after every frame. */
function run(sim: Sim, seconds: number, each?: (pose: CameraPose, t: number) => void): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    const pose = frame(sim);
    each?.(pose, (i + 1) * DT);
  }
}

function setPhase(sim: Sim, phase: Phase): void {
  sim.runtime.phase = phase;
  sim.runtime.phaseTime = 0;
}

const distanceOf = (p: CameraPose) => Math.hypot(p.x - p.lookX, p.y - p.lookY, p.z - p.lookZ);
const pitchOf = (p: CameraPose) => Math.asin((p.y - p.lookY) / distanceOf(p));
const headingOf = (p: CameraPose) => headingFromOffset(p.x - p.lookX, p.z - p.lookZ);
const lookRadius = (p: CameraPose) => Math.hypot(p.lookX, p.lookZ);

/** Project a world point through the pose; |x|, |y| < 1 means it is inside the frame. */
function project(
  p: CameraPose,
  aspect: number,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; depth: number } {
  const d = distanceOf(p);
  const f = { x: (p.lookX - p.x) / d, y: (p.lookY - p.y) / d, z: (p.lookZ - p.z) / d };
  // right = forward × up, up' = right × forward
  const rl = Math.hypot(f.z, f.x);
  const r = { x: -f.z / rl, y: 0, z: f.x / rl };
  const u = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  const rel = { x: x - p.x, y: y - p.y, z: z - p.z };
  const depth = rel.x * f.x + rel.y * f.y + rel.z * f.z;
  const tv = Math.tan((CAM.fov * DEG2RAD) / 2);
  return {
    x: (rel.x * r.x + rel.y * r.y + rel.z * r.z) / (depth * tv * aspect),
    y: (rel.x * u.x + rel.y * u.y + rel.z * u.z) / (depth * tv),
    depth,
  };
}

/** Largest |NDC| of every alive wrestler's body (centre and top of the sphere). */
function worstWrestlerNdc(sim: Sim, pose: CameraPose): number {
  let worst = 0;
  for (const w of sim.runtime.wrestlers) {
    if (w.status !== "alive") continue;
    for (const dy of [-REST_Y, 0, REST_Y]) {
      const ndc = project(pose, sim.aspect, w.x, w.y + dy, w.z);
      expect(ndc.depth).toBeGreaterThan(0);
      worst = Math.max(worst, Math.abs(ndc.x), Math.abs(ndc.y));
    }
  }
  return worst;
}

describe("camera rig: invariants", () => {
  it("writes the exact heading of the camera around its target to runtime.cameraYaw, in every phase, with shake", () => {
    const sim = createSim(2);
    place(sim, 0, 2, 1);
    place(sim, 1, -4.6, 2.5);
    sim.runtime.wrestlers[1].onEdge = true;

    const check = (pose: CameraPose) => {
      expect(Number.isFinite(pose.x + pose.y + pose.z + pose.lookX + pose.lookY + pose.lookZ)).toBe(
        true,
      );
      expect(Math.abs(angleDelta(headingOf(pose), sim.runtime.cameraYaw))).toBeLessThan(1e-9);
      expect(sim.runtime.cameraYaw).toBe(sim.rig.yaw);
      expect(pose.y).toBeGreaterThanOrEqual(TUNING.minHeight);
    };

    const phases: Phase[] = ["lobby", "intro", "countdown", "playing", "suddenDeath", "results"];
    for (const phase of phases) {
      setPhase(sim, phase);
      if (phase === "results") sim.runtime.winner = 0;
      run(sim, 0.5, check);
      onHit(sim.rig, 1, false);
      onCrumble(sim.rig, false);
      onKnockout(sim.rig, sim.runtime, 7, -2, 1, false);
      run(sim, 3, check);
    }
  });

  it("never drops below the island surface + margin, even looking at a deep knockout", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, 0, 0);
    frame(sim);
    // Force an absurdly low look-at and a flat pitch.
    sim.rig.targetY.value = -30;
    sim.rig.pitch.value = TUNING.minPitch;
    const pose = composePose(sim.rig, sim.pose);
    expect(pose.y).toBe(TUNING.minHeight);
    expect(Math.abs(angleDelta(headingOf(pose), sim.rig.yaw))).toBeLessThan(1e-9);
  });

  it("recovers from poisoned state and ignores wrestlers with invalid positions", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, 1, 1);
    place(sim, 1, Number.NaN, 0);
    run(sim, 1, (pose) => expect(Number.isFinite(pose.x + pose.y + pose.z)).toBe(true));
    expect(sim.rig.targetX.value).toBeGreaterThan(0.5);

    sim.rig.distance.value = Number.NaN;
    sim.rig.targetX.velocity = Number.POSITIVE_INFINITY;
    sim.rig.targetX.value = Number.POSITIVE_INFINITY;
    const pose = frame(sim);
    expect(Number.isFinite(pose.x + pose.y + pose.z + pose.lookX + pose.lookY + pose.lookZ)).toBe(
      true,
    );
    expect(Number.isFinite(sim.runtime.cameraYaw)).toBe(true);
  });

  it("tolerates zero, negative and NaN frame deltas", () => {
    const sim = createSim(2);
    run(sim, 0.5);
    const before = { ...composePose(sim.rig, createPose()) };
    for (const dt of [0, -1, Number.NaN]) {
      // The component clamps the delta exactly like this before calling the rig.
      const pose = frame(sim, dt > 0 ? Math.min(dt, TUNING.maxDelta) : 0);
      expect(pose.x).toBeCloseTo(before.x, 9);
      expect(pose.y).toBeCloseTo(before.y, 9);
      expect(pose.z).toBeCloseTo(before.z, 9);
    }
  });
});

describe("camera rig: phases", () => {
  it("lobby: a wide, slow orbit around the island centre", () => {
    const sim = createSim(2);
    let minD = Infinity;
    let maxD = -Infinity;
    const yaw0 = sim.runtime.cameraYaw;
    run(sim, 10, (pose) => {
      minD = Math.min(minD, distanceOf(pose));
      maxD = Math.max(maxD, distanceOf(pose));
      expect(lookRadius(pose)).toBeLessThan(1e-6);
      expect(pitchOf(pose)).toBeGreaterThan(35 * DEG2RAD);
      expect(pitchOf(pose)).toBeLessThan((CAM.pitchDegrees + 5) * DEG2RAD);
    });
    expect(minD).toBeGreaterThan(CAM.maxDistance - 1);
    expect(maxD).toBeLessThan(CAM.maxDistance + 1);
    // Always alive: it has turned, but slowly.
    const turned = sim.runtime.cameraYaw - yaw0;
    expect(turned).toBeGreaterThan(0.2);
    expect(turned).toBeLessThan(1.5);
  });

  it("intro: sweeps by introOrbitRadians while closing in and rising to the default framing", () => {
    const sim = createSim(4);
    run(sim, 2);
    // What match.start() does: everyone above their spawn point, staggered in height.
    const dropFrom = (i: number) => ARENA.introDropHeight + i * 1.5;
    sim.runtime.wrestlers.forEach((w, i) => {
      const p = spawnPoint(i, 4);
      place(sim, w.slot, p.x, p.z, dropFrom(i));
    });
    setPhase(sim, "intro");

    let swept = 0;
    let prevYaw = sim.runtime.cameraYaw;
    let farthest = 0;
    let lowestPitch = Infinity;
    const g = -gameConfig.sim.gravity;
    run(sim, RULES.introSeconds, (pose, t) => {
      swept += angleDelta(prevYaw, sim.runtime.cameraYaw);
      prevYaw = sim.runtime.cameraYaw;
      farthest = Math.max(farthest, distanceOf(pose));
      lowestPitch = Math.min(lowestPitch, pitchOf(pose));
      // Wrestlers free-fall from the drop height and land.
      sim.runtime.wrestlers.forEach((w, i) => {
        w.y = Math.max(REST_Y, dropFrom(i) - 0.5 * g * t * t);
      });
      // The island stays in frame throughout; the camera needs a moment to tilt up from
      // the lobby shot (no cut), after which the whole airspace with every falling
      // wrestler is in frame - well before the first one lands (~0.84 s).
      const centre = project(pose, sim.aspect, 0, 0, 0);
      expect(Math.abs(centre.x)).toBeLessThan(0.6);
      expect(Math.abs(centre.y)).toBeLessThan(0.8);
      if (t >= 0.5) expect(worstWrestlerNdc(sim, pose)).toBeLessThan(0.9);
    });

    // Started far and low-ish…
    expect(farthest).toBeGreaterThan(CAM.maxDistance);
    expect(lowestPitch).toBeLessThan(35 * DEG2RAD);

    // …and hands over to the countdown in (nearly) the default framing.
    setPhase(sim, "countdown");
    run(sim, 1.5, () => {
      swept += angleDelta(prevYaw, sim.runtime.cameraYaw);
      prevYaw = sim.runtime.cameraYaw;
    });
    const drift = CAM.orbitSpeed * (RULES.introSeconds + 1.5);
    expect(swept).toBeGreaterThan(CAM.introOrbitRadians * 0.95);
    expect(swept).toBeLessThan(CAM.introOrbitRadians + drift + 0.1);
    const pose = composePose(sim.rig, sim.pose);
    expect(pitchOf(pose)).toBeCloseTo(CAM.pitchDegrees * DEG2RAD, 1);
    expect(distanceOf(pose)).toBeGreaterThanOrEqual(CAM.minDistance - 0.05);
    expect(distanceOf(pose)).toBeLessThanOrEqual(CAM.maxDistance + 0.05);
    expect(worstWrestlerNdc(sim, pose)).toBeLessThan(0.8);
  });

  it("rematch intro: pulls out of the results close-up in time to see everyone land", () => {
    const sim = createSim(4);
    sim.runtime.wrestlers.forEach((w, i) => {
      const p = spawnPoint(i, 4);
      place(sim, w.slot, p.x * 0.5, p.z * 0.5);
    });
    sim.runtime.winner = 2;
    setPhase(sim, "results");
    run(sim, 5);
    expect(distanceOf(sim.pose)).toBeCloseTo(CAM.resultsDistance, 1);

    const dropFrom = (i: number) => ARENA.introDropHeight + i * 1.5;
    sim.runtime.wrestlers.forEach((w, i) => {
      const p = spawnPoint(i, 4);
      place(sim, w.slot, p.x, p.z, dropFrom(i));
    });
    sim.runtime.winner = null;
    setPhase(sim, "intro");
    const g = -gameConfig.sim.gravity;
    run(sim, RULES.introSeconds, (pose, t) => {
      sim.runtime.wrestlers.forEach((w, i) => {
        w.y = Math.max(REST_Y, dropFrom(i) - 0.5 * g * t * t);
      });
      if (t >= 0.65) expect(worstWrestlerNdc(sim, pose)).toBeLessThan(0.9);
    });
  });

  it("intro with reduced motion is a gentle, short move", () => {
    const sim = createSim(2, true);
    run(sim, 2);
    place(sim, 0, 0, ARENA.spawnRadius);
    place(sim, 1, 0, -ARENA.spawnRadius);
    const start = { ...composePose(sim.rig, createPose()) };
    const yaw0 = sim.runtime.cameraYaw;
    setPhase(sim, "intro");
    let farthest = 0;
    let fastest = 0;
    const prev = { ...start };
    run(sim, RULES.introSeconds, (pose) => {
      farthest = Math.max(farthest, distanceOf(pose));
      fastest = Math.max(fastest, Math.hypot(pose.x - prev.x, pose.y - prev.y, pose.z - prev.z));
      Object.assign(prev, pose);
    });
    expect(Math.abs(angleDelta(yaw0, sim.runtime.cameraYaw))).toBeLessThan(0.6);
    expect(farthest).toBeLessThanOrEqual(distanceOf(start) + 0.5);
    expect(fastest / DT).toBeLessThan(8); // world units per second
    // It still ends in the default framing.
    expect(pitchOf(sim.pose)).toBeCloseTo(CAM.pitchDegrees * DEG2RAD, 1);
  });

  it("never cuts: the camera eases through every phase change", () => {
    const sim = createSim(2);
    place(sim, 0, 3, 0);
    place(sim, 1, -3, 0);
    sim.runtime.winner = 1;

    const prev = createPose();
    let maxStep = 0;
    const track = (pose: CameraPose) => {
      const step = Math.hypot(pose.x - prev.x, pose.y - prev.y, pose.z - prev.z);
      const lookStep = Math.hypot(
        pose.lookX - prev.lookX,
        pose.lookY - prev.lookY,
        pose.lookZ - prev.lookZ,
      );
      maxStep = Math.max(maxStep, step, lookStep);
      Object.assign(prev, pose);
    };

    Object.assign(prev, frame(sim));
    const sequence: Phase[] = [
      "intro",
      "countdown",
      "playing",
      "suddenDeath",
      "results",
      "intro", // rematch
      "countdown",
      "playing",
      "lobby",
      "intro",
      "results",
      "lobby",
    ];
    for (const phase of sequence) {
      run(sim, 2.5, track);
      setPhase(sim, phase);
      // The very first frame of a new phase barely moves (velocity is continuous)…
      const before = { ...prev };
      track(frame(sim));
      const first = Math.hypot(prev.x - before.x, prev.y - before.y, prev.z - before.z);
      expect(first).toBeLessThan(0.25);
    }
    run(sim, 2.5, track);
    // …and the fastest move of all (results close-up → intro wide shot) stays a move.
    expect(maxStep).toBeLessThan(1.0);
  });

  it("countdown / playing: tight when the wrestlers are close, wide when they spread out", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, 0.5, 0);
    place(sim, 1, -0.5, 0);
    run(sim, 4);
    const close = distanceOf(composePose(sim.rig, sim.pose));
    expect(close).toBeCloseTo(CAM.minDistance, 1);
    expect(worstWrestlerNdc(sim, sim.pose)).toBeLessThan(0.5);

    place(sim, 0, 5, 0);
    place(sim, 1, -5, 0);
    run(sim, 4);
    const wide = distanceOf(composePose(sim.rig, sim.pose));
    expect(wide).toBeGreaterThan(close + 5);
    expect(wide).toBeLessThanOrEqual(CAM.maxDistance + 1e-6);
    expect(worstWrestlerNdc(sim, sim.pose)).toBeLessThan(0.9);
    expect(pitchOf(sim.pose)).toBeCloseTo(CAM.pitchDegrees * DEG2RAD, 3);
  });

  it("keeps the look-at near the island and still frames a brawl on the rim", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, 5.4, 0.3);
    place(sim, 1, 5.3, -0.6);
    run(sim, 4);
    const pose = composePose(sim.rig, sim.pose);
    expect(lookRadius(pose)).toBeLessThanOrEqual(ARENA.radius * TUNING.targetLimit + 1e-3);
    expect(worstWrestlerNdc(sim, pose)).toBeLessThan(0.85);
    // The island centre is still in the picture.
    const centre = project(pose, sim.aspect, 0, 0, 0);
    expect(Math.max(Math.abs(centre.x), Math.abs(centre.y))).toBeLessThan(1);
  });

  it("keeps a wrestler who is launched far off the island in frame while they are in play", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, -1, 0);
    place(sim, 1, 8.5, 0, 0.2);
    run(sim, 4);
    expect(worstWrestlerNdc(sim, composePose(sim.rig, sim.pose))).toBeLessThan(0.95);
  });

  it("ignores wrestlers who are out or far below the island; with nobody alive it frames the centre", () => {
    const sim = createSim(3);
    setPhase(sim, "playing");
    place(sim, 0, 2, 0);
    place(sim, 1, 2, 1);
    place(sim, 2, -9, 0, -1.5); // falling, already below the picture
    run(sim, 4);
    expect(sim.rig.targetX.value).toBeCloseTo(2, 2);
    expect(sim.rig.targetZ.value).toBeCloseTo(0.5, 2);

    for (const w of sim.runtime.wrestlers) w.status = "out";
    run(sim, 5);
    const pose = composePose(sim.rig, sim.pose);
    expect(lookRadius(pose)).toBeLessThan(1e-3);
    expect(distanceOf(pose)).toBeGreaterThan(CAM.minDistance);
  });

  it("leans toward a wrestler on the edge", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, 0, 0);
    place(sim, 1, 0, 4.8);
    run(sim, 4);
    const base = sim.rig.targetZ.value;
    sim.runtime.wrestlers[1].onEdge = true;
    run(sim, 4);
    expect(sim.rig.targetZ.value - base).toBeCloseTo(CAM.edgeLean, 2);
    expect(Math.abs(sim.rig.targetX.value)).toBeLessThan(1e-6);
  });

  it("final stretch: blends to the lower pitch and the faster orbit, and resets for the next match", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, 2, 0);
    place(sim, 1, -2, 0);
    run(sim, 4);
    expect(pitchOf(sim.pose)).toBeCloseTo(CAM.pitchDegrees * DEG2RAD, 3);
    expect(sim.rig.yawRate).toBeCloseTo(CAM.orbitSpeed, 4);

    onCrumbleWarn(sim.rig);
    frame(sim);
    // A blend, not a cut.
    expect(pitchOf(sim.pose)).toBeGreaterThan((CAM.pitchDegrees - 0.5) * DEG2RAD);
    run(sim, 6);
    expect(pitchOf(sim.pose)).toBeCloseTo(CAM.finalPitchDegrees * DEG2RAD, 3);
    expect(sim.rig.yawRate).toBeCloseTo(CAM.finalOrbitSpeed, 4);
    expect(worstWrestlerNdc(sim, sim.pose)).toBeLessThan(0.8);

    setPhase(sim, "results");
    run(sim, 1);
    setPhase(sim, "intro");
    run(sim, RULES.introSeconds);
    setPhase(sim, "playing");
    run(sim, 6);
    expect(pitchOf(sim.pose)).toBeCloseTo(CAM.pitchDegrees * DEG2RAD, 3);

    // The HUD flag alone is enough too.
    sim.runtime.setHud({ finalStretch: true });
    run(sim, 6);
    expect(pitchOf(sim.pose)).toBeCloseTo(CAM.finalPitchDegrees * DEG2RAD, 3);
  });

  it("results: a close-up orbit around the winner", () => {
    const sim = createSim(2);
    setPhase(sim, "playing");
    place(sim, 0, 3.5, -2);
    place(sim, 1, -1, 1);
    run(sim, 3);
    sim.runtime.winner = 0;
    setPhase(sim, "results");
    const yaw0 = sim.runtime.cameraYaw;
    run(sim, 6);
    const pose = composePose(sim.rig, sim.pose);
    expect(pose.lookX).toBeCloseTo(3.5, 2);
    expect(pose.lookZ).toBeCloseTo(-2, 2);
    expect(distanceOf(pose)).toBeCloseTo(CAM.resultsDistance, 2);
    expect(pitchOf(pose)).toBeLessThan(CAM.finalPitchDegrees * DEG2RAD);
    expect(sim.rig.yawRate).toBeCloseTo(CAM.resultsOrbitSpeed, 4);
    expect(Math.abs(angleDelta(yaw0, sim.runtime.cameraYaw))).toBeGreaterThan(1);
    const ndc = project(pose, sim.aspect, 3.5, REST_Y, -2);
    expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y))).toBeLessThan(0.2);

    // A draw (or a winner who is not on the island) orbits the island centre.
    sim.runtime.winner = null;
    run(sim, 6);
    expect(lookRadius(composePose(sim.rig, sim.pose))).toBeLessThan(1e-3);
  });

  it("backs off in portrait-ish windows so the island still fits", () => {
    const wide = createSim(2, false, WIDE);
    const tall = createSim(2, false, 9 / 16);
    run(wide, 3);
    run(tall, 3);
    const tallPose = composePose(tall.rig, tall.pose);
    expect(distanceOf(tallPose)).toBeGreaterThan(distanceOf(composePose(wide.rig, wide.pose)) + 5);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const ndc = project(
        tallPose,
        tall.aspect,
        Math.sin(a) * ARENA.radius,
        0,
        Math.cos(a) * ARENA.radius,
      );
      expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y))).toBeLessThan(1);
    }

    // The results close-up keeps the winner inside a narrow window as well.
    place(tall, 0, 1, 1);
    tall.runtime.winner = 0;
    setPhase(tall, "results");
    run(tall, 6);
    expect(distanceOf(composePose(tall.rig, tall.pose))).toBeGreaterThan(CAM.resultsDistance);
    expect(worstWrestlerNdc(tall, tall.pose)).toBeLessThan(0.8);
  });
});

describe("camera rig: event reactions", () => {
  function playingSim(reduceMotion = false): Sim {
    const sim = createSim(2, reduceMotion);
    setPhase(sim, "playing");
    place(sim, 0, 1.5, 0);
    place(sim, 1, -1.5, 0);
    run(sim, 4);
    return sim;
  }

  it("a nudge does nothing; a real hit shakes and punches in, then settles", () => {
    const sim = playingSim();
    const rest = distanceOf(composePose(sim.rig, sim.pose));

    onHit(sim.rig, TUNING.hitThreshold - 0.01, false);
    expect(sim.rig.shake).toBe(0);
    frame(sim);
    expect(sim.rig.punch).toBe(0);

    onHit(sim.rig, 1, false);
    expect(sim.rig.shake).toBeCloseTo(CAM.shake.maxOffset);
    let closest = Infinity;
    let maxLookOffset = 0;
    run(sim, CAM.punchIn.seconds, (pose) => {
      closest = Math.min(closest, distanceOf(pose));
      maxLookOffset = Math.max(
        maxLookOffset,
        Math.hypot(pose.lookX - sim.rig.targetX.value, pose.lookZ - sim.rig.targetZ.value),
      );
    });
    expect(rest - closest).toBeGreaterThan(CAM.punchIn.amount * 0.5);
    expect(rest - closest).toBeLessThan(CAM.punchIn.amount + CAM.shake.maxOffset * 2);
    expect(maxLookOffset).toBeGreaterThan(0.02);
    expect(maxLookOffset).toBeLessThanOrEqual(CAM.shake.maxOffset);

    // Exponential decay: gone within a couple of seconds, exactly back at rest.
    run(sim, 0.3);
    expect(sim.rig.shake).toBeLessThan(CAM.shake.maxOffset * 0.1);
    run(sim, 1.5);
    expect(sim.rig.shake).toBe(0);
    expect(sim.rig.punch).toBe(0);
    expect(distanceOf(composePose(sim.rig, sim.pose))).toBeCloseTo(rest, 3);
  });

  it("scales the shake with the hit strength and never lets a weaker hit cut a stronger one short", () => {
    const sim = playingSim();
    onHit(sim.rig, 0.5, false);
    expect(sim.rig.shake).toBeCloseTo(0.5 * CAM.shake.maxOffset);
    onHit(sim.rig, 5, false); // clamped
    expect(sim.rig.shake).toBeCloseTo(CAM.shake.maxOffset);
    const amount = sim.rig.punchAmount;
    onHit(sim.rig, 0.4, false);
    expect(sim.rig.shake).toBeCloseTo(CAM.shake.maxOffset);
    expect(sim.rig.punchAmount).toBe(amount);
  });

  it("crumble gives a medium shake, a big landing a small one", () => {
    const sim = playingSim();
    onLand(sim.rig, TUNING.landMinSpeed - 1, false);
    expect(sim.rig.shake).toBe(0);
    onLand(sim.rig, TUNING.landMinSpeed + 5, false);
    const land = sim.rig.shake;
    expect(land).toBeGreaterThan(0);
    onCrumble(sim.rig, false);
    expect(sim.rig.shake).toBeGreaterThan(land);
    expect(sim.rig.shake).toBeLessThan(CAM.shake.maxOffset);
  });

  it("knockout: requests slow motion and briefly follows the fall, then returns", () => {
    const sim = playingSim();
    const restX = sim.rig.targetX.value;
    const restY = sim.rig.targetY.value;

    sim.runtime.wrestlers[1].status = "out";
    onKnockout(sim.rig, sim.runtime, -7, ARENA.killY, 0, false);
    sim.runtime.advanceReal(DT);
    expect(sim.runtime.timeScale).toBe(CAM.knockoutSlowMo.scale);

    let lowest = Infinity;
    let leftmost = Infinity;
    run(sim, CAM.knockoutFollowSeconds, (pose) => {
      lowest = Math.min(lowest, pose.lookY);
      leftmost = Math.min(leftmost, pose.lookX);
      expect(pose.y).toBeGreaterThanOrEqual(TUNING.minHeight);
    });
    expect(lowest).toBeLessThan(restY - 0.3); // dipped down after the faller
    expect(leftmost).toBeLessThan(restX - 1); // and toward where they went out

    sim.runtime.wrestlers[1].status = "alive";
    run(sim, 4);
    expect(sim.rig.targetX.value).toBeCloseTo(restX, 2);
    expect(sim.rig.targetY.value).toBeCloseTo(restY, 2);
  });

  it("reduced motion: no shake, no punch-in, no slow motion, slower orbit", () => {
    const sim = playingSim(true);
    expect(sim.rig.yawRate).toBeCloseTo(CAM.orbitSpeed * TUNING.reducedOrbitScale, 5);

    onHit(sim.rig, 1, true);
    onCrumble(sim.rig, true);
    onLand(sim.rig, 100, true);
    onKnockout(sim.rig, sim.runtime, -7, ARENA.killY, 0, true);
    sim.runtime.advanceReal(DT);
    expect(sim.runtime.timeScale).toBe(1);
    expect(sim.rig.shake).toBe(0);
    frame(sim);
    expect(sim.rig.punch).toBe(0);

    // A shake that was already running when the setting flipped is dropped at once.
    sim.rig.shake = 0.3;
    sim.rig.punchAmount = 1;
    sim.rig.punchAge = 0;
    frame(sim);
    expect(sim.rig.shake).toBe(0);
    run(sim, 0.3);
    expect(sim.rig.punch).toBe(0);

    const lobby = createSim(2, true);
    run(lobby, 3);
    const normal = createSim(2, false);
    run(normal, 3);
    expect(lobby.rig.yawRate).toBeCloseTo(normal.rig.yawRate * TUNING.reducedOrbitScale, 5);
  });

  it("slow motion never slows the camera: it is driven by real time", () => {
    const sim = playingSim();
    sim.runtime.requestSlowMo(0.1, 10);
    sim.runtime.advanceReal(DT);
    expect(sim.runtime.timeScale).toBe(0.1);
    const yaw0 = sim.runtime.cameraYaw;
    run(sim, 2);
    expect(angleDelta(yaw0, sim.runtime.cameraYaw)).toBeCloseTo(CAM.orbitSpeed * 2, 3);
  });
});
