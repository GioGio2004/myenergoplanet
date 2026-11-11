import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { QUALITY_PRESETS, gameConfig } from "../../config";
import {
  KEY_DIRECTION,
  KEY_DISTANCE,
  KEY_ELEVATION_DEGREES,
  KEY_POSITION,
  KEY_SHADOW_FRUSTUM,
  RIM_POSITION,
  fitShadowFrustum,
  lightDirection,
  shadowTexelSize,
  shadowTuning,
} from "./lighting";

/** The shadow camera of the key light, set up exactly as three.js will use it. */
function keyCamera(): THREE.OrthographicCamera {
  const f = KEY_SHADOW_FRUSTUM;
  const camera = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, f.near, f.far);
  camera.position.set(...KEY_POSITION);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function ndc(camera: THREE.Camera, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).project(camera);
}

const R = gameConfig.arena.radius;
const BODY = gameConfig.wrestler.radius;

describe("lightDirection", () => {
  it("returns a unit vector at the requested elevation", () => {
    const [x, y, z] = lightDirection(46, 52);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect((Math.asin(y) * 180) / Math.PI).toBeCloseTo(46, 9);
  });

  it("points along +Z at azimuth 0 and +X at azimuth 90", () => {
    expect(lightDirection(0, 0)[2]).toBeCloseTo(1, 9);
    expect(lightDirection(0, 90)[0]).toBeCloseTo(1, 9);
  });
});

describe("key light", () => {
  it("comes from about 45 degrees up", () => {
    expect(KEY_ELEVATION_DEGREES).toBeGreaterThanOrEqual(40);
    expect(KEY_ELEVATION_DEGREES).toBeLessThanOrEqual(50);
    expect(Math.hypot(...KEY_POSITION)).toBeCloseTo(KEY_DISTANCE, 9);
    expect(KEY_POSITION[1] / KEY_DISTANCE).toBeCloseTo(KEY_DIRECTION[1], 9);
  });

  it("has the rim light on the opposite side, lower and above the horizon", () => {
    const dot = KEY_POSITION[0] * RIM_POSITION[0] + KEY_POSITION[2] * RIM_POSITION[2];
    expect(dot).toBeLessThan(0);
    expect(RIM_POSITION[1]).toBeGreaterThan(0);
    expect(RIM_POSITION[1]).toBeLessThan(KEY_POSITION[1]);
  });
});

describe("KEY_SHADOW_FRUSTUM", () => {
  const camera = keyCamera();

  it("contains every point of the island floor, rim included", () => {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      for (const radius of [0, R / 2, R, R + BODY]) {
        const p = ndc(camera, Math.sin(a) * radius, 0, Math.cos(a) * radius);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("contains wrestlers standing or respawning anywhere on the island", () => {
    const top = gameConfig.arena.respawnDropHeight + BODY;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      for (const y of [BODY, 2 * BODY, top]) {
        const p = ndc(camera, Math.sin(a) * R, y, Math.cos(a) * R);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("contains the side of the slab under the rim", () => {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p = ndc(camera, Math.sin(a) * R, -gameConfig.arena.slabThickness, Math.cos(a) * R);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a wrestler dropping in from the intro height between the near and far planes", () => {
    // Its shadow lands on the island only when it shares the light-space x/y of a floor
    // point, so only depth matters here.
    const top = gameConfig.arena.introDropHeight + BODY;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p = ndc(camera, Math.sin(a) * R, top, Math.cos(a) * R);
      expect(p.z).toBeGreaterThanOrEqual(-1);
      expect(p.z).toBeLessThanOrEqual(1);
    }
  });

  it("is tight: little of the shadow map is wasted outside the island", () => {
    const f = KEY_SHADOW_FRUSTUM;
    expect(f.right - f.left).toBeLessThan(2 * (R + BODY) + 1.2);
    expect(f.top - f.bottom).toBeLessThan(2 * (R + BODY) + 3.5);
    expect(f.far - f.near).toBeLessThan(30);
    expect(f.near).toBeGreaterThan(1);
  });

  it("resolves a wrestler with plenty of texels at every shadowed preset", () => {
    for (const preset of Object.values(QUALITY_PRESETS)) {
      if (!preset.shadows) continue;
      const texel = shadowTexelSize(KEY_SHADOW_FRUSTUM, preset.shadowMapSize);
      expect((2 * BODY) / texel).toBeGreaterThan(60);
    }
  });
});

describe("fitShadowFrustum", () => {
  const base = {
    elevationDegrees: 45,
    distance: 20,
    radius: 6,
    receiverTop: 1,
    receiverBottom: -1,
    casterTop: 8,
    margin: 0.5,
  };

  it("is symmetric left/right and widens with the margin", () => {
    const a = fitShadowFrustum(base);
    const b = fitShadowFrustum({ ...base, margin: 1 });
    expect(a.left).toBeCloseTo(-a.right, 9);
    expect(b.right - b.left).toBeCloseTo(a.right - a.left + 1, 9);
    expect(b.top).toBeGreaterThan(a.top);
    expect(b.bottom).toBeLessThan(a.bottom);
  });

  it("pulls the near plane toward the light for taller casters only", () => {
    const low = fitShadowFrustum(base);
    const high = fitShadowFrustum({ ...base, casterTop: 14 });
    expect(high.near).toBeLessThan(low.near);
    expect(high.far).toBeCloseTo(low.far, 9);
    expect(high.top).toBeCloseTo(low.top, 9);
  });

  it("never returns a non-positive near plane", () => {
    expect(fitShadowFrustum({ ...base, distance: 2 }).near).toBeGreaterThan(0);
  });
});

describe("shadowTuning", () => {
  it("scales the normal bias with texel size and keeps the blur within the range of the kernel", () => {
    const small = shadowTuning(KEY_SHADOW_FRUSTUM, 512);
    const medium = shadowTuning(KEY_SHADOW_FRUSTUM, 1024);
    const large = shadowTuning(KEY_SHADOW_FRUSTUM, 2048);
    expect(small.normalBias).toBeGreaterThan(medium.normalBias);
    expect(medium.normalBias).toBeGreaterThan(large.normalBias);
    for (const t of [small, medium, large]) {
      expect(t.bias).toBeLessThan(0);
      expect(t.normalBias).toBeGreaterThan(0);
      expect(t.normalBias).toBeLessThanOrEqual(0.08);
      expect(t.radius).toBeGreaterThanOrEqual(1.25);
      expect(t.radius).toBeLessThanOrEqual(4);
    }
    // Larger maps get a wider kernel (in texels) so the penumbra keeps its world size.
    expect(large.radius).toBeGreaterThan(medium.radius);
  });
});
