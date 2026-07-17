"use client";

import * as THREE from "three";

// ── Fire effects: tracers, muzzle flash, impact sparks ───────────────────────
// Hitscan shots are instant, so all "bullet" visuals are theatre played after
// the ray already decided the outcome. Everything here is imperative (no React
// per shot) — spawning a tracer must never re-render anything.
//
// Perf: all objects are POOLED and created once up front. Firing a shot only
// flips visibility and writes into preallocated buffers — zero allocations,
// zero geometry/material creation, zero scene-graph add/remove per shot.
// (Per-shot allocation + dispose was the main source of GC hitches on mobile.)

const MAX_TRACERS = 8; // fire interval 120 ms, tracer ttl 70 ms — 8 is plenty
const MAX_SPARKS = 10;

interface Tracer {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  pos: THREE.BufferAttribute;
  life: number;
  ttl: number;
  active: boolean;
}
interface Spark {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  ttl: number;
  grow: number;
  active: boolean;
}

class EffectsManager {
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private flashLight: THREE.PointLight;
  private flashSprite: THREE.Sprite;
  private flashTtl = 0;
  private sparkTexture: THREE.Texture;

  constructor(scene: THREE.Scene) {
    // Radial-gradient dot texture, generated in code (no downloads).
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,230,170,1)");
    grad.addColorStop(0.35, "rgba(255,160,60,0.85)");
    grad.addColorStop(1, "rgba(255,120,20,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this.sparkTexture = new THREE.CanvasTexture(c);

    // The flash light stays PERMANENTLY visible at intensity 0. Toggling a
    // light's `visible` changes the scene's light count, which invalidates the
    // shader program of every lit material → full recompile stutter (brutal on
    // mobile). Driving intensity alone keeps the program stable.
    this.flashLight = new THREE.PointLight("#ffb066", 0, 7);
    scene.add(this.flashLight);

    const flashMat = new THREE.SpriteMaterial({
      map: this.sparkTexture,
      color: "#ffd9a0",
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.flashSprite = new THREE.Sprite(flashMat);
    this.flashSprite.scale.setScalar(0.55);
    this.flashSprite.visible = false;
    scene.add(this.flashSprite);

    // ── Tracer pool ──
    for (let i = 0; i < MAX_TRACERS; i++) {
      const pos = new THREE.BufferAttribute(new Float32Array(6), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", pos);
      const mat = new THREE.LineBasicMaterial({
        color: "#ffcf7d",
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false; // bounds change every shot — skip the check
      scene.add(line);
      this.tracers.push({ line, mat, pos, life: 0, ttl: 0.07, active: false });
    }

    // ── Spark pool ──
    for (let i = 0; i < MAX_SPARKS; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.sparkTexture,
        color: "#ffc27a",
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.sparks.push({ sprite, mat, life: 0, ttl: 0.2, grow: 2.4, active: false });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    // Grab a free slot; if all busy, steal the oldest.
    let t = this.tracers.find((x) => !x.active);
    if (!t) {
      t = this.tracers[0];
      for (const x of this.tracers) if (x.life > t.life) t = x;
    }
    t.pos.setXYZ(0, from.x, from.y, from.z);
    t.pos.setXYZ(1, to.x, to.y, to.z);
    t.pos.needsUpdate = true;
    t.life = 0;
    t.active = true;
    t.mat.opacity = 0.95;
    t.line.visible = true;
  }

  impact(at: THREE.Vector3) {
    let s = this.sparks.find((x) => !x.active);
    if (!s) {
      s = this.sparks[0];
      for (const x of this.sparks) if (x.life > s.life) s = x;
    }
    s.sprite.position.copy(at);
    s.sprite.scale.setScalar(0.12);
    s.life = 0;
    s.active = true;
    s.mat.opacity = 1;
    s.sprite.visible = true;
  }

  muzzleFlash(at: THREE.Vector3) {
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 14;
    this.flashSprite.position.copy(at);
    this.flashSprite.visible = true;
    (this.flashSprite.material as THREE.SpriteMaterial).opacity = 1;
    this.flashSprite.scale.setScalar(0.4 + Math.random() * 0.3);
    this.flashTtl = 0.05;
  }

  update(dt: number) {
    // Tracers fade fast
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.life += dt;
      t.mat.opacity = Math.max(0, 0.95 * (1 - t.life / t.ttl));
      if (t.life >= t.ttl) {
        t.active = false;
        t.line.visible = false;
      }
    }
    // Impact sparks grow + fade
    for (const s of this.sparks) {
      if (!s.active) continue;
      s.life += dt;
      const k = s.life / s.ttl;
      s.sprite.scale.setScalar(0.12 + k * s.grow * 0.2);
      s.mat.opacity = Math.max(0, 1 - k);
      if (s.life >= s.ttl) {
        s.active = false;
        s.sprite.visible = false;
      }
    }
    // Muzzle flash decays (intensity only — never toggle light visibility)
    if (this.flashTtl > 0) {
      this.flashTtl -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 300);
      if (this.flashTtl <= 0) {
        this.flashLight.intensity = 0;
        this.flashSprite.visible = false;
      }
    }
  }
}

let mgr: EffectsManager | null = null;

export function initEffects(scene: THREE.Scene): void {
  if (!mgr) mgr = new EffectsManager(scene);
}
export function updateEffects(dt: number): void {
  mgr?.update(dt);
}
export const fx = {
  tracer: (a: THREE.Vector3, b: THREE.Vector3) => mgr?.tracer(a, b),
  impact: (p: THREE.Vector3) => mgr?.impact(p),
  muzzleFlash: (p: THREE.Vector3) => mgr?.muzzleFlash(p),
};
