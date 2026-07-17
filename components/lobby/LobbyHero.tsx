"use client";

import { Canvas } from "@react-three/fiber";
import { useFBX, useAnimations, ContactShadows } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CHARACTER_URL, CHARACTER_SCALE } from "@/components/simulation/anims";
import { applySkinTint } from "@/components/simulation/gunmount";
import { skinById } from "@/components/simulation/skins";

// The lobby hero pose is the plain breathing idle — NO gun mounted, just the
// operative standing there (Brawl-Stars style). Distinct from the in-game
// rifle-idle so the hands hang naturally.
const IDLE_URL = "/energosimulation/idle.fbx";

useFBX.preload(CHARACTER_URL);
useFBX.preload(IDLE_URL);

function HeroModel({ skinId }: { skinId: string }) {
  const src = useFBX(CHARACTER_URL);
  // Own skeleton instance (SkeletonUtils for skinned meshes) so tinting this
  // hero never touches the in-game character.
  const clone = useMemo(() => SkeletonUtils.clone(src), [src]);

  const idleFbx = useFBX(IDLE_URL);
  const clips = useMemo(() => {
    const c = idleFbx.animations[0]?.clone();
    if (c) c.name = "idle";
    return c ? [c] : [];
  }, [idleFbx]);

  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(clips, group);

  useEffect(() => {
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
  }, [clone]);

  useEffect(() => {
    applySkinTint(clone, skinById(skinId).tint);
  }, [clone, skinId]);

  useEffect(() => {
    const a = actions.idle;
    a?.reset().fadeIn(0.4).play();
    return () => {
      a?.fadeOut(0.2);
    };
  }, [actions]);

  // Feet dropped to y≈-0.9 so the full body frames around the origin; Mixamo
  // faces +Z, and the camera sits on +Z, so we see the FRONT.
  return (
    <group ref={group} position={[0, -0.92, 0]}>
      <primitive object={clone} scale={CHARACTER_SCALE} />
    </group>
  );
}

// Transparent canvas → the operative floats over the lobby's animated backdrop.
export function LobbyHero({ skinId }: { skinId: string }) {
  return (
    <Canvas
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 0.15, 4.5], fov: 32, near: 0.1, far: 40 }}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.95} />
      <hemisphereLight args={["#ffffff", "#cfe6d6", 0.75]} />
      <directionalLight
        position={[3.5, 6, 4]}
        intensity={1.7}
        color="#fff6e6"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-4, 3, -2]} intensity={0.5} color="#bfe3c9" />
      <Suspense fallback={null}>
        <HeroModel skinId={skinId} />
        <ContactShadows
          position={[0, -0.92, 0]}
          opacity={0.4}
          scale={5}
          blur={2.6}
          far={3}
          color="#0f3d24"
        />
      </Suspense>
    </Canvas>
  );
}
