"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Liquid Sumo — the Rapier world.
//
// Renders <Physics> with the island floor and one ball body per wrestler, and runs
// the whole simulation from ONE useFrame (see driver.ts for what a step does).
// No visible meshes: other modules draw the game from the WrestlerRuntime records.
//
// Notes on @react-three/rapier 2.2 that shape this file:
// - <Physics paused timeStep="vary"> turns the built-in stepper off; `useRapier().step(h)`
//   then advances the world by exactly one step of h seconds (plus r3r's own
//   bookkeeping), which is what the driver's semi-fixed loop needs.
// - RigidBody / collider props are kept constant. A changing prop would make r3r
//   re-apply the mount pose (a teleport) and overwrite what the driver set imperatively.
// - Bodies and colliders are created in effects and recreated under StrictMode, so
//   they are handed to the driver through callback refs, never cached from render.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CylinderCollider,
  Physics,
  RigidBody,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import { gameConfig } from "../config";
import { useMatch, usePlayers, useRuntime } from "../hooks";
import type { PlayerSlot } from "../types";
import {
  createPhysicsDriver,
  FLOOR_GROUPS,
  WRESTLER_GROUPS,
  type PhysicsDriver,
} from "./driver";

type Triple = [number, number, number];

const { arena, wrestler, sim } = gameConfig;

const GRAVITY: Triple = [0, sim.gravity, 0];

/** Cylinder args are [halfHeight, radius]; the slab's top face sits at y = 0. */
const FLOOR_ARGS: [number, number] = [arena.slabThickness / 2, arena.radius];
const FLOOR_POSITION: Triple = [0, -arena.slabThickness / 2, 0];

const BALL_ARGS: [number] = [wrestler.radius];

/**
 * Where a body sits between mounting and the driver's first step (which parks or
 * places it): far below the island, one spot per slot so new bodies never overlap.
 */
const PARK_POSITIONS: readonly Triple[] = Array.from(
  { length: gameConfig.maxPlayers },
  (_, slot): Triple => [(slot - (gameConfig.maxPlayers - 1) / 2) * 4, -30, 0],
);

/**
 * Run the simulation before default-priority useFrames, so everything that draws
 * from the runtime records this frame sees this frame's physics.
 * (Negative priorities keep R3F's automatic rendering on.)
 */
const SIM_PRIORITY = -1;

/**
 * The physics world: floor, wrestler bodies and the simulation loop.
 * Render it inside the R3F <Canvas>, under <GameProvider>. Pass `debug` for Rapier's
 * collider wireframes.
 */
export function PhysicsWorld({ debug = false }: { debug?: boolean }) {
  return (
    // Rapier's wasm initialises asynchronously and <Physics> suspends meanwhile.
    <Suspense fallback={<LobbyPoses />}>
      <Physics
        timeStep="vary"
        paused
        interpolate={false}
        colliders={false}
        gravity={GRAVITY}
        debug={debug}
      >
        <Simulation />
      </Physics>
    </Suspense>
  );
}

/**
 * Shown while Rapier loads: no world yet, but the lobby line-up (preview poses of
 * idle wrestlers) is already written so the scene is not empty.
 */
function LobbyPoses() {
  const runtime = useRuntime();
  const match = useMatch();
  const driver = useMemo(() => createPhysicsDriver(runtime, match), [runtime, match]);
  useFrame(() => driver.settle(), SIM_PRIORITY);
  return null;
}

function Simulation() {
  const runtime = useRuntime();
  const match = useMatch();
  const players = usePlayers();
  const { step } = useRapier();
  const driver = useMemo(() => createPhysicsDriver(runtime, match), [runtime, match]);

  // The one and only simulation loop.
  useFrame((_, delta) => driver.update(delta, step), SIM_PRIORITY);

  return (
    <>
      <Floor driver={driver} />
      {players.map((w) => (
        <WrestlerBody key={w.slot} slot={w.slot} driver={driver} />
      ))}
    </>
  );
}

/** The island: one fixed cylinder whose radius the driver shrinks as rings crumble. No walls. */
function Floor({ driver }: { driver: PhysicsDriver }) {
  const colliderRef = useRef<RapierCollider | null>(null);

  // Called by r3r every time it (re)creates the collider.
  const onCollider = useCallback(
    (collider: RapierCollider | null) => {
      colliderRef.current = collider;
      driver.attachFloor(collider);
    },
    [driver],
  );

  useEffect(() => {
    // Covers a driver that changed while the collider stayed, and the final unmount.
    driver.attachFloor(colliderRef.current);
    return () => driver.attachFloor(null);
  }, [driver]);

  return (
    <RigidBody type="fixed" colliders={false} position={FLOOR_POSITION}>
      <CylinderCollider
        ref={onCollider}
        args={FLOOR_ARGS}
        friction={wrestler.floorFriction}
        restitution={0}
        collisionGroups={FLOOR_GROUPS}
      />
    </RigidBody>
  );
}

/** One wrestler: a rotation-locked dynamic ball. Everything dynamic is driven through the driver. */
function WrestlerBody({ slot, driver }: { slot: PlayerSlot; driver: PhysicsDriver }) {
  const bodyRef = useRef<RapierRigidBody | null>(null);

  // Called by r3r every time it (re)creates the body.
  const onBody = useCallback(
    (body: RapierRigidBody | null) => {
      bodyRef.current = body;
      driver.attachBody(slot, body);
    },
    [driver, slot],
  );

  useEffect(() => {
    driver.attachBody(slot, bodyRef.current);
    return () => driver.attachBody(slot, null);
  }, [driver, slot]);

  return (
    <RigidBody
      ref={onBody}
      type="dynamic"
      colliders={false}
      position={PARK_POSITIONS[slot]}
      canSleep={false}
      ccd
      lockRotations
      linearDamping={wrestler.linearDamping}
    >
      {/* Mass, friction and bounce live on the collider: RigidBody-level values are ignored or mount-only. */}
      <BallCollider
        args={BALL_ARGS}
        mass={wrestler.mass}
        friction={wrestler.floorFriction}
        restitution={wrestler.restitution}
        collisionGroups={WRESTLER_GROUPS}
      />
    </RigidBody>
  );
}
