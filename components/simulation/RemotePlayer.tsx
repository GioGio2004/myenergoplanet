"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useFBX, useGLTF, useAnimations, Html } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import {
  CHARACTER_URL,
  CHARACTER_SCALE,
  CLIP_URLS,
  type ClipName,
  GUN_URL,
  FADE,
} from "@/components/simulation/anims";
import { mountGunToHand, applySkinTint, tintGun } from "@/components/simulation/gunmount";
import { registerHitable } from "@/components/simulation/shooting";
import { skinById, gunById } from "@/components/simulation/skins";
import type { NetPlayer, NetPose } from "@/components/simulation/net";

// ─── RemotePlayer: another human in the arena ────────────────────────────────
// Renders a friend's avatar from their broadcast pose: lerped position, facing,
// crossfaded animation, their chosen skin tint, a rifle in hand, a name tag,
// and an invisible hitbox so our bullets can find them.
export function RemotePlayer({ player }: { player: NetPlayer }) {
  const character = useFBX(CHARACTER_URL);
  const gun = useGLTF(GUN_URL);

  // Every remote needs its OWN skeleton instance (SkeletonUtils for skinned
  // meshes) and its own materials (for the tint).
  const clone = useMemo(() => SkeletonUtils.clone(character), [character]);

  const [name, setName] = useState<string>("...");

  const idleFbx = useFBX(CLIP_URLS.idle);
  const runFFbx = useFBX(CLIP_URLS["run-forward"]);
  const runBFbx = useFBX(CLIP_URLS["run-back"]);
  const strLFbx = useFBX(CLIP_URLS["strafe-left"]);
  const strRFbx = useFBX(CLIP_URLS["strafe-right"]);
  const fireFbx = useFBX(CLIP_URLS.fire);
  const fireMFbx = useFBX(CLIP_URLS["fire-move"]);
  const reloadFbx = useFBX(CLIP_URLS.reload);
  const jumpFbx = useFBX(CLIP_URLS.jump);
  const runJumpFbx = useFBX(CLIP_URLS["run-jump"]);

  const clips = useMemo(() => {
    const source: Record<ClipName, THREE.Group> = {
      idle: idleFbx,
      "run-forward": runFFbx,
      "run-back": runBFbx,
      "strafe-left": strLFbx,
      "strafe-right": strRFbx,
      fire: fireFbx,
      "fire-move": fireMFbx,
      reload: reloadFbx,
      jump: jumpFbx,
      "run-jump": runJumpFbx,
    };
    const out: THREE.AnimationClip[] = [];
    (Object.keys(source) as ClipName[]).forEach((n) => {
      const clip = source[n].animations[0];
      if (clip) {
        const c = clip.clone();
        c.name = n;
        out.push(c);
      }
    });
    return out;
  }, [idleFbx, runFFbx, runBFbx, strLFbx, strRFbx, fireFbx, fireMFbx, reloadFbx, jumpFbx, runJumpFbx]);

  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const hitbox = useRef<THREE.Mesh>(null);
  const { actions } = useAnimations(clips, group);
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const current = useRef<string>("");
  const lastSkin = useRef<string>("");
  const lastGun = useRef<string>("");
  const gunHolder = useRef<THREE.Group | null>(null);

  // Shadows, culling, gun mount, hitbox registration
  useEffect(() => {
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });
    const holder = mountGunToHand(clone, gun.scene);
    gunHolder.current = holder;
    let unreg: (() => void) | undefined;
    if (hitbox.current) {
      hitbox.current.userData.playerId = player.id;
      unreg = registerHitable(hitbox.current);
    }
    return () => {
      unreg?.();
      holder?.parent?.remove(holder);
      gunHolder.current = null;
      lastGun.current = "";
    };
  }, [clone, gun, player.id]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;

    // Skin + name can change/arrive late — poll cheaply.
    const skinId = (player.getState("skin") as string) ?? "volt";
    if (skinId !== lastSkin.current) {
      lastSkin.current = skinId;
      applySkinTint(clone, skinById(skinId).tint);
    }
    const n = (player.getState("name") as string) ?? "...";
    if (n !== name) setName(n);

    // Gun finish arrives with the join state — apply once it shows up.
    const gunId = (player.getState("gun") as string) ?? "";
    if (gunId && gunId !== lastGun.current && gunHolder.current) {
      lastGun.current = gunId;
      tintGun(gunHolder.current, gunById(gunId).tint);
    }

    const pose = player.getState("s") as NetPose | undefined;
    if (!pose) return;

    // Position: lerp toward the last broadcast (12 Hz → smooth 60 fps motion).
    // A jump bigger than any legit frame of movement is a respawn teleport —
    // snap instead of gliding the body across the arena.
    const jumpX = pose.p[0] - g.position.x;
    const jumpZ = pose.p[2] - g.position.z;
    if (jumpX * jumpX + jumpZ * jumpZ > 25) {
      g.position.set(pose.p[0], pose.p[1], pose.p[2]);
      g.rotation.y = pose.ry;
    } else {
      const k = Math.min(1, 12 * dt);
      g.position.x = THREE.MathUtils.lerp(g.position.x, pose.p[0], k);
      g.position.y = THREE.MathUtils.lerp(g.position.y, pose.p[1], k);
      g.position.z = THREE.MathUtils.lerp(g.position.z, pose.p[2], k);
    }

    // Facing: shortest-path angle lerp
    let dy = pose.ry - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, 10 * dt);

    // Death pose: fall the body over; otherwise crossfade the broadcast clip.
    const b = body.current;
    if (pose.a === "dead") {
      if (b) b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, -Math.PI / 2, Math.min(1, 8 * dt));
    } else {
      if (b) b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, 0, Math.min(1, 8 * dt));
      if (pose.a !== current.current && actionsRef.current[pose.a]) {
        const prev = actionsRef.current[current.current];
        const next = actionsRef.current[pose.a];
        if (prev) prev.fadeOut(FADE);
        next?.reset().fadeIn(FADE).play();
        current.current = pose.a;
      }
    }
  });

  return (
    <group ref={group}>
      <group ref={body}>
        <primitive object={clone} scale={CHARACTER_SCALE} />
      </group>

      {/* Invisible hitbox for hitscan shots */}
      <mesh ref={hitbox} position={[0, 0.9, 0]} visible={false}>
        <boxGeometry args={[0.55, 1.8, 0.55]} />
        <meshBasicMaterial />
      </mesh>

      {/* Name tag */}
      <Html position={[0, 2.15, 0]} center distanceFactor={10} occlude={false}>
        <div
          style={{
            fontFamily: "var(--font-hud), sans-serif",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "#fff",
            background: "rgba(8, 12, 18, 0.65)",
            border: "1px solid rgba(249,115,22,0.5)",
            borderRadius: 6,
            padding: "2px 8px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {name}
        </div>
      </Html>
    </group>
  );
}
