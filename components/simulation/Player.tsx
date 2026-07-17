"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBX, useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  CHARACTER_URL,
  CHARACTER_SCALE,
  CLIP_URLS,
  type ClipName,
  RUN_SPEED,
  SPRINT_MULT,
  STRAFE_SPEED,
  BACK_SPEED,
  TURN_LERP,
  FADE,
  ARENA_HALF,
  CAM_DIST,
  CAM_HEIGHT,
  CAM_SHOULDER,
  MOUSE_SENS,
  PITCH_MIN,
  PITCH_MAX,
  GUN_URL,
  GUN_SCALE,
  GUN_POS,
  GUN_ROT,
  MUZZLE_LOCAL,
  MAG_SIZE,
  FIRE_INTERVAL,
  RECOIL_PITCH,
  RANGE,
  ADS_DIST,
  ADS_FOV,
  ADS_SPEED_MULT,
  SOUND_URLS,
  JUMP_VELOCITY,
  GRAVITY,
} from "@/components/simulation/anims";
import { collideMove } from "@/components/simulation/colliders";
import { getHitables, damageTarget } from "@/components/simulation/shooting";
import { fx } from "@/components/simulation/effects";
import { simStore } from "@/components/simulation/store";
import { simInput } from "@/components/simulation/input";

// Preload so the character is ready as soon as the route opens.
useFBX.preload(CHARACTER_URL);
Object.values(CLIP_URLS).forEach((u) => useFBX.preload(u));
useGLTF.preload(GUN_URL);

const BASE_FOV = 55;

// ─── Player: character + TPS controller + rifle + hitscan shooting ───────────
export function Player({ locked }: { locked: React.RefObject<boolean> }) {
  const { gl, camera } = useThree();

  // ── Load body + motion + weapon ──────────────────────────────────────────
  const character = useFBX(CHARACTER_URL);
  const gun = useGLTF(GUN_URL);

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
    (Object.keys(source) as ClipName[]).forEach((name) => {
      const clip = source[name].animations[0];
      if (clip) {
        const c = clip.clone();
        c.name = name;
        out.push(c);
      }
    });
    return out;
  }, [idleFbx, runFFbx, runBFbx, strLFbx, strRFbx, fireFbx, fireMFbx, reloadFbx, jumpFbx, runJumpFbx]);

  useEffect(() => {
    character.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });
  }, [character]);

  // ── Mount the rifle on the right-hand bone ───────────────────────────────
  // The gun has no skeleton: parenting it to the hand bone means every clip
  // (run, fire, reload) carries it automatically. Offsets are in bone-local
  // centimetres — tuned constants live in anims.ts.
  const gunRef = useRef<THREE.Group | null>(null);
  useEffect(() => {
    let handBone: THREE.Object3D | null = null;
    character.traverse((o) => {
      // FBXLoader may or may not keep the "mixamorig:" prefix — match loosely.
      if (!handBone && (o as THREE.Bone).isBone && o.name.includes("RightHand") &&
          !o.name.includes("Thumb") && !o.name.includes("Index") &&
          !o.name.includes("Middle") && !o.name.includes("Ring") && !o.name.includes("Pinky")) {
        handBone = o;
      }
    });
    if (!handBone) return;

    const holder = new THREE.Group();
    holder.name = "gun-holder";
    const gunScene = gun.scene.clone(true);
    gunScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    holder.add(gunScene);
    holder.position.set(...GUN_POS);
    holder.rotation.set(...GUN_ROT);
    holder.scale.setScalar(GUN_SCALE);
    (handBone as THREE.Object3D).add(holder);
    gunRef.current = holder;

    return () => {
      (handBone as THREE.Object3D)?.remove(holder);
      gunRef.current = null;
    };
  }, [character, gun]);

  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(clips, group);
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  // Camera handle in a ref — the frame loop assigns .fov, and the React
  // compiler only permits mutation through refs, not render-scope values.
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  useEffect(() => {
    cameraRef.current = camera as THREE.PerspectiveCamera;
  }, [camera]);

  // ── Input / combat state (refs — changes every frame) ────────────────────
  const keys = useRef({ w: false, a: false, s: false, d: false, shift: false });
  const yaw = useRef(Math.PI);
  const pitch = useRef(-0.12);
  const current = useRef<string>("");
  const firing = useRef(false);
  const ads = useRef(false);
  const ammo = useRef(MAG_SIZE);
  const lastShot = useRef(0);
  const reloadingUntil = useRef(0);
  const vy = useRef(0); // vertical velocity (jump/gravity)
  const grounded = useRef(true);

  // ── Sounds (pooled so rapid shots overlap) ───────────────────────────────
  const sounds = useRef<{ shot: HTMLAudioElement[]; shotIdx: number; reload: HTMLAudioElement | null; hit: HTMLAudioElement | null }>({
    shot: [],
    shotIdx: 0,
    reload: null,
    hit: null,
  });
  useEffect(() => {
    const s = sounds.current;
    s.shot = Array.from({ length: 4 }, () => {
      const a = new Audio(SOUND_URLS.shot);
      a.volume = 0.35;
      return a;
    });
    s.reload = new Audio(SOUND_URLS.reload);
    s.reload.volume = 0.6;
    s.hit = new Audio(SOUND_URLS.hit);
    s.hit.volume = 0.55;
    return () => {
      s.shot = [];
      s.reload = null;
      s.hit = null;
    };
  }, []);

  // ── Reload ────────────────────────────────────────────────────────────────
  const tryReload = () => {
    const now = performance.now();
    if (now < reloadingUntil.current) return; // already reloading
    if (ammo.current >= MAG_SIZE) return;
    const clip = actionsRef.current.reload?.getClip();
    const durationMs = ((clip?.duration ?? 1.5) / 1.15) * 1000; // slight speed-up
    reloadingUntil.current = now + durationMs;
    simStore.set({ reloading: true });
    const snd = sounds.current.reload;
    if (snd) {
      snd.currentTime = 0;
      snd.play().catch(() => {});
    }
  };

  // ── Keyboard (e.code — layout-independent) ───────────────────────────────
  useEffect(() => {
    const set = (code: string, v: boolean) => {
      if (code === "KeyW" || code === "ArrowUp") keys.current.w = v;
      else if (code === "KeyS" || code === "ArrowDown") keys.current.s = v;
      else if (code === "KeyA" || code === "ArrowLeft") keys.current.a = v;
      else if (code === "KeyD" || code === "ArrowRight") keys.current.d = v;
      else if (code === "ShiftLeft" || code === "ShiftRight") keys.current.shift = v;
    };
    const down = (e: KeyboardEvent) => {
      set(e.code, true);
      if (e.code === "KeyR") tryReload();
      if (e.code === "Space" && grounded.current) {
        vy.current = JUMP_VELOCITY;
        grounded.current = false;
      }
    };
    const up = (e: KeyboardEvent) => set(e.code, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ── Mouse: look + fire (LMB) + ADS (RMB) ─────────────────────────────────
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      yaw.current -= e.movementX * MOUSE_SENS;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - e.movementY * MOUSE_SENS,
        PITCH_MIN,
        PITCH_MAX,
      );
    };
    const onDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      if (e.button === 0) firing.current = true;
      if (e.button === 2) ads.current = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) firing.current = false;
      if (e.button === 2) ads.current = false;
    };
    const noMenu = (e: Event) => e.preventDefault();
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    el.addEventListener("contextmenu", noMenu);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, [gl]);

  // ── One shot: raycast from the crosshair, theatre from the muzzle ────────
  // (Raycaster lives in a ref: the React compiler forbids mutating memoised
  // values from event/frame callbacks, but ref contents are fair game.)
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const shoot = () => {
    ammo.current -= 1;
    simStore.set({ ammo: ammo.current });

    if (!raycasterRef.current) raycasterRef.current = new THREE.Raycaster();
    const raycaster = raycasterRef.current;

    // Where the crosshair points (camera centre), limited range.
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = RANGE;
    const hits = raycaster.intersectObjects(getHitables(), false);
    const hit = hits[0] ?? null;
    const end =
      hit?.point ??
      raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, RANGE);

    // Muzzle world position (falls back to camera if the gun isn't mounted).
    const muzzle = new THREE.Vector3(...MUZZLE_LOCAL);
    if (gunRef.current) gunRef.current.children[0]?.localToWorld(muzzle);
    else muzzle.copy(raycaster.ray.origin);

    fx.muzzleFlash(muzzle);
    fx.tracer(muzzle, end);
    if (hit) fx.impact(hit.point);

    // Damage + hitmarker
    const targetId = hit?.object?.userData?.targetId as string | undefined;
    if (targetId && hit) {
      damageTarget(targetId, 1, hit.point);
      simStore.set({ hitAt: performance.now() });
      const snd = sounds.current.hit;
      if (snd) {
        snd.currentTime = 0;
        snd.play().catch(() => {});
      }
    }

    // Recoil: kick the camera up a touch with slight horizontal jitter.
    pitch.current = Math.min(PITCH_MAX, pitch.current + RECOIL_PITCH);
    yaw.current += (Math.random() - 0.5) * 0.003;

    const pool = sounds.current;
    const a = pool.shot[pool.shotIdx++ % pool.shot.length];
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
  };

  // ── Game loop ─────────────────────────────────────────────────────────────
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const now = performance.now();
    const reloading = now < reloadingUntil.current;

    // ── Touch input (mobile): consume accumulated look deltas + queued actions
    if (simInput.lookDX !== 0 || simInput.lookDY !== 0) {
      const TOUCH_SENS = 0.0042;
      yaw.current -= simInput.lookDX * TOUCH_SENS;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - simInput.lookDY * TOUCH_SENS,
        PITCH_MIN,
        PITCH_MAX,
      );
      simInput.lookDX = 0;
      simInput.lookDY = 0;
    }
    if (simInput.jumpQueued) {
      simInput.jumpQueued = false;
      if (grounded.current) {
        vy.current = JUMP_VELOCITY;
        grounded.current = false;
      }
    }
    if (simInput.reloadQueued) {
      simInput.reloadQueued = false;
      tryReload();
    }

    // Reload finished this frame?
    if (!reloading && simStore.get().reloading) {
      ammo.current = MAG_SIZE;
      simStore.set({ reloading: false, ammo: MAG_SIZE });
    }

    const play = (name: ClipName, once = false) => {
      if (current.current === name) return;
      const prev = actionsRef.current[current.current];
      const next = actionsRef.current[name];
      if (!next) return;
      if (prev) prev.fadeOut(FADE);
      next.reset().fadeIn(FADE);
      if (once) {
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
      } else {
        next.setLoop(THREE.LoopRepeat, Infinity);
      }
      next.play();
      current.current = name;
    };

    // 1. Input direction (character-local; +Z forward, screen-right = −X).
    //    Keyboard and the mobile joystick are merged; joystick is analogue.
    const lx = (keys.current.a ? 1 : 0) + (keys.current.d ? -1 : 0) + simInput.moveX;
    const lz = (keys.current.w ? 1 : 0) + (keys.current.s ? -1 : 0) + simInput.moveZ;
    const moving = Math.abs(lx) > 0.15 || Math.abs(lz) > 0.15;

    // 2. Body faces the camera yaw.
    let dy = yaw.current - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, TURN_LERP * dt);

    // 3. Move with collide-and-slide; ADS walks slower.
    const wantAds = ads.current || simInput.ads;
    if (moving && locked.current) {
      const dir = new THREE.Vector3(lx, 0, lz)
        .normalize()
        .applyEuler(new THREE.Euler(0, yaw.current, 0));
      const sprint = keys.current.shift && lz > 0 && !wantAds ? SPRINT_MULT : 1;
      let speed = lz > 0 ? RUN_SPEED * sprint : lz < 0 ? BACK_SPEED : STRAFE_SPEED;
      if (wantAds) speed *= ADS_SPEED_MULT;
      const resolved = collideMove(g.position.x, g.position.z, dir.x * speed * dt, dir.z * speed * dt);
      g.position.x = THREE.MathUtils.clamp(resolved.x, -ARENA_HALF, ARENA_HALF);
      g.position.z = THREE.MathUtils.clamp(resolved.z, -ARENA_HALF, ARENA_HALF);
    }

    // 3b. Vertical motion: jump arc under gravity, land at y = 0 (flat arena).
    if (!grounded.current) {
      vy.current -= GRAVITY * dt;
      g.position.y += vy.current * dt;
      if (g.position.y <= 0) {
        g.position.y = 0;
        vy.current = 0;
        grounded.current = true;
      }
    }

    // 4. Full-auto fire while LMB or the FIRE button is held.
    const wantFire = firing.current || simInput.firing;
    if (
      locked.current &&
      wantFire &&
      !reloading &&
      ammo.current > 0 &&
      now - lastShot.current >= FIRE_INTERVAL * 1000
    ) {
      lastShot.current = now;
      shoot();
    }
    if (wantFire && ammo.current <= 0 && !reloading) tryReload(); // auto-reload on empty trigger

    // 5. Animation state machine: reload > airborne > fire > locomotion > idle.
    if (reloading) {
      play("reload", true);
    } else if (!grounded.current) {
      play(moving ? "run-jump" : "jump", true);
    } else if (wantFire && ammo.current > 0 && locked.current) {
      play(moving ? "fire-move" : "fire");
    } else if (moving && locked.current) {
      let clip: ClipName;
      if (Math.abs(lz) >= Math.abs(lx)) clip = lz > 0 ? "run-forward" : "run-back";
      else clip = lx > 0 ? "strafe-left" : "strafe-right";
      play(clip);
      const a = actionsRef.current[current.current];
      if (a) a.timeScale = keys.current.shift && lz > 0 && !wantAds ? 1.2 : 1.0;
    } else {
      play("idle");
    }

    // 6. Camera: over-the-shoulder orbit; ADS pulls in + narrows FOV.
    const dist = wantAds ? ADS_DIST : CAM_DIST;
    const targetFov = wantAds ? ADS_FOV : BASE_FOV;
    const cam = cameraRef.current;
    if (cam && Math.abs(cam.fov - targetFov) > 0.1) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, Math.min(1, 14 * dt));
      cam.updateProjectionMatrix();
    }

    const fwd = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
    const right = new THREE.Vector3(-Math.cos(yaw.current), 0, Math.sin(yaw.current));
    const pivot = g.position.clone().add(new THREE.Vector3(0, CAM_HEIGHT, 0));

    const camPos = pivot
      .clone()
      .addScaledVector(fwd, -dist * Math.cos(pitch.current))
      .addScaledVector(right, CAM_SHOULDER)
      .add(new THREE.Vector3(0, -dist * Math.sin(pitch.current) * 0.9 + 0.15, 0));
    camPos.y = Math.max(camPos.y, 0.25);

    camera.position.lerp(camPos, Math.min(1, 18 * dt));
    const lookTarget = pivot
      .clone()
      .addScaledVector(fwd, 3)
      .add(new THREE.Vector3(0, Math.sin(pitch.current) * 3, 0))
      .addScaledVector(right, CAM_SHOULDER);
    camera.lookAt(lookTarget);
  });

  return (
    <group ref={group}>
      <primitive object={character} scale={CHARACTER_SCALE} />
    </group>
  );
}
