"use client";

import { useRef, type JSX } from "react";
import { useFrame, type RootState } from "@react-three/fiber";
import { gameConfig } from "../config";
import { useGameEvent, useGameSettings, useRuntime } from "../hooks";
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

/** Scratch pose: written and consumed within one frame. */
const pose: CameraPose = createPose();

/** Copy the composed pose (and the lens settings, when they drifted) onto the camera. */
function applyPose(camera: RootState["camera"], p: CameraPose): void {
  if ("isPerspectiveCamera" in camera) {
    if (camera.fov !== CAM.fov || camera.near !== TUNING.near || camera.far !== TUNING.far) {
      camera.fov = CAM.fov;
      camera.near = TUNING.near;
      camera.far = TUNING.far;
      // The aspect ratio itself is kept up to date by R3F on every resize.
      camera.updateProjectionMatrix();
    }
  }
  camera.up.set(0, 1, 0);
  camera.position.set(p.x, p.y, p.z);
  camera.lookAt(p.lookX, p.lookY, p.lookZ);
}

/**
 * The camera rig of the game: drives the Canvas' default camera every frame and writes
 * `runtime.cameraYaw` (screen-relative controls depend on it). All behaviour lives in
 * ./rig.ts (pure, tested); this component is only the React / R3F glue.
 *
 * Render it inside the <Canvas>, under <GameProvider>.
 */
export function CameraDirector(): JSX.Element | null {
  const runtime = useRuntime();
  const { reduceMotion } = useGameSettings();

  // Lazily created once; survives StrictMode effect replays.
  const rigRef = useRef<Rig | null>(null);
  if (rigRef.current === null) rigRef.current = createRig();

  useGameEvent("hit", (event) => {
    const rig = rigRef.current;
    if (rig) onHit(rig, event.strength, reduceMotion);
  });

  useGameEvent("knockout", (event) => {
    const rig = rigRef.current;
    if (rig) onKnockout(rig, runtime, event.x, event.y, event.z, reduceMotion);
  });

  useGameEvent("crumbleWarn", () => {
    const rig = rigRef.current;
    if (rig) onCrumbleWarn(rig);
  });

  useGameEvent("crumble", () => {
    const rig = rigRef.current;
    if (rig) onCrumble(rig, reduceMotion);
  });

  useGameEvent("land", (event) => {
    const rig = rigRef.current;
    if (rig) onLand(rig, event.speed, reduceMotion);
  });

  useFrame((state, delta) => {
    const rig = rigRef.current;
    if (!rig) return;
    // REAL frame time (not timeScale-scaled); also guards against NaN / negative deltas.
    const dt = delta > 0 ? Math.min(delta, TUNING.maxDelta) : 0;
    const { width, height } = state.size;
    const aspect = width > 0 && height > 0 ? width / height : TUNING.fallbackAspect;

    updateRig(rig, runtime, dt, aspect, reduceMotion);
    applyPose(state.camera, composePose(rig, pose));
  });

  return null;
}
