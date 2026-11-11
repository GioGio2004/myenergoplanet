// Integration tests: the driver against a real Rapier world (same bodies and colliders
// <PhysicsWorld/> mounts), with scripted inputs and stand-in match rules.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { gameConfig, spawnPoint } from "../config";
import type { GameEventOf, GameEventType, PlayerSlot } from "../types";
import { createPhysicsDriver, GHOST_GROUPS, WRESTLER_GROUPS } from "./driver";
import { createTestWorld, initRapier, STEP, type TestWorld } from "./testWorld";

const { arena, wrestler: W, sim } = gameConfig;
const DASH_SPEED = W.maxSpeed * W.dash.speedMultiplier;

let t: TestWorld;
const worlds: TestWorld[] = [];

function world(playerCount = 2, slots?: PlayerSlot[]): TestWorld {
  const created = createTestWorld(playerCount, slots);
  worlds.push(created);
  return created;
}

function eventsOf<T extends GameEventType>(w: TestWorld, type: T): GameEventOf<T>[] {
  return w.events.filter((e): e is GameEventOf<T> => e.type === type);
}

/** Two wrestlers standing at rest on the x axis, `gap` apart (centre to centre), slot 0 on +x. */
function faceOff(gap: number): TestWorld {
  const w = world(2);
  w.spawn(0, gap / 2, 0);
  w.spawn(1, -gap / 2, 0);
  w.run(0.3);
  w.events.length = 0;
  return w;
}

/** Tap dash for one step while pushing the stick along -x (screen left at cameraYaw 0). */
function dashLeft(w: TestWorld, slot: PlayerSlot): void {
  w.inputs[slot].held.x = -1;
  w.inputs[slot].held.dash = true;
  w.run(STEP);
  w.inputs[slot].held.x = 0;
  w.inputs[slot].held.dash = false;
}

beforeAll(async () => {
  await initRapier();
});

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

describe("stepping", () => {
  it("advances real time once per frame and the rules once per world step", () => {
    t = world(2);
    let advances = 0;
    const original = t.runtime.advanceReal.bind(t.runtime);
    t.runtime.advanceReal = (dt: number) => {
      advances++;
      return original(dt);
    };

    t.driver.update(1 / 60, t.stepWorld);
    expect(advances).toBe(1);
    expect(t.stepLengths).toHaveLength(1);
    expect(t.stepLengths[0]).toBeCloseTo(1 / 60, 10);
    expect(t.match.steps).toBe(1);

    // A 30 fps frame: two equal steps of 1/60.
    t.driver.update(1 / 30, t.stepWorld);
    expect(advances).toBe(2);
    expect(t.stepLengths).toHaveLength(3);
    expect(t.stepLengths[2]).toBeCloseTo(1 / 60, 10);
    expect(t.match.steps).toBe(3);
    expect(t.runtime.simTime).toBeCloseTo(3 / 60, 10);
  });

  it("never takes a step longer than 1/hz nor more than maxStepsPerFrame", () => {
    t = world(2);
    t.driver.update(2, t.stepWorld); // a two-second hitch
    expect(t.stepLengths).toHaveLength(sim.maxStepsPerFrame);
    for (const h of t.stepLengths) expect(h).toBeLessThanOrEqual(1 / sim.hz + 1e-12);
  });

  it("follows slow motion with one short step and survives a zero / NaN delta", () => {
    t = world(2);
    t.runtime.requestSlowMo(0.3, 1);
    t.driver.update(1 / 60, t.stepWorld);
    expect(t.stepLengths).toHaveLength(1);
    expect(t.stepLengths[0]).toBeCloseTo(0.3 / 60, 10);

    t.driver.update(0, t.stepWorld);
    t.driver.update(Number.NaN, t.stepWorld);
    t.driver.update(-1, t.stepWorld);
    expect(t.stepLengths).toHaveLength(1);
    expect(t.match.steps).toBe(1);
  });

  it("samples each controllable wrestler's input once per step, and not at all without control", () => {
    t = faceOff(4);
    const before = t.inputs[0].samples;
    t.run(STEP * 5);
    expect(t.inputs[0].samples - before).toBe(5);
    t.match.control = false;
    t.run(STEP * 5);
    expect(t.inputs[0].samples - before).toBe(5);
  });
});

describe("lobby and placement", () => {
  it("parks idle wrestlers and writes their preview pose", () => {
    t = world(3);
    t.driver.update(STEP, t.stepWorld);
    const ws = t.runtime.wrestlers;
    ws.forEach((w, i) => {
      const p = spawnPoint(i, ws.length);
      expect(w.x).toBeCloseTo(p.x, 10);
      expect(w.z).toBeCloseTo(p.z, 10);
      expect(w.y).toBe(W.radius);
      expect(w.vx).toBe(0);
      expect(w.vy).toBe(0);
      expect(w.vz).toBe(0);
      expect(w.grounded).toBe(true);
      // Looking at the centre.
      expect(Math.sin(w.facing)).toBeCloseTo(-p.x / arena.spawnRadius, 6);
      expect(Math.cos(w.facing)).toBeCloseTo(-p.z / arena.spawnRadius, 6);
      expect(t.bodies[w.slot].isEnabled()).toBe(false);
    });
  });

  it("writes preview poses even while time is frozen or the world is not ready", () => {
    t = world(2);
    t.driver.settle();
    expect(t.runtime.wrestlers[0].y).toBe(W.radius);
    expect(t.stepLengths).toHaveLength(0);
    expect(t.match.steps).toBe(0);
  });

  it("indexes spawn points by position in the roster, not by slot", () => {
    t = world(2, [1, 3]);
    t.driver.update(STEP, t.stepWorld);
    const [first, second] = t.runtime.wrestlers;
    expect(first.slot).toBe(1);
    expect(first.x).toBeCloseTo(spawnPoint(0, 2).x, 10);
    expect(first.z).toBeCloseTo(spawnPoint(0, 2).z, 10);
    expect(second.z).toBeCloseTo(spawnPoint(1, 2).z, 10);
  });

  it("performs a teleport: enabled, exactly at the spawn point, at rest, facing the centre", () => {
    t = world(2);
    const w = t.runtime.wrestlers[0];
    w.dashCooldownLeft = 1;
    w.braceCooldownLeft = 1;
    t.spawn(0, 2, -1, 5);
    t.driver.settle();
    expect(w.teleport).toBe(false);
    expect(t.bodies[0].isEnabled()).toBe(true);
    expect(t.bodies[0].translation()).toMatchObject({ x: 2, y: 5, z: -1 });
    expect(t.bodies[0].linvel()).toMatchObject({ x: 0, y: 0, z: 0 });
    expect([w.x, w.y, w.z]).toEqual([2, 5, -1]);
    expect(w.facing).toBeCloseTo(Math.atan2(-2, 1), 10);
    expect(w.dashCooldownLeft).toBe(0);
    expect(w.braceCooldownLeft).toBe(0);
    expect(w.grounded).toBe(false);
  });

  it("places a wrestler the rules respawn during a step before the frame ends", () => {
    t = faceOff(4);
    t.match.onRingOut = "putBack";
    const w = t.runtime.wrestlers[0];
    // Throw it off the island.
    t.bodies[0].setTranslation({ x: 9, y: 0.6, z: 0 }, true);
    t.run(1.2);
    expect(t.match.ringOuts).toEqual([0]);
    expect(w.status).toBe("alive");
    expect(w.teleport).toBe(false);
    expect(Math.hypot(w.x, w.z)).toBeLessThan(0.01);
    expect(w.y).toBeGreaterThan(arena.killY);
  });

  it("drops in, lands once on the island and reports the landing", () => {
    t = world(2);
    t.spawn(0, 1, 2, 4);
    t.run(1.5);
    const w = t.runtime.wrestlers[0];
    expect(w.grounded).toBe(true);
    expect(w.y).toBeGreaterThan(W.radius - 0.02);
    expect(w.y).toBeLessThan(W.radius + 0.02);
    const lands = eventsOf(t, "land");
    expect(lands.length).toBeGreaterThanOrEqual(1);
    expect(lands[0].slot).toBe(0);
    expect(lands[0].x).toBeCloseTo(1, 3);
    expect(lands[0].z).toBeCloseTo(2, 3);
    // Free fall from 4 to 0.6 under gravity 24 is ~12.8 units/s.
    expect(lands[0].speed).toBeGreaterThan(11);
    expect(lands[0].speed).toBeLessThan(14);
    expect(t.bodies[0].mass()).toBeCloseTo(W.mass, 6);
  });
});

describe("movement", () => {
  it("accelerates toward the stick up to maxSpeed and no further", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.y = 1; // up the screen = -z at cameraYaw 0
    let top = 0;
    for (let i = 0; i < 60; i++) {
      t.run(STEP);
      top = Math.max(top, Math.hypot(w.vx, w.vz));
    }
    expect(w.vz).toBeLessThan(0);
    expect(top).toBeLessThanOrEqual(W.maxSpeed);
    expect(top).toBeGreaterThan(W.maxSpeed * 0.9);
    expect(Math.abs(w.vx)).toBeLessThan(0.01);
    // Facing follows the stick: -z is heading π.
    expect(Math.abs(w.facing)).toBeCloseTo(Math.PI, 1);
  });

  it("is weighty: full speed takes several steps, and the body slides on after release", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[0]; // stands at x = +4
    t.inputs[0].held.x = -1;
    t.run(STEP * 3);
    expect(Math.hypot(w.vx, w.vz)).toBeLessThan(W.maxSpeed * 0.4);
    t.run(0.4);
    t.inputs[0].held.x = 0;
    const releasedAt = w.x;
    t.run(0.25);
    expect(w.vx).toBeLessThan(-W.maxSpeed * 0.5);
    t.run(3);
    expect(releasedAt - w.x).toBeGreaterThan(1.5);
    expect(releasedAt - w.x).toBeLessThan(5);
    expect(w.status).toBe("alive");
  });

  it("steers relative to the camera", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[1];
    t.runtime.cameraYaw = Math.PI / 2; // camera on +x: "up the screen" is -x
    t.inputs[1].held.y = 1;
    t.run(0.3);
    expect(w.vx).toBeLessThan(-1);
    expect(Math.abs(w.vz)).toBeLessThan(0.01);
  });

  it("ignores the stick inside the deadzone and when the rules withhold control", () => {
    t = faceOff(4);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.x = W.deadzone * 0.9;
    t.run(0.3);
    expect(Math.hypot(w.vx, w.vz)).toBeLessThan(0.01);

    t.match.control = false;
    t.inputs[0].held.x = 1;
    t.inputs[0].held.dash = true;
    t.run(0.3);
    expect(Math.hypot(w.vx, w.vz)).toBeLessThan(0.01);
    expect(eventsOf(t, "dash")).toHaveLength(0);
  });

  it("does not clamp speed it did not create", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[0]; // stands at x = +4
    t.inputs[0].held.x = -1;
    t.run(STEP);
    // Knocked along its own stick direction, far above walking speed (the driver is the
    // only writer of body velocities in the game, so record and body move together).
    w.vx = -15;
    t.bodies[0].setLinvel({ x: -15, y: 0, z: 0 }, true);
    t.run(STEP);
    expect(w.vx).toBeLessThan(-14.5);
    // …and pushing the other way brakes it rather than snapping it to the cap.
    t.inputs[0].held.x = 1;
    t.run(STEP);
    expect(w.vx).toBeLessThan(-13);
    expect(w.vx).toBeGreaterThan(-14.5);
  });

  it("gives only a little control in the air", () => {
    t = world(2);
    t.spawn(0, 0, 0, 6);
    t.driver.settle();
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.x = 1;
    t.run(STEP * 6);
    expect(w.grounded).toBe(false);
    const air = w.vx;
    expect(air).toBeGreaterThan(0);
    expect(air).toBeLessThan(W.moveAcceleration * STEP * 6 * 0.3);
  });

  it("reports grounded and onEdge", () => {
    t = world(2);
    t.spawn(0, arena.radius - 0.5, 0);
    t.spawn(1, 0, 0);
    t.run(0.3);
    const [edge, centre] = t.runtime.wrestlers;
    expect(edge.grounded).toBe(true);
    expect(edge.onEdge).toBe(true);
    expect(centre.grounded).toBe(true);
    expect(centre.onEdge).toBe(false);
  });
});

describe("dash", () => {
  it("launches along the stick at maxSpeed × multiplier, keeps vy, and announces it", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[0];
    dashLeft(t, 0);
    const dashes = eventsOf(t, "dash");
    expect(dashes).toHaveLength(1);
    expect(dashes[0]).toMatchObject({ slot: 0 });
    expect(dashes[0].dirX).toBeCloseTo(-1, 6);
    expect(dashes[0].dirZ).toBeCloseTo(0, 6);
    expect(w.dashing).toBe(true);
    // One step of the engine's damping has already been applied.
    expect(w.vx).toBeLessThan(-DASH_SPEED * 0.95);
    expect(w.vx).toBeGreaterThanOrEqual(-DASH_SPEED);
    expect(Math.abs(w.vy)).toBeLessThan(0.5);
    expect(w.facing).toBeCloseTo(-Math.PI / 2, 6);
    expect(w.dashCooldownLeft).toBeGreaterThan(W.dash.cooldownSeconds - 2 * STEP);
  });

  it("uses the facing direction when the stick is idle", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[1]; // stands on -x looking at the centre (+x)
    t.inputs[1].held.dash = true;
    t.run(STEP);
    expect(w.vx).toBeGreaterThan(DASH_SPEED * 0.95);
    expect(Math.abs(w.vz)).toBeLessThan(0.01);
    expect(eventsOf(t, "dash")[0].dirX).toBeCloseTo(1, 6);
  });

  it("is a short lunge that eases back to walking speed when it ends", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[0];
    const from = w.x;
    dashLeft(t, 0);
    while (w.dashing) t.run(STEP);
    expect(Math.abs(w.vx)).toBeGreaterThan(W.maxSpeed * 0.85);
    expect(Math.abs(w.vx)).toBeLessThan(W.maxSpeed * 1.15);
    const lunge = from - w.x;
    expect(lunge).toBeGreaterThan(2);
    expect(lunge).toBeLessThan(3.5);
    // Even with no braking at all the whole slide stays well inside the island's diameter.
    t.run(3);
    expect(from - w.x).toBeLessThan(arena.radius);
    expect(w.status).toBe("alive");
  });

  it("is edge-triggered and respects its cooldown", () => {
    t = faceOff(8);
    t.inputs[0].held.dash = true;
    t.run(W.dash.cooldownSeconds + 0.5);
    expect(eventsOf(t, "dash")).toHaveLength(1);
    t.inputs[0].held.dash = false;
    t.run(STEP);
    t.inputs[0].held.dash = true;
    t.run(STEP);
    expect(eventsOf(t, "dash")).toHaveLength(2);
    // Too soon:
    t.inputs[0].held.dash = false;
    t.run(STEP);
    t.inputs[0].held.dash = true;
    t.run(STEP);
    expect(eventsOf(t, "dash")).toHaveLength(2);
  });

  it("steers only weakly in the middle of a dash", () => {
    t = faceOff(8);
    const w = t.runtime.wrestlers[0];
    dashLeft(t, 0);
    t.inputs[0].held.y = 1; // try to swerve toward -z
    t.run(STEP * 6);
    expect(w.dashing).toBe(true);
    expect(Math.abs(w.vz)).toBeLessThan(W.moveAcceleration * STEP * 6 * 0.25);
    expect(Math.abs(w.vx)).toBeGreaterThan(W.maxSpeed);
  });
});

describe("brace", () => {
  it("makes the body heavy and damped while held, and restores it afterwards", () => {
    t = faceOff(4);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.brace = true;
    t.run(STEP);
    expect(w.bracing).toBe(true);
    expect(eventsOf(t, "brace")).toEqual([{ type: "brace", slot: 0, on: true }]);
    expect(t.bodies[0].mass()).toBeCloseTo(W.mass * W.brace.massMultiplier, 5);
    expect(t.bodies[0].linearDamping()).toBeCloseTo(W.brace.linearDamping, 5);

    t.inputs[0].held.brace = false;
    t.run(STEP);
    expect(w.bracing).toBe(false);
    expect(eventsOf(t, "brace")).toHaveLength(2);
    expect(eventsOf(t, "brace")[1].on).toBe(false);
    expect(t.bodies[0].mass()).toBeCloseTo(W.mass, 5);
    expect(t.bodies[0].linearDamping()).toBeCloseTo(W.linearDamping, 5);
    expect(w.braceCooldownLeft).toBeGreaterThan(W.brace.cooldownSeconds - 2 * STEP);
  });

  it("roots the wrestler: the stick does nothing and a dash is refused", () => {
    t = faceOff(4);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.brace = true;
    t.inputs[0].held.x = 1;
    t.run(0.2);
    t.inputs[0].held.dash = true;
    t.run(0.2);
    expect(Math.hypot(w.vx, w.vz)).toBeLessThan(0.01);
    expect(w.x).toBeCloseTo(2, 2);
    expect(eventsOf(t, "dash")).toHaveLength(0);
  });

  it("runs out after maxHoldSeconds and cannot be re-engaged during its cooldown", () => {
    t = faceOff(4);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.brace = true;
    t.run(W.brace.maxHoldSeconds - 0.1);
    expect(w.bracing).toBe(true);
    t.run(0.2);
    expect(w.bracing).toBe(false);
    expect(t.bodies[0].mass()).toBeCloseTo(W.mass, 5);
    t.run(W.brace.cooldownSeconds - 0.3);
    expect(w.bracing).toBe(false);
    t.run(0.4);
    expect(w.bracing).toBe(true);
  });

  it("does not engage in the air", () => {
    t = world(2);
    t.spawn(0, 0, 0, 8);
    t.driver.settle();
    t.inputs[0].held.brace = true;
    t.run(0.3);
    expect(t.runtime.wrestlers[0].grounded).toBe(false);
    expect(t.runtime.wrestlers[0].bracing).toBe(false);
    expect(eventsOf(t, "brace")).toHaveLength(0);
  });

  it("is dropped, with an event, when the wrestler is teleported or parked", () => {
    t = faceOff(4);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.brace = true;
    t.run(STEP * 3);
    expect(w.bracing).toBe(true);
    w.status = "out";
    t.run(STEP);
    expect(w.bracing).toBe(false);
    expect(eventsOf(t, "brace").map((e) => e.on)).toEqual([true, false]);
    expect(t.bodies[0].isEnabled()).toBe(false);

    // Back in: the body must be light again even though it was parked while heavy.
    t.inputs[0].held.brace = false;
    t.spawn(0, 2, 0);
    t.run(STEP * 2);
    expect(t.bodies[0].mass()).toBeCloseTo(W.mass, 5);
    expect(t.bodies[0].linearDamping()).toBeCloseTo(W.linearDamping, 5);
  });
});

describe("impacts", () => {
  it("reports touching pairs to the rules every step, and nothing when apart", () => {
    t = faceOff(4);
    t.run(0.2);
    expect(t.match.contacts).toHaveLength(0);

    // Creep in (below minImpactSpeed) and keep leaning on the other wrestler.
    t.inputs[0].held.x = -0.3;
    t.run(6);
    expect(t.match.contacts.length).toBeGreaterThan(60);
    expect(t.match.contacts[0]).toEqual([0, 1]);
    // A slow shove moves the other wrestler without ever counting as a hit.
    expect(eventsOf(t, "hit")).toHaveLength(0);
    expect(t.runtime.wrestlers[1].x).toBeLessThan(-2.2);
  });

  it("emits one hit for one collision, at the contact point, with a 0..1 strength", () => {
    t = faceOff(3);
    t.inputs[0].held.x = -1;
    t.run(0.7);
    t.inputs[0].held.x = 0;
    t.run(1);
    const hits = eventsOf(t, "hit");
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect([hit.a, hit.b]).toEqual([0, 1]);
    expect(hit.dash).toBe(false);
    expect(hit.braced).toBe(false);
    expect(hit.strength).toBeGreaterThan(0.3);
    expect(hit.strength).toBeLessThan(0.6);
    expect(hit.y).toBeCloseTo(W.radius, 1);
    expect(hit.z).toBeCloseTo(0, 3);
    // Slot 1 stood at x = -1.5: the contact point is one radius to its right.
    expect(hit.x).toBeCloseTo(-1.5 + W.radius, 1);
  });

  it("does not register a gentle touch as a hit", () => {
    t = faceOff(1.5);
    t.inputs[0].held.x = -0.25; // creep in well below minImpactSpeed
    t.run(1.5);
    expect(t.match.contacts.length).toBeGreaterThan(0);
    expect(eventsOf(t, "hit")).toHaveLength(0);
  });

  it("registers one hit per collision even when two wrestlers keep charging each other", () => {
    t = faceOff(2);
    const times: number[] = [];
    t.runtime.on("hit", () => times.push(t.runtime.simTime));
    t.inputs[0].held.x = -1;
    t.inputs[1].held.x = 1;
    t.run(3);
    // They bump, bounce apart, charge again: a handful of distinct collisions, never a burst.
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThan(W.hit.pairCooldownSeconds);
    }
  });

  it("a walking bump pushes the other wrestler away and stops the walker", () => {
    t = faceOff(3);
    const [a, b] = t.runtime.wrestlers;
    t.inputs[0].held.x = -1;
    while (eventsOf(t, "hit").length === 0) t.run(STEP);
    t.inputs[0].held.x = 0;
    expect(b.vx).toBeLessThan(-W.maxSpeed);
    expect(a.vx).toBeGreaterThan(-W.maxSpeed * 0.5);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.vy).toBeLessThanOrEqual(2.2 + 1e-6);
  });

  it("a dash sends a plain wrestler flying while the dasher barely recoils", () => {
    t = faceOff(2);
    const [dasher, victim] = t.runtime.wrestlers;
    dashLeft(t, 0);
    while (eventsOf(t, "hit").length === 0) t.run(STEP);
    const hit = eventsOf(t, "hit")[0];
    expect(hit.dash).toBe(true);
    expect(hit.braced).toBe(false);
    expect(hit.strength).toBe(1);
    expect(victim.vx).toBeLessThan(-DASH_SPEED);
    // The dasher wins the exchange: it keeps drifting forward, slowly.
    expect(dasher.vx).toBeLessThanOrEqual(0.5);
    expect(dasher.vx).toBeGreaterThan(-W.maxSpeed);
    expect(Math.abs(victim.vx)).toBeGreaterThan(Math.abs(dasher.vx) * 4);

    t.run(2);
    expect(victim.status).toBe("out");
    expect(dasher.status).toBe("alive");
    expect(t.match.ringOuts).toEqual([1]);
  });

  it("gives the same knockback whether or not the solver saw the contact first", () => {
    // Different gaps make the first overlap fall at a different point inside a step.
    const speeds: number[] = [];
    for (const gap of [1.25, 1.3, 1.35, 1.4]) {
      const w = faceOff(gap);
      dashLeft(w, 0);
      while (eventsOf(w, "hit").length === 0) w.run(STEP);
      speeds.push(w.runtime.wrestlers[1].vx);
    }
    const fastest = Math.min(...speeds);
    const slowest = Math.max(...speeds);
    expect(slowest / fastest).toBeGreaterThan(0.9);
  });

  it("a braced wrestler holds its ground and the dasher bounces off", () => {
    t = faceOff(2);
    const [dasher, bracer] = t.runtime.wrestlers;
    t.inputs[1].held.brace = true;
    t.run(STEP * 2);
    const stoodAt = bracer.x;
    dashLeft(t, 0);
    while (eventsOf(t, "hit").length === 0) t.run(STEP);
    const hit = eventsOf(t, "hit")[0];
    expect(hit.dash).toBe(true);
    expect(hit.braced).toBe(true);
    expect(dasher.vx).toBeGreaterThan(W.maxSpeed); // thrown back the way it came
    expect(Math.abs(bracer.vx)).toBeLessThan(dasher.vx);
    expect(bracer.vy).toBeLessThan(0.5); // rooted: no hop

    t.run(0.6);
    expect(bracer.bracing).toBe(true);
    expect(stoodAt - bracer.x).toBeLessThan(1.5);
    expect(bracer.status).toBe("alive");
  });

  it("dashing from point-blank contact still counts as an impact", () => {
    t = faceOff(1.21);
    t.run(0.2);
    expect(eventsOf(t, "hit")).toHaveLength(0);
    dashLeft(t, 0);
    t.run(STEP * 2);
    const hits = eventsOf(t, "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0].dash).toBe(true);
    expect(t.runtime.wrestlers[1].vx).toBeLessThan(-DASH_SPEED);
  });

  it("an invulnerable wrestler is passed through, stays on the floor, and is not a contact", () => {
    t = faceOff(2);
    const [dasher, ghost] = t.runtime.wrestlers;
    ghost.invulnerableUntil = t.runtime.simTime + 0.5;
    t.run(STEP);
    expect(t.bodies[1].collider(0).collisionGroups()).toBe(GHOST_GROUPS);
    dashLeft(t, 0);
    t.run(0.3);
    expect(dasher.x).toBeLessThan(ghost.x); // went straight through
    expect(Math.abs(ghost.vx)).toBeLessThan(0.01);
    expect(ghost.y).toBeCloseTo(W.radius, 1);
    expect(ghost.grounded).toBe(true);
    expect(eventsOf(t, "hit")).toHaveLength(0);
    expect(t.match.contacts).toHaveLength(0);

    t.run(0.5);
    expect(t.bodies[1].collider(0).collisionGroups()).toBe(WRESTLER_GROUPS);
  });

  it("handles four wrestlers colliding at once", () => {
    t = world(4);
    const d = 1.6;
    t.spawn(0, d, 0);
    t.spawn(1, -d, 0);
    t.spawn(2, 0, d);
    t.spawn(3, 0, -d);
    t.run(0.3);
    t.inputs[0].held.x = -1;
    t.inputs[1].held.x = 1;
    t.inputs[2].held.y = 1;
    t.inputs[3].held.y = -1;
    t.run(1.5);
    expect(eventsOf(t, "hit").length).toBeGreaterThanOrEqual(2);
    for (const w of t.runtime.wrestlers) {
      expect(Number.isFinite(w.x + w.y + w.z + w.vx + w.vy + w.vz)).toBe(true);
    }
  });
});

describe("ring-out and the island", () => {
  it("has no walls: walking off the edge is a fall and exactly one ring-out report", () => {
    t = world(2);
    t.spawn(0, arena.radius - 1, 0);
    t.spawn(1, 0, 0);
    t.run(0.3);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.x = 1;
    t.run(2.5);
    expect(t.match.ringOuts).toEqual([0]);
    expect(w.status).toBe("out");
    expect(t.bodies[0].isEnabled()).toBe(false);
    // The record keeps where it went out.
    expect(w.y).toBeLessThan(arena.killY);
    expect(w.x).toBeGreaterThan(arena.radius);
    const frozen = w.y;
    t.run(0.5);
    expect(w.y).toBe(frozen);
    expect(t.match.ringOuts).toEqual([0]);
  });

  it("recovers a body the rules never respawned", () => {
    t = world(2);
    t.match.onRingOut = "ignore";
    t.spawn(0, 9, 0);
    t.spawn(1, 0, 0);
    t.run(3);
    const w = t.runtime.wrestlers[0];
    expect(t.match.ringOuts[0]).toBe(0);
    expect(w.status).toBe("alive");
    // Dropped back on its own spawn point instead of falling forever.
    expect(w.y).toBeGreaterThan(arena.killY);
    expect(Math.hypot(w.x, w.z)).toBeCloseTo(arena.spawnRadius, 1);
  });

  it("the floor follows runtime.arenaRadius when the island crumbles and when it resets", () => {
    t = world(2);
    t.spawn(0, 5.5, 0);
    t.spawn(1, 4.4, 0.0);
    t.run(0.4);
    const [outer, inner] = t.runtime.wrestlers;
    expect(outer.grounded).toBe(true);
    expect(t.floor.radius()).toBeCloseTo(arena.radius, 6);

    t.runtime.arenaRadius = 5;
    t.run(1.2);
    expect(t.floor.radius()).toBeCloseTo(5, 6);
    expect(outer.status).toBe("out");
    expect(inner.status).toBe("alive");
    expect(inner.grounded).toBe(true);
    expect(inner.onEdge).toBe(true);

    t.runtime.arenaRadius = arena.radius;
    t.spawn(0, 5.5, 0);
    t.run(0.5);
    expect(t.floor.radius()).toBeCloseTo(arena.radius, 6);
    expect(outer.grounded).toBe(true);
    expect(inner.onEdge).toBe(false);
  });
});

describe("robustness", () => {
  it("tolerates a wrestler whose body is not mounted yet and picks it up later", () => {
    t = world(2);
    // Slot 2 joins: the record exists before any body does.
    t.runtime.setPlayers([
      { slot: 0, name: "a", control: "bot" },
      { slot: 1, name: "b", control: "bot" },
      { slot: 2, name: "c", control: "bot" },
    ]);
    t.run(0.1);
    const late = t.runtime.wrestler(2)!;
    expect(late.y).toBe(W.radius); // lobby preview needs no body

    t.spawn(2, 1, 1, 3);
    t.run(0.2);
    expect(late.teleport).toBe(true); // still pending, nothing thrown

    t.addBody(2);
    t.run(1);
    expect(late.teleport).toBe(false);
    expect(late.grounded).toBe(true);
    expect(late.x).toBeCloseTo(1, 2);
  });

  it("forgets a body that was removed from the world", () => {
    t = faceOff(4);
    t.world.removeRigidBody(t.bodies[1]);
    expect(() => t.run(0.2)).not.toThrow();
    expect(t.runtime.wrestlers[0].grounded).toBe(true);
  });

  it("re-seats a recreated body (StrictMode remount, hot reload) where the wrestler was", () => {
    t = faceOff(4);
    const w = t.runtime.wrestlers[0];
    t.inputs[0].held.brace = true;
    t.run(STEP * 2);
    const { x, z } = w;
    t.world.removeRigidBody(t.bodies[0]);
    t.driver.attachBody(0, null);
    t.run(STEP);
    t.addBody(0); // fresh body: parked below the island, default mass and groups
    t.run(STEP * 3);
    expect(w.status).toBe("alive");
    expect(w.x).toBeCloseTo(x, 2);
    expect(w.z).toBeCloseTo(z, 2);
    expect(w.y).toBeCloseTo(W.radius, 1);
    expect(t.match.ringOuts).toHaveLength(0);
    // The brace that is still held is re-applied to the new body.
    expect(t.bodies[0].mass()).toBeCloseTo(W.mass * W.brace.massMultiplier, 5);
  });

  it("gives a body that joins a running world its configured mass", async () => {
    const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
    t = faceOff(4);
    t.runtime.setPlayers([
      { slot: 0, name: "a", control: "bot" },
      { slot: 1, name: "b", control: "bot" },
      { slot: 2, name: "c", control: "bot" },
    ]);
    t.run(0.2);
    // The way @react-three/rapier does it: create with the default density, set the mass afterwards.
    const body = t.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -30, 0).setCanSleep(false).lockRotations(),
    );
    const collider = t.world.createCollider(RAPIER.ColliderDesc.ball(W.radius), body);
    t.run(0.1);
    collider.setMass(W.mass);
    t.bodies[2] = body;
    t.driver.attachBody(2, body);
    t.run(STEP);
    expect(body.isEnabled()).toBe(false); // idle: parked straight away
    t.spawn(2, 0, 2);
    t.run(STEP * 2);
    expect(body.isEnabled()).toBe(true);
    expect(body.mass()).toBeCloseTo(W.mass, 5);
  });

  it("lets a new driver take over bodies in whatever state the old one left them", () => {
    t = faceOff(4);
    const [a, b] = t.runtime.wrestlers;
    // Slot 0 braces and is invulnerable; slot 1 is knocked out (its body disabled).
    t.inputs[0].held.brace = true;
    a.invulnerableUntil = t.runtime.simTime + 0.2;
    b.status = "out";
    t.run(STEP * 2);
    expect(t.bodies[1].isEnabled()).toBe(false);
    expect(t.bodies[0].collider(0).collisionGroups()).toBe(GHOST_GROUPS);
    const stoodAt = a.x;

    const next = createPhysicsDriver(t.runtime, t.match);
    next.attachFloor(t.floor);
    next.attachBody(0, t.bodies[0]);
    next.attachBody(1, t.bodies[1]);
    t.inputs[0].held.brace = false;
    a.bracing = false; // the old driver's brace is over as far as the record goes
    t.spawn(1, -2, 0);
    for (let i = 0; i < 30; i++) next.update(STEP, t.stepWorld);

    expect(t.bodies[1].isEnabled()).toBe(true);
    expect(b.grounded).toBe(true);
    expect(a.x).toBeCloseTo(stoodAt, 1);
    expect(t.bodies[0].mass()).toBeCloseTo(W.mass, 5);
    expect(t.bodies[0].linearDamping()).toBeCloseTo(W.linearDamping, 5);
    expect(t.bodies[0].collider(0).collisionGroups()).toBe(WRESTLER_GROUPS);
  });

  it("starts clean when the roster is replaced", () => {
    t = faceOff(4);
    t.inputs[0].held.dash = true;
    t.run(STEP * 2);
    expect(t.runtime.wrestlers[0].dashing).toBe(true);

    t.runtime.setPlayers([
      { slot: 0, name: "a", control: "bot" },
      { slot: 1, name: "b", control: "bot" },
    ]);
    t.run(STEP * 2);
    const fresh = t.runtime.wrestlers[0];
    expect(fresh.status).toBe("idle");
    expect(fresh.dashing).toBe(false);
    expect(t.bodies[0].isEnabled()).toBe(false);
    expect(fresh.y).toBe(W.radius);
  });

  it("treats a body with a non-finite state as a ring-out instead of spreading NaN", () => {
    t = faceOff(4);
    t.match.onRingOut = "putBack";
    const w = t.runtime.wrestlers[0];
    t.bodies[0].setLinvel({ x: Number.NaN, y: 0, z: 0 }, true);
    t.run(STEP * 2);
    expect(t.match.ringOuts).toEqual([0]);
    t.run(1);
    for (const v of [w.x, w.y, w.z, w.vx, w.vy, w.vz]) expect(Number.isFinite(v)).toBe(true);
    expect(w.status).toBe("alive");
    expect(w.grounded).toBe(true);
    // The other wrestler is unaffected.
    expect(t.runtime.wrestlers[1].grounded).toBe(true);
  });

  it("allocates no per-slot state lazily: unknown slots and empty rosters are fine", () => {
    t = world(2);
    t.runtime.setPlayers([]);
    expect(() => t.run(0.1)).not.toThrow();
    expect(() => t.driver.attachBody(7 as PlayerSlot, null)).not.toThrow();
  });
});
