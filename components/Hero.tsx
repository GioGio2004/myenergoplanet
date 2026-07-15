"use client";

import React, { useEffect, useRef, useMemo } from "react";
import { useFrame, useGraph, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";

useGLTF.preload("/lowpoly_anime_character_cyberstyle.glb");

// ─── Types ────────────────────────────────────────────────────────────────────
type ObstacleEntry = { id: string; position: number[] };

interface HeroProps {
  obstacles?: ObstacleEntry[];
  mobileDirRef?: React.MutableRefObject<{ x: number; z: number }>;
  [key: string]: unknown;
}

// ─── AABB Collision ───────────────────────────────────────────────────────────
const MAIN_HW = 1.6;
const MAIN_HD = 1.6;
const CAM_HW = 1.75;
const CAM_HD = 1.6;

function checkCollision(
  pos: THREE.Vector3,
  obstacles: ObstacleEntry[],
): boolean {
  for (const obs of obstacles) {
    const ox = obs.position[0],
      oz = obs.position[2];
    if (Math.abs(pos.x - ox) < MAIN_HW && Math.abs(pos.z - oz) < MAIN_HD)
      return true;
  }
  return false;
}

function isCameraOccluded(
  pos: THREE.Vector3,
  obstacles: ObstacleEntry[],
): boolean {
  for (const obs of obstacles) {
    const ox = obs.position[0],
      oz = obs.position[2];
    if (Math.abs(pos.x - ox) < CAM_HW && Math.abs(pos.z - oz) < CAM_HD)
      return true;
  }
  return false;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function Hero({ obstacles = [], mobileDirRef, ...props }: HeroProps) {
  const group = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const { scene, animations } = useGLTF(
    "/lowpoly_anime_character_cyberstyle.glb",
  );

  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes, materials } = useGraph(clone);
  
  const cloneRef = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, cloneRef);

  // ── State Trackers ─────────────────────────────────────────────────────────
  const keys = useRef<Record<string, boolean>>({
    w: false,
    a: false,
    s: false,
    d: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
    Shift: false,
  });

  const currentAnimRef = useRef<string>("");

  // ── Momentum & Camera Engine Refs ──────────────────────────────────────────
  const currentSpeedRef = useRef(0);
  const currentAngleRef = useRef(0);
  const cameraAngleRef = useRef(0);
  const armLengthRef = useRef(6.0);

  // Tracks camera angle when movement started to prevent circling
  const lockedCameraAngleRef = useRef(0);
  const wasMovingRef = useRef(false);

  // Manual camera orbit (drag to look around)
  const isDraggingRef = useRef(false);
  const lastPointerXRef = useRef(0);
  const manualOrbitRef = useRef(0); // accumulates user drag input, blended into cameraAngleRef

  const WALK_SPEED = 5.0;
  const RUN_SPEED = 9.5;
  const ACCELERATION = 12.0;
  const DECELERATION = 15.0;
  const TARGET_ARM_LENGTH = 4.5;
  const OCCLUDED_ARM_LENGTH = 2.0;

  // ── Keyboard Listeners ────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        keys.current.Shift = true;
        return;
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k in keys.current) keys.current[k] = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        keys.current.Shift = false;
        return;
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k in keys.current) keys.current[k] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ── Manual Camera Orbit (drag) ───────────────────────────────────────────
  // Standard third-person games let you drag/right-click to look around,
  // not just auto-follow the character's back. This restores that.
  useEffect(() => {
    const el = gl.domElement;

    const onDown = (e: PointerEvent) => {
      isDraggingRef.current = true;
      lastPointerXRef.current = e.clientX;
    };
    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastPointerXRef.current;
      lastPointerXRef.current = e.clientX;
      cameraAngleRef.current -= dx * 0.005;
    };
    const onUp = () => {
      isDraggingRef.current = false;
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [gl]);

  // ── Game Loop ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    if (!group.current) return;

    // 1. Get Screen-Space Input Direction
    const inputDir = new THREE.Vector3();
    if (keys.current.w || keys.current.ArrowUp) inputDir.z -= 1;
    if (keys.current.s || keys.current.ArrowDown) inputDir.z += 1;
    if (keys.current.a || keys.current.ArrowLeft) inputDir.x -= 1;
    if (keys.current.d || keys.current.ArrowRight) inputDir.x += 1;

    let mobileMagnitude = 0;
    if (mobileDirRef?.current) {
      inputDir.x += mobileDirRef.current.x;
      inputDir.z += mobileDirRef.current.z;
      mobileMagnitude = Math.hypot(
        mobileDirRef.current.x,
        mobileDirRef.current.z,
      );
    }

    const inputMagnitude = Math.min(inputDir.length(), 1.0);
    if (inputMagnitude > 0) inputDir.normalize();

    // 2. Momentum Processing
    // FIX: sprinting now requires an explicit sprint signal (Shift key, or a
    // mobile joystick pushed near its outer edge) instead of firing just
    // because diagonal keyboard input naturally has magnitude ~1.
    const isSprintInput = keys.current.Shift || mobileMagnitude > 0.9;
    const targetSpeed =
      inputMagnitude > 0
        ? (isSprintInput ? RUN_SPEED : WALK_SPEED) * inputMagnitude
        : 0;
    const momentumRate = inputMagnitude > 0 ? ACCELERATION : DECELERATION;

    currentSpeedRef.current = THREE.MathUtils.lerp(
      currentSpeedRef.current,
      targetSpeed,
      momentumRate * delta,
    );
    const isPhysicallyMoving = currentSpeedRef.current > 0.1;

    // 3. Camera-Relative Character Rotation
    if (inputMagnitude > 0) {
      // Lock the camera reference frame when movement starts, OR update it continuously
      // if the user is actively dragging the screen (which allows mouse/touch steering).
      if (!wasMovingRef.current || isDraggingRef.current) {
        lockedCameraAngleRef.current = cameraAngleRef.current;
        wasMovingRef.current = true;
      }

      const inputAngle = Math.atan2(-inputDir.x, -inputDir.z);
      const targetRot = lockedCameraAngleRef.current + inputAngle;

      let diff = targetRot - currentAngleRef.current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;

      currentAngleRef.current += diff * 12 * delta;
      group.current.rotation.y = currentAngleRef.current;
    } else {
      wasMovingRef.current = false;
    }

    // 4. Handle Physical Animations
    const wantedClip = isPhysicallyMoving ? "Armature|Walk" : "Armature|Idle";
    if (wantedClip !== currentAnimRef.current) {
      const prev = actions[currentAnimRef.current];
      const next = actions[wantedClip];
      if (next) {
        if (prev) prev.fadeOut(0.25);
        next.reset().fadeIn(0.25).play();
        currentAnimRef.current = wantedClip;
      } else if (
        currentAnimRef.current === "" &&
        Object.keys(actions).length > 0
      ) {
        const fallbackKey = Object.keys(actions)[0];
        actions[fallbackKey]?.reset().play();
        currentAnimRef.current = fallbackKey;
      }
    }

    const walkAnim = actions["Armature|Walk"];
    if (walkAnim) {
      const speedRatio = Math.max(0.5, currentSpeedRef.current / WALK_SPEED);
      walkAnim.timeScale = speedRatio;
    }

    // 5. Movement Execution + AABB Sliding Collision
    if (isPhysicallyMoving) {
      const moveX =
        Math.sin(currentAngleRef.current) * currentSpeedRef.current * delta;
      const moveZ =
        Math.cos(currentAngleRef.current) * currentSpeedRef.current * delta;

      const potX = group.current.position.clone();
      potX.x += moveX;
      if (!checkCollision(potX, obstacles)) group.current.position.x = potX.x;

      const potZ = group.current.position.clone();
      potZ.z += moveZ;
      if (!checkCollision(potZ, obstacles)) group.current.position.z = potZ.z;
    }

    // 6. Camera Orbit
    // Auto-align behind the player whenever they are moving, as long as
    // they aren't actively dragging to look around.
    if (!isDraggingRef.current && inputMagnitude > 0) {
      let camDiff = currentAngleRef.current - cameraAngleRef.current;
      while (camDiff < -Math.PI) camDiff += Math.PI * 2;
      while (camDiff > Math.PI) camDiff -= Math.PI * 2;

      cameraAngleRef.current += camDiff * 3.0 * delta;
    }

    // 7. Camera Distance (smoothly pulled in when occluded, instead of snapping)
    let probeCamPos = group.current.position
      .clone()
      .add(
        new THREE.Vector3(
          -Math.sin(cameraAngleRef.current) * armLengthRef.current,
          3.0,
          -Math.cos(cameraAngleRef.current) * armLengthRef.current,
        ),
      );
    const occluded = isCameraOccluded(probeCamPos, obstacles);
    const desiredArmLength = occluded ? OCCLUDED_ARM_LENGTH : TARGET_ARM_LENGTH;
    armLengthRef.current = THREE.MathUtils.lerp(
      armLengthRef.current,
      desiredArmLength,
      6.0 * delta,
    );

    const targetCamPos = group.current.position
      .clone()
      .add(
        new THREE.Vector3(
          -Math.sin(cameraAngleRef.current) * armLengthRef.current,
          3.0,
          -Math.cos(cameraAngleRef.current) * armLengthRef.current,
        ),
      );

    state.camera.position.lerp(targetCamPos, 4.0 * delta);
    state.camera.lookAt(
      group.current.position.clone().add(new THREE.Vector3(0, 1.2, 0)),
    );
  });

  void nodes;
  void materials;

  return (
    <group ref={group} {...props} dispose={null}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.45, 24]} />
        <meshBasicMaterial
          color="#000"
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>
      <primitive ref={cloneRef} object={clone} castShadow receiveShadow />
    </group>
  );
}
