"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { useFrame, useGraph } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";

// Preload the model
useGLTF.preload("/lowpoly_anime_character_cyberstyle.glb");

export function Hero(props: any) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF("/lowpoly_anime_character_cyberstyle.glb");
  
  // Clone scene to properly support SkinnedMeshes animations
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes, materials } = useGraph(clone);
  
  const { actions } = useAnimations(animations, group);

  // Keyboard state
  const keys = useRef<{ [key: string]: boolean }>({
    w: false,
    a: false,
    s: false,
    d: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
  });

  // Action state for animations
  const [action, setAction] = useState<string>("Armature | Idle");

  // Speed of movement
  const speed = 5.0;

  // Handle Animation Changes
  useEffect(() => {
    console.log("Available actions:", actions);
    
    if (actions[action]) {
      actions[action].reset().fadeIn(0.2).play();
      
      return () => {
        actions[action]?.fadeOut(0.2);
      };
    } else {
      console.warn(`Action ${action} not found in model.`);
    }
  }, [action, actions]);

  // Keyboard Event Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (keys.current.hasOwnProperty(e.key) || keys.current.hasOwnProperty(e.key.toLowerCase())) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys.current[key] = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (keys.current.hasOwnProperty(e.key) || keys.current.hasOwnProperty(e.key.toLowerCase())) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys.current[key] = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    if (!group.current) return;

    // 1. Calculate movement vector
    const direction = new THREE.Vector3();

    if (keys.current.w || keys.current.ArrowUp) direction.z -= 1;
    if (keys.current.s || keys.current.ArrowDown) direction.z += 1;
    if (keys.current.a || keys.current.ArrowLeft) direction.x -= 1;
    if (keys.current.d || keys.current.ArrowRight) direction.x += 1;

    // Normalize direction to prevent faster diagonal movement
    if (direction.lengthSq() > 0) {
      direction.normalize();
    }

    const isMoving = direction.lengthSq() > 0;

    // 2. Handle Animations Update
    const nextAction = isMoving ? "Armature | Walk" : "Armature | Idle";
    if (action !== nextAction) {
      setAction(nextAction);
    }

    // 3. Handle Movement & Rotation
    if (isMoving) {
      // Calculate target rotation
      const targetRotation = Math.atan2(direction.x, direction.z);

      // Smoothly interpolate current rotation to target rotation
      let currentRot = group.current.rotation.y;
      
      const PI2 = Math.PI * 2;
      currentRot = currentRot % PI2;
      if (currentRot > Math.PI) currentRot -= PI2;
      if (currentRot < -Math.PI) currentRot += PI2;
      
      let diff = targetRotation - currentRot;
      if (diff > Math.PI) diff -= PI2;
      if (diff < -Math.PI) diff += PI2;

      group.current.rotation.y += diff * 10 * delta;

      // Apply velocity
      group.current.position.addScaledVector(direction, speed * delta);
    }

    // 4. Update Camera position (Isometric follow)
    const offset = new THREE.Vector3(10, 10, 10);
    const targetCameraPos = group.current.position.clone().add(offset);
    
    // Lerp camera for smooth follow
    state.camera.position.lerp(targetCameraPos, 5 * delta);
    state.camera.lookAt(group.current.position);
  });

  return (
    <group ref={group} {...props} dispose={null}>
      <primitive object={clone} castShadow />
    </group>
  );
}
