"use client";

import * as THREE from "three";

// ── Fire effects: tracers, muzzle flash, impact sparks ───────────────────────
// Hitscan shots are instant, so all "bullet" visuals are theatre played after
// the ray already decided the outcome. Everything here is imperative (no React
// per shot) — spawning a tracer must never re-render anything.

interface Tracer {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  life: number;
  ttl: number;
}
interface Spark {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  ttl: number;
  grow: number;
}

class EffectsManager {
  private scene: THREE.Scene;
  private tracers: Tracer[] = [];
  private sparks: Spark[] = [];
  private flashLight: THREE.PointLight;
  private flashSprite: THREE.Sprite;
  private flashTtl = 0;
  private sparkTexture: THREE.Texture;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

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

    this.flashLight = new THREE.PointLight("#ffb066", 0, 7);
    this.flashLight.visible = false;
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
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color: "#ffcf7d",
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, mat, life: 0, ttl: 0.07 });
  }

  impact(at: THREE.Vector3) {
    const mat = new THREE.SpriteMaterial({
      map: this.sparkTexture,
      color: "#ffc27a",
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    sprite.scale.setScalar(0.12);
    this.scene.add(sprite);
    this.sparks.push({ sprite, mat, life: 0, ttl: 0.2, grow: 2.4 });
  }

  muzzleFlash(at: THREE.Vector3) {
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 14;
    this.flashLight.visible = true;
    this.flashSprite.position.copy(at);
    this.flashSprite.visible = true;
    (this.flashSprite.material as THREE.SpriteMaterial).opacity = 1;
    this.flashSprite.scale.setScalar(0.4 + Math.random() * 0.3);
    this.flashTtl = 0.05;
  }

  update(dt: number) {
    // Tracers fade fast
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life += dt;
      t.mat.opacity = Math.max(0, 0.95 * (1 - t.life / t.ttl));
      if (t.life >= t.ttl) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.mat.dispose();
        this.tracers.splice(i, 1);
      }
    }
    // Impact sparks grow + fade
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      const k = s.life / s.ttl;
      s.sprite.scale.setScalar(0.12 + k * s.grow * 0.2);
      s.mat.opacity = Math.max(0, 1 - k);
      if (s.life >= s.ttl) {
        this.scene.remove(s.sprite);
        s.mat.dispose();
        this.sparks.splice(i, 1);
      }
    }
    // Muzzle flash decays
    if (this.flashTtl > 0) {
      this.flashTtl -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 300);
      if (this.flashTtl <= 0) {
        this.flashLight.visible = false;
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
