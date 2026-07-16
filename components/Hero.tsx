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
  gyroEnabled?: boolean;
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
export function Hero({ obstacles = [], mobileDirRef, gyroEnabled = false, ...props }: HeroProps) {
  const group = useRef<THREE.Group>(null);
  const { gl, camera } = useThree();
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

  // ── Walk Sound ─────────────────────────────────────────────────────────────
  const walkSoundRef = useRef<HTMLAudioElement | null>(null);
  const walkSoundPlayingRef = useRef(false);

  useEffect(() => {
    const audio = new Audio("/gameassets/game-sounds/walk.wav");
    audio.loop = true;
    audio.volume = 0.55;
    walkSoundRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      walkSoundRef.current = null;
      walkSoundPlayingRef.current = false;
    };
  }, []);

  // Manual camera orbit (drag to look around)
  const isDraggingRef = useRef(false);
  const lastPointerXRef = useRef(0);
  const manualOrbitRef = useRef(0); // accumulates user drag input, blended into cameraAngleRef

  // Gyroscope — raw + smoothed values.
  // rawGyro holds the unfiltered DeviceOrientation data.
  // smoothGyro is a low-pass filtered version used for camera orbit.
  // Values are in RADIANS representing additional camera orbit offset.
  const rawGyroRef  = useRef({ yaw: 0, pitch: 0 });
  const smoothGyroRef = useRef({ yaw: 0, pitch: 0 });

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

  // ── Gyroscope Listener ──────────────────────────────────────────
  // Only registered after the user has granted sensor permission on the
  // start screen. Has no effect on desktop (events simply never fire).
  //
  // We track the DELTA from a calibration baseline so the player doesn't
  // need to hold the phone at a precise angle.
  const gyroBaseRef = useRef<{ beta: number; gamma: number } | null>(null);

  useEffect(() => {
    if (!gyroEnabled) return;

    // Reset baseline whenever gyro is (re-)enabled
    gyroBaseRef.current = null;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const beta  = e.beta  ?? 0; // front-to-back tilt  (-180…180)
      const gamma = e.gamma ?? 0; // left-to-right tilt  (-90…90)

      // Capture baseline on first event so the current hold angle = zero
      if (!gyroBaseRef.current) {
        gyroBaseRef.current = { beta, gamma };
        return;
      }

      // Delta from neutral hold position
      const dBeta  = beta  - gyroBaseRef.current.beta;
      const dGamma = gamma - gyroBaseRef.current.gamma;

      // SENSITIVITY: ±15° of tilt maps to ±MAX_ORBIT_RAD of camera orbit.
      // Smaller clamp angle = higher sensitivity (less tilt needed).
      const CLAMP_DEG   = 15;                     // how many ° = full deflection
      const MAX_ORBIT_RAD = Math.PI * 0.35;       // ±63° camera orbit at full tilt

      const normYaw   = Math.max(-1, Math.min(1, dGamma / CLAMP_DEG));
      const normPitch = Math.max(-1, Math.min(1, dBeta  / CLAMP_DEG));

      rawGyroRef.current = {
        yaw:   normYaw   * MAX_ORBIT_RAD,
        pitch: normPitch * MAX_ORBIT_RAD,
      };
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      // Reset so next enable starts fresh
      gyroBaseRef.current = null;
      rawGyroRef.current  = { yaw: 0, pitch: 0 };
      smoothGyroRef.current = { yaw: 0, pitch: 0 };
    };
  }, [gyroEnabled]);

  // ── Manual Camera Orbit (drag) ────────────────────────────────────────────
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

    if (mobileDirRef?.current) {
      inputDir.x += mobileDirRef.current.x;
      inputDir.z += mobileDirRef.current.z;
    }

    const inputMagnitude = Math.min(inputDir.length(), 1.0);
    if (inputMagnitude > 0) inputDir.normalize();

    // 2. Momentum Processing
    // Sprint is KEYBOARD-ONLY (Shift key). The mobile joystick always walks
    // at normal pace regardless of how far the knob is pushed.
    const isSprintInput = keys.current.Shift;
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

    // ── Walk Sound Trigger ─────────────────────────────────────────────────
    // Start/stop the looping footstep sound in sync with physical movement.
    if (isPhysicallyMoving && !walkSoundPlayingRef.current) {
      walkSoundRef.current?.play().catch(() => {});
      walkSoundPlayingRef.current = true;
    } else if (!isPhysicallyMoving && walkSoundPlayingRef.current) {
      walkSoundRef.current?.pause();
      walkSoundRef.current && (walkSoundRef.current.currentTime = 0);
      walkSoundPlayingRef.current = false;
    }

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

    // ── 8. Gyroscope Smooth Orbit ───────────────────────────────────────
    // Apply a low-pass filter to the raw gyro signal each frame.
    // SMOOTH_FACTOR controls responsiveness:
    //   • close to 1.0 → instant / jittery (raw signal)
    //   • close to 0.0 → very sluggish / over-smoothed
    // 8–12 × delta at 60 fps gives a ~130 ms settling time — game-like feel.
    if (gyroEnabled) {
      const SMOOTH = Math.min(1, 10.0 * delta);
      smoothGyroRef.current.yaw = THREE.MathUtils.lerp(
        smoothGyroRef.current.yaw,
        rawGyroRef.current.yaw,
        SMOOTH,
      );
      smoothGyroRef.current.pitch = THREE.MathUtils.lerp(
        smoothGyroRef.current.pitch,
        rawGyroRef.current.pitch,
        SMOOTH,
      );
    }

    // Build the final camera position:
    //  • Start from the base orbit angle (drag / auto-follow)
    //  • Add the smoothed gyro yaw to rotate left/right around the character
    //  • Add the smoothed gyro pitch to adjust camera height/elevation
    const gyroYaw   = gyroEnabled ? smoothGyroRef.current.yaw   : 0;
    const gyroPitch = gyroEnabled ? smoothGyroRef.current.pitch : 0;

    const finalCamAngle = cameraAngleRef.current + gyroYaw;
    // Clamp vertical pitch so camera never clips underground or flips over
    const PITCH_MIN = -0.3; // radians (look slightly down)
    const PITCH_MAX =  0.6; // radians (look up)
    const verticalOffset = 3.0 + THREE.MathUtils.clamp(gyroPitch, PITCH_MIN, PITCH_MAX) * armLengthRef.current * 0.5;

    const finalCamPos = group.current.position
      .clone()
      .add(
        new THREE.Vector3(
          -Math.sin(finalCamAngle) * armLengthRef.current,
          verticalOffset,
          -Math.cos(finalCamAngle) * armLengthRef.current,
        ),
      );

    state.camera.position.lerp(finalCamPos, 5.0 * delta);
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
