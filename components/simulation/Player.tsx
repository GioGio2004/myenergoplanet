"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBX, useAnimations, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
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
import { mountGunToHand, applySkinTint, tintGun } from "@/components/simulation/gunmount";
import { skinById, gunById } from "@/components/simulation/skins";
import { isJoined, me, myId, myName, netEvents } from "@/components/simulation/net";

// Preload so the character is ready as soon as the route opens.
useFBX.preload(CHARACTER_URL);
Object.values(CLIP_URLS).forEach((u) => useFBX.preload(u));
useGLTF.preload(GUN_URL);

const BASE_FOV = 55;
const PVP_DAMAGE = 10; // 100 HP → 10 body shots to kill
const REGEN_DELAY_MS = 4000; // untouched for this long → start healing
const REGEN_PER_S = 12; // HP per second while regenerating
const RESPAWN_MS = 3000;
const INVULN_MS = 2000;
const BROADCAST_MS = 80;

// 1v1 duel: fixed opposing corners — host gets [0], guest gets [1]. Both
// players return to their own corner at match start and after every death.
const DUEL_SPAWNS: [number, number][] = [
  [-18, -18],
  [18, 18],
];

const SPAWNS: [number, number][] = [
  [0, 0],
  [18, 18],
  [-18, 18],
  [18, -18],
  [-18, -18],
  [0, 20],
  [20, 0],
  [-20, 0],
];

interface PlayerProps {
  locked: React.RefObject<boolean>;
  online?: boolean;
  skinId?: string;
  gunId?: string;
  /** 1v1 duel spawn corner (0 = host, 1 = guest). Undefined = free-for-all. */
  duelSpawn?: number;
}

// ─── Player: character + TPS controller + rifle + hitscan + networking ───────
export function Player({
  locked,
  online = false,
  skinId = "volt",
  gunId = "desert",
  duelSpawn,
}: PlayerProps) {
  const { gl, camera } = useThree();

  // ── Load body + motion + weapon ──────────────────────────────────────────
  const characterSrc = useFBX(CHARACTER_URL);
  const gun = useGLTF(GUN_URL);
  // Own skeleton instance — the FBX cache is shared with every RemotePlayer.
  const character = useMemo(() => SkeletonUtils.clone(characterSrc), [characterSrc]);

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

  // Shadows, culling, skin tint
  useEffect(() => {
    character.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });
    applySkinTint(character, skinById(skinId).tint);
  }, [character, skinId]);

  // ── Rifle on the right-hand bone (shared mount helper) ───────────────────
  const gunRef = useRef<THREE.Group | null>(null);
  useEffect(() => {
    const holder = mountGunToHand(character, gun.scene);
    if (holder) tintGun(holder, gunById(gunId).tint);
    gunRef.current = holder;
    return () => {
      holder?.parent?.remove(holder);
      gunRef.current = null;
    };
  }, [character, gun, gunId]);

  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null); // rotates when we die
  const { actions } = useAnimations(clips, group);
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

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
  const vy = useRef(0);
  const grounded = useRef(true);
  // multiplayer
  const hp = useRef(100);
  const deadUntil = useRef(0);
  const invulnUntil = useRef(0);
  const lastBroadcast = useRef(0);
  const lastHitAt = useRef(0); // last time we TOOK damage (drives regen delay)
  const roundResetAt = useRef(0); // duel: when to snap back to my corner

  // ── Sounds ───────────────────────────────────────────────────────────────
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

  // ── Duel: start in my own corner, facing the arena centre ────────────────
  useEffect(() => {
    if (duelSpawn === undefined) return;
    const g = group.current;
    if (!g) return;
    const [sx, sz] = DUEL_SPAWNS[duelSpawn % DUEL_SPAWNS.length];
    g.position.set(sx, 0, sz);
    yaw.current = Math.atan2(-sx, -sz);
    g.rotation.y = yaw.current;
  }, [duelSpawn]);

  // ── Network event handlers (online only) ─────────────────────────────────
  useEffect(() => {
    if (!online || !isJoined()) return;

    // Remote players' tracers/impacts appear on our screen
    netEvents.registerShotFx((m) => {
      const from = new THREE.Vector3(...m.f);
      const to = new THREE.Vector3(...m.t);
      fx.muzzleFlash(from);
      fx.tracer(from, to);
      fx.impact(to);
    });

    // Victim-authoritative damage: only apply what targets ME
    netEvents.registerDamage((m) => {
      if (m.t !== myId()) return;
      const now = performance.now();
      if (now < deadUntil.current || now < invulnUntil.current) return;
      lastHitAt.current = now;
      hp.current = Math.max(0, hp.current - m.d);
      simStore.set({ hp: Math.round(hp.current), damagedAt: now });
      if (hp.current <= 0) {
        // die
        deadUntil.current = now + RESPAWN_MS;
        simStore.set({ dead: true });
        const p = me();
        if (p) {
          const deaths = ((p.getState("deaths") as number) ?? 0) + 1;
          p.setState("deaths", deaths, true);
        }
        netEvents.died({ v: myId(), vn: myName(), k: m.k, kn: m.kn });
      }
    });

    // Kill feed for everyone; the killer bumps their own score
    netEvents.registerDied((m) => {
      simStore.pushFeed(`${m.kn}  ▸  ${m.vn}`);
      if (m.k === myId()) {
        const p = me();
        if (p) {
          const kills = ((p.getState("kills") as number) ?? 0) + 1;
          p.setState("kills", kills, true);
        }
      }
      // Duel: ANY death ends the round — both players reset to their corners
      // after the respawn delay (the victim's own respawn handles the rest).
      if (duelSpawn !== undefined) {
        roundResetAt.current = performance.now() + RESPAWN_MS;
      }
    });
  }, [online, duelSpawn]);

  // ── Reload ───────────────────────────────────────────────────────────────
  const tryReload = () => {
    const now = performance.now();
    if (now < reloadingUntil.current) return;
    if (ammo.current >= MAG_SIZE) return;
    const clip = actionsRef.current.reload?.getClip();
    const durationMs = ((clip?.duration ?? 1.5) / 1.15) * 1000;
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
      if (e.code === "Space" && grounded.current && performance.now() >= deadUntil.current) {
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

  // ── One shot ─────────────────────────────────────────────────────────────
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const shoot = () => {
    ammo.current -= 1;
    simStore.set({ ammo: ammo.current });

    if (!raycasterRef.current) raycasterRef.current = new THREE.Raycaster();
    const raycaster = raycasterRef.current;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = RANGE;
    const hits = raycaster.intersectObjects(getHitables(), false);
    const hit = hits[0] ?? null;
    const end =
      hit?.point ??
      raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, RANGE);

    const muzzle = new THREE.Vector3(...MUZZLE_LOCAL);
    if (gunRef.current) gunRef.current.children[0]?.localToWorld(muzzle);
    else muzzle.copy(raycaster.ray.origin);

    fx.muzzleFlash(muzzle);
    fx.tracer(muzzle, end);
    if (hit) fx.impact(hit.point);

    // Broadcast the theatre to friends
    if (online && isJoined()) {
      netEvents.shotFx({ f: [muzzle.x, muzzle.y, muzzle.z], t: [end.x, end.y, end.z] });
    }

    // Damage: shooting-range targets AND other players
    const targetId = hit?.object?.userData?.targetId as string | undefined;
    const playerId = hit?.object?.userData?.playerId as string | undefined;
    if (targetId && hit) {
      damageTarget(targetId, 1, hit.point);
      simStore.set({ hitAt: performance.now() });
      const snd = sounds.current.hit;
      if (snd) {
        snd.currentTime = 0;
        snd.play().catch(() => {});
      }
    } else if (playerId && hit && online && isJoined()) {
      netEvents.damage({ t: playerId, d: PVP_DAMAGE, k: myId(), kn: myName() });
      simStore.set({ hitAt: performance.now() });
      const snd = sounds.current.hit;
      if (snd) {
        snd.currentTime = 0;
        snd.play().catch(() => {});
      }
    }

    pitch.current = Math.min(PITCH_MAX, pitch.current + RECOIL_PITCH);
    yaw.current += (Math.random() - 0.5) * 0.003;

    const pool = sounds.current;
    const a = pool.shot[pool.shotIdx++ % pool.shot.length];
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
  };

  // ── Game loop ────────────────────────────────────────────────────────────
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const now = performance.now();
    const reloading = now < reloadingUntil.current;
    const dead = now < deadUntil.current;

    // Finished dying → respawn. Duel mode: always back to MY corner, facing
    // the centre; free-for-all: a random spawn point.
    if (!dead && simStore.get().dead) {
      const spawn =
        duelSpawn !== undefined
          ? DUEL_SPAWNS[duelSpawn % DUEL_SPAWNS.length]
          : SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
      g.position.set(spawn[0], 0, spawn[1]);
      if (duelSpawn !== undefined) {
        yaw.current = Math.atan2(-spawn[0], -spawn[1]);
        g.rotation.y = yaw.current;
      }
      hp.current = 100;
      ammo.current = MAG_SIZE;
      reloadingUntil.current = 0;
      invulnUntil.current = now + INVULN_MS;
      simStore.set({ dead: false, hp: 100, ammo: MAG_SIZE, reloading: false });
    }

    // Duel round reset: a kill happened — the SURVIVOR also snaps back to
    // their corner with full HP/ammo so every round starts fresh and fair.
    if (roundResetAt.current > 0 && now >= roundResetAt.current) {
      roundResetAt.current = 0;
      if (!dead && duelSpawn !== undefined) {
        const [sx, sz] = DUEL_SPAWNS[duelSpawn % DUEL_SPAWNS.length];
        g.position.set(sx, 0, sz);
        yaw.current = Math.atan2(-sx, -sz);
        g.rotation.y = yaw.current;
        hp.current = 100;
        ammo.current = MAG_SIZE;
        reloadingUntil.current = 0;
        invulnUntil.current = now + INVULN_MS;
        simStore.set({ hp: 100, ammo: MAG_SIZE, reloading: false });
      }
    }

    // Passive regen: untouched for a while → heal back to full.
    if (online && !dead && hp.current < 100 && now - lastHitAt.current > REGEN_DELAY_MS) {
      hp.current = Math.min(100, hp.current + REGEN_PER_S * dt);
      const rounded = Math.round(hp.current);
      if (rounded !== simStore.get().hp) simStore.set({ hp: rounded });
    }

    // Death pose on the body wrapper
    const b = body.current;
    if (b) {
      const target = dead ? -Math.PI / 2 : 0;
      b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, target, Math.min(1, 8 * dt));
    }

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

    // Touch input: look deltas + queued actions
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
      if (grounded.current && !dead) {
        vy.current = JUMP_VELOCITY;
        grounded.current = false;
      }
    }
    if (simInput.reloadQueued) {
      simInput.reloadQueued = false;
      if (!dead) tryReload();
    }

    // 1. Input direction (dead players don't move)
    const lx = dead ? 0 : (keys.current.a ? 1 : 0) + (keys.current.d ? -1 : 0) + simInput.moveX;
    const lz = dead ? 0 : (keys.current.w ? 1 : 0) + (keys.current.s ? -1 : 0) + simInput.moveZ;
    const moving = Math.abs(lx) > 0.15 || Math.abs(lz) > 0.15;

    // 2. Face the camera yaw
    let dy = yaw.current - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    g.rotation.y += dy * Math.min(1, TURN_LERP * dt);

    // 3. Move
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

    // 3b. Vertical motion
    if (!grounded.current) {
      vy.current -= GRAVITY * dt;
      g.position.y += vy.current * dt;
      if (g.position.y <= 0) {
        g.position.y = 0;
        vy.current = 0;
        grounded.current = true;
      }
    }

    // 4. Fire
    const wantFire = firing.current || simInput.firing;
    if (
      locked.current &&
      !dead &&
      wantFire &&
      !reloading &&
      ammo.current > 0 &&
      now - lastShot.current >= FIRE_INTERVAL * 1000
    ) {
      lastShot.current = now;
      shoot();
    }
    if (wantFire && !dead && ammo.current <= 0 && !reloading) tryReload();

    // 5. Animation state machine
    if (dead) {
      play("idle");
    } else if (reloading) {
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

    // 5b. Broadcast pose to friends (~12 Hz, unreliable)
    if (online && isJoined() && now - lastBroadcast.current >= BROADCAST_MS) {
      lastBroadcast.current = now;
      me()?.setState(
        "s",
        {
          p: [g.position.x, g.position.y, g.position.z],
          ry: g.rotation.y,
          a: dead ? "dead" : current.current,
        },
        false,
      );
    }

    // 6. Camera
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
      <group ref={body}>
        <primitive object={character} scale={CHARACTER_SCALE} />
      </group>
    </group>
  );
}
