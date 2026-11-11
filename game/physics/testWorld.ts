// Test-only harness: a real Rapier world laid out exactly like <PhysicsWorld/> builds it,
// a scripted input source and a minimal stand-in for the match rules.
// Imported only by *.test.ts files; nothing in the app bundle references it.

import RAPIER from "@dimforge/rapier3d-compat";
import { gameConfig } from "../config";
import { GameRuntime } from "../runtime";
import type { InputSource, MatchController, PlayerInput, PlayerSetup, PlayerSlot, GameEvent } from "../types";
import {
  createPhysicsDriver,
  FLOOR_GROUPS,
  WRESTLER_GROUPS,
  type PhysicsDriver,
} from "./driver";

const { arena, wrestler, sim } = gameConfig;

export const STEP = 1 / sim.hz;

let ready: Promise<void> | null = null;

/** Initialise the wasm once per test process. */
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Stand-in rules: a clock, a switch for player control, and a log of what physics reported. */
export class FakeMatch implements MatchController {
  control = true;
  /** What to do with a ring-out: knock the wrestler out, drop it back in, or ignore it. */
  onRingOut: "out" | "putBack" | "ignore" = "out";
  readonly contacts: [PlayerSlot, PlayerSlot][] = [];
  readonly ringOuts: PlayerSlot[] = [];
  steps = 0;

  constructor(private readonly runtime: GameRuntime) {}

  start(): boolean {
    return true;
  }
  rematch(): void {}
  toLobby(): void {}

  step(dt: number): void {
    this.runtime.simTime += dt;
    this.runtime.phaseTime += dt;
    this.steps++;
  }

  reportContact(a: PlayerSlot, b: PlayerSlot): void {
    this.contacts.push([a, b]);
  }

  reportRingOut(slot: PlayerSlot): void {
    this.ringOuts.push(slot);
    const w = this.runtime.wrestler(slot);
    if (!w) return;
    if (this.onRingOut === "out") {
      w.status = "out";
    } else if (this.onRingOut === "putBack") {
      w.teleport = true;
      w.spawnX = 0;
      w.spawnY = arena.respawnDropHeight;
      w.spawnZ = 0;
    }
  }

  canControl(slot: PlayerSlot): boolean {
    return this.control && this.runtime.wrestler(slot)?.status === "alive";
  }
}

/** An input source whose held state the test sets directly (world-space when cameraYaw = 0: +y is -z). */
export class ScriptedInput implements InputSource {
  readonly held: PlayerInput = { x: 0, y: 0, dash: false, brace: false };
  samples = 0;

  sample(out: PlayerInput): void {
    out.x = this.held.x;
    out.y = this.held.y;
    out.dash = this.held.dash;
    out.brace = this.held.brace;
    this.samples++;
  }
}

export type TestWorld = {
  runtime: GameRuntime;
  match: FakeMatch;
  driver: PhysicsDriver;
  world: RAPIER.World;
  floor: RAPIER.Collider;
  bodies: RAPIER.RigidBody[];
  inputs: ScriptedInput[];
  events: GameEvent[];
  /** How many times the world was stepped, and with which step lengths. */
  stepLengths: number[];
  stepWorld: (h: number) => void;
  /** Advance by whole fixed steps (one rendered frame each). */
  run: (seconds: number) => void;
  /** Put a wrestler into play at a position, at rest, standing on the island by default. */
  spawn: (slot: PlayerSlot, x: number, z: number, y?: number) => void;
  addBody: (slot: PlayerSlot) => RAPIER.RigidBody;
  dispose: () => void;
};

const NAMES = ["Scarlet", "Stone Blue", "Rice White", "Imperial Gold"];

/** Build a world with `playerCount` idle wrestlers on slots 0..n-1 (or the given slots). */
export function createTestWorld(playerCount = 2, slotList?: PlayerSlot[]): TestWorld {
  const slotsInPlay: PlayerSlot[] = slotList ?? ([0, 1, 2, 3] as PlayerSlot[]).slice(0, playerCount);
  const runtime = new GameRuntime();
  const match = new FakeMatch(runtime);
  const setups: PlayerSetup[] = slotsInPlay.map((slot) => ({ slot, name: NAMES[slot], control: "bot" }));
  runtime.setPlayers(setups);
  runtime.phase = "playing";

  const events: GameEvent[] = [];
  runtime.onAny((e) => events.push(e));

  const inputs: ScriptedInput[] = [];
  for (let slot = 0; slot < gameConfig.maxPlayers; slot++) {
    const source = new ScriptedInput();
    inputs.push(source);
    runtime.inputs[slot] = source;
  }

  const world = new RAPIER.World({ x: 0, y: sim.gravity, z: 0 });

  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -arena.slabThickness / 2, 0),
  );
  const floor = world.createCollider(
    RAPIER.ColliderDesc.cylinder(arena.slabThickness / 2, arena.radius)
      .setFriction(wrestler.floorFriction)
      .setRestitution(0)
      .setCollisionGroups(FLOOR_GROUPS),
    floorBody,
  );

  const driver = createPhysicsDriver(runtime, match);
  driver.attachFloor(floor);

  const bodies: RAPIER.RigidBody[] = [];
  const addBody = (slot: PlayerSlot): RAPIER.RigidBody => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation((slot - 1.5) * 4, -30, 0)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .lockRotations()
        .setLinearDamping(wrestler.linearDamping),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(wrestler.radius)
        .setMass(wrestler.mass)
        .setFriction(wrestler.floorFriction)
        .setRestitution(wrestler.restitution)
        .setCollisionGroups(WRESTLER_GROUPS),
      body,
    );
    bodies[slot] = body;
    driver.attachBody(slot, body);
    return body;
  };
  for (const slot of slotsInPlay) addBody(slot);

  const stepLengths: number[] = [];
  const stepWorld = (h: number): void => {
    stepLengths.push(h);
    world.timestep = h;
    world.step();
  };

  const run = (seconds: number): void => {
    const frames = Math.round(seconds / STEP);
    for (let i = 0; i < frames; i++) driver.update(STEP, stepWorld);
  };

  const spawn = (slot: PlayerSlot, x: number, z: number, y: number = wrestler.radius): void => {
    const w = runtime.wrestler(slot);
    if (!w) throw new Error(`no wrestler in slot ${slot}`);
    w.status = "alive";
    w.teleport = true;
    w.spawnX = x;
    w.spawnY = y;
    w.spawnZ = z;
  };

  return {
    runtime,
    match,
    driver,
    world,
    floor,
    bodies,
    inputs,
    events,
    stepLengths,
    stepWorld,
    run,
    spawn,
    addBody,
    dispose: () => world.free(),
  };
}
