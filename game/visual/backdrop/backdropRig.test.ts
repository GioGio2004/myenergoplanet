import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { QUALITY_PRESETS } from "../../config";
import { BackdropRig, type BackdropOptions } from "./backdropRig";
import { lanternCountFor } from "./layout";
import { alphaGammaFor, ditherAmplitudeFor } from "./shaderChunks";

// There is no WebGL in the test environment, so these tests check everything that can
// be checked without compiling: that each shader's declared inputs are actually fed by
// its material and geometry, the draw-call budget, draw order and resource lifetime.

const OPTIONS: BackdropOptions[] = [
  { clouds: QUALITY_PRESETS.low.clouds, postProcessing: false, lowDetail: true },
  { clouds: QUALITY_PRESETS.medium.clouds, postProcessing: false, lowDetail: false },
  { clouds: QUALITY_PRESETS.high.clouds, postProcessing: true, lowDetail: false },
];

/** Names three.js declares for every (non-raw) ShaderMaterial. */
const BUILT_IN_ATTRIBUTES = new Set(["position", "normal", "uv"]);

type ShaderMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

function meshes(rig: BackdropRig): ShaderMesh[] {
  const found: ShaderMesh[] = [];
  rig.group.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object as ShaderMesh);
  });
  return found;
}

function byName(rig: BackdropRig, name: string): ShaderMesh {
  const mesh = meshes(rig).find((m) => m.name === name);
  if (!mesh) throw new Error(`no mesh named ${name}`);
  return mesh;
}

/** `uniform vec3 uFoo;` / `attribute vec4 aBar;` / `varying vec2 vBaz;` → Map(name → type). */
function declarations(source: string, keyword: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = new RegExp(`^\\s*${keyword}\\s+(\\w+)\\s+(\\w+)\\s*;`, "gm");
  for (const match of source.matchAll(pattern)) result.set(match[2], match[1]);
  return result;
}

function stripComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function count(source: string, char: string): number {
  return source.split(char).length - 1;
}

describe("BackdropRig", () => {
  it("stays within the draw-call budget at every preset", () => {
    for (const options of OPTIONS) {
      const rig = new BackdropRig(options);
      expect(meshes(rig).length).toBeLessThanOrEqual(10);
      expect(meshes(rig).length).toBe(7);
      rig.dispose();
    }
  });

  it("feeds every uniform, attribute and varying its shaders declare", () => {
    for (const options of OPTIONS) {
      const rig = new BackdropRig(options);
      for (const mesh of meshes(rig)) {
        const { material, geometry } = mesh;
        const vertex = stripComments(material.vertexShader);
        const fragment = stripComments(material.fragmentShader);

        const uniforms = new Map([
          ...declarations(vertex, "uniform"),
          ...declarations(fragment, "uniform"),
        ]);
        for (const [name, type] of uniforms) {
          const uniform = material.uniforms[name];
          expect(uniform, `${mesh.name}: uniform ${name} has no value`).toBeDefined();
          const value: unknown = uniform.value;
          if (type === "float") expect(typeof value, `${mesh.name}.${name}`).toBe("number");
          if (type === "vec3") expect(value, `${mesh.name}.${name}`).toBeInstanceOf(THREE.Color);
          if (type === "sampler2D") expect(value, `${mesh.name}.${name}`).toBeInstanceOf(THREE.Texture);
        }
        for (const name of Object.keys(material.uniforms)) {
          expect(uniforms.has(name), `${mesh.name}: uniform ${name} is never declared`).toBe(true);
        }

        const itemSizes: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
        for (const [name, type] of declarations(vertex, "attribute")) {
          const attribute = geometry.getAttribute(name);
          expect(attribute, `${mesh.name}: attribute ${name} missing`).toBeDefined();
          expect(attribute.itemSize, `${mesh.name}.${name}`).toBe(itemSizes[type]);
        }
        for (const name of Object.keys(geometry.attributes)) {
          if (BUILT_IN_ATTRIBUTES.has(name)) continue;
          expect(vertex.includes(name), `${mesh.name}: attribute ${name} is never read`).toBe(true);
        }
        // Attributes may only be read in the vertex stage.
        expect(declarations(fragment, "attribute").size).toBe(0);

        const out = declarations(vertex, "varying");
        const into = declarations(fragment, "varying");
        expect([...into.keys()].sort(), `${mesh.name}: varyings`).toEqual([...out.keys()].sort());
        for (const [name, type] of into) expect(out.get(name), `${mesh.name}.${name}`).toBe(type);

        for (const [name, value] of Object.entries(material.defines ?? {})) {
          expect(
            (vertex + fragment).includes(name),
            `${mesh.name}: define ${name} is never used`,
          ).toBe(true);
          if (value !== "") expect(Number.isFinite(Number(value)), `${name}=${value}`).toBe(true);
        }
      }
      rig.dispose();
    }
  });

  it("has syntactically balanced shaders that end with the output chunks", () => {
    const rig = new BackdropRig(OPTIONS[2]);
    for (const mesh of meshes(rig)) {
      for (const source of [mesh.material.vertexShader, mesh.material.fragmentShader]) {
        const code = stripComments(source);
        expect(count(code, "{"), mesh.name).toBe(count(code, "}"));
        expect(count(code, "("), mesh.name).toBe(count(code, ")"));
        expect(code).toMatch(/void\s+main\s*\(\s*\)/);
        // Template placeholders must all have been substituted.
        expect(code).not.toContain("${");
        expect(code).not.toContain("undefined");
        // pow() of a possibly negative base and reversed smoothstep edges are undefined in GLSL.
        expect(code).not.toMatch(/smoothstep\(\s*([0-9.]+)\s*,\s*-/);
      }
      const fragment = stripComments(mesh.material.fragmentShader);
      expect(fragment).toContain("gl_FragColor");
      expect(fragment.indexOf("#include <colorspace_fragment>")).toBeGreaterThan(
        fragment.indexOf("#include <tonemapping_fragment>"),
      );
      expect(stripComments(mesh.material.vertexShader)).toContain("gl_Position");
    }
    rig.dispose();
  });

  it("opts every material out of renderer tone mapping and scene fog", () => {
    const rig = new BackdropRig(OPTIONS[1]);
    for (const mesh of meshes(rig)) {
      expect(mesh.material.toneMapped, mesh.name).toBe(false);
      expect(mesh.material.fog, mesh.name).toBe(false);
      expect(mesh.frustumCulled, mesh.name).toBe(false);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
    rig.dispose();
  });

  it("draws the sky first and the translucent layers back to front without writing depth", () => {
    const rig = new BackdropRig(OPTIONS[1]);
    const sky = byName(rig, "BackdropSky");
    expect(sky.material.transparent).toBe(false);
    expect(sky.material.depthTest).toBe(false);
    expect(sky.material.depthWrite).toBe(false);
    expect(sky.material.side).toBe(THREE.BackSide);

    const order = [
      "BackdropMountains",
      "BackdropMistFloor",
      "BackdropIslandGlow",
      "BackdropClouds",
      "BackdropLanternHalos",
    ].map((name) => byName(rig, name));
    for (let i = 0; i < order.length; i++) {
      expect(order[i].material.transparent, order[i].name).toBe(true);
      expect(order[i].material.depthWrite, order[i].name).toBe(false);
      expect(order[i].material.depthTest, order[i].name).toBe(true);
      // Before every other translucent object in the game (default render order 0).
      expect(order[i].renderOrder).toBeLessThan(0);
      expect(order[i].renderOrder).toBeGreaterThan(sky.renderOrder);
      if (i > 0) expect(order[i].renderOrder).toBeGreaterThan(order[i - 1].renderOrder);
    }

    const lanterns = byName(rig, "BackdropLanterns");
    expect(lanterns.material.transparent).toBe(false);
    expect(lanterns.material.depthWrite).toBe(true);
    expect(byName(rig, "BackdropLanternHalos").material.blending).toBe(THREE.AdditiveBlending);
    rig.dispose();
  });

  it("instances exactly the requested clouds and four to six lanterns", () => {
    for (const options of OPTIONS) {
      const rig = new BackdropRig(options);
      const clouds = byName(rig, "BackdropClouds").geometry as THREE.InstancedBufferGeometry;
      expect(clouds.instanceCount).toBe(options.clouds);
      expect(clouds.getAttribute("aOrbit").count).toBe(options.clouds);

      const expected = lanternCountFor(options.clouds);
      for (const name of ["BackdropLanterns", "BackdropLanternHalos"]) {
        const geometry = byName(rig, name).geometry as THREE.InstancedBufferGeometry;
        expect(geometry.instanceCount).toBe(expected);
        expect(geometry.getAttribute("aOrbit").count).toBe(expected);
        expect(geometry.getAttribute("aLook").count).toBe(expected);
      }
      // Bodies and halos must sit on the same lanterns.
      expect(byName(rig, "BackdropLanterns").geometry.getAttribute("aOrbit")).toBe(
        byName(rig, "BackdropLanternHalos").geometry.getAttribute("aOrbit"),
      );
      rig.dispose();
    }
  });

  it("builds a lantern out of paper and trim with unit normals", () => {
    const rig = new BackdropRig(OPTIONS[1]);
    const geometry = byName(rig, "BackdropLanterns").geometry;
    const part = geometry.getAttribute("aPart");
    const normal = geometry.getAttribute("normal");
    const position = geometry.getAttribute("position");
    expect(geometry.getIndex()).not.toBeNull();
    let paper = 0;
    let trim = 0;
    for (let i = 0; i < part.count; i++) {
      if (part.getX(i) === 0) paper++;
      else trim++;
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
      // Small: nothing farther than a wrestler's diameter from the centre.
      expect(Math.hypot(position.getX(i), position.getY(i), position.getZ(i))).toBeLessThan(1);
    }
    expect(paper).toBeGreaterThan(50);
    expect(trim).toBeGreaterThan(20);
    rig.dispose();
  });

  it("builds three closed mountain rings with finite geometry", () => {
    const rig = new BackdropRig(OPTIONS[1]);
    const geometry = byName(rig, "BackdropMountains").geometry;
    const position = geometry.getAttribute("position");
    const ridge = geometry.getAttribute("aRidge");
    const tone = geometry.getAttribute("aTone");
    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    expect(index!.count % 3).toBe(0);
    for (let i = 0; i < index!.count; i++) expect(index!.getX(i)).toBeLessThan(position.count);

    const radii = new Set<number>();
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i));
      expect(Number.isFinite(position.getY(i))).toBe(true);
      radii.add(Math.round(r));
      expect(ridge.getX(i)).toBeGreaterThanOrEqual(0); // never above its own ridge line
      expect(tone.getW(i)).toBeGreaterThan(0);
      expect(tone.getW(i)).toBeLessThanOrEqual(1);
    }
    expect(radii.size).toBe(3);
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(60);
      expect(r).toBeLessThanOrEqual(110);
    }
    rig.dispose();
  });

  it("drives every animated material from one shared clock", () => {
    const rig = new BackdropRig(OPTIONS[1]);
    const clocks = meshes(rig)
      .map((mesh) => mesh.material.uniforms.uTime)
      .filter((uniform) => uniform !== undefined);
    expect(clocks.length).toBeGreaterThanOrEqual(5);
    for (const clock of clocks) expect(clock).toBe(clocks[0]);

    rig.update(0.25);
    rig.update(0.5);
    expect(clocks[0].value).toBeCloseTo(0.75, 9);
    rig.update(0);
    expect(clocks[0].value).toBeCloseTo(0.75, 9);
    rig.dispose();
  });

  it("keeps the clock bounded over a very long session", () => {
    const rig = new BackdropRig(OPTIONS[0]);
    const clock = byName(rig, "BackdropClouds").material.uniforms.uTime;
    for (let i = 0; i < 100; i++) rig.update(1000);
    expect(clock.value).toBeGreaterThanOrEqual(0);
    expect(clock.value).toBeLessThanOrEqual(36000);
    rig.dispose();
  });

  it("adapts blending and dithering to the post-processing path", () => {
    for (const options of OPTIONS) {
      const rig = new BackdropRig(options);
      const uniforms = byName(rig, "BackdropMistFloor").material.uniforms;
      expect(uniforms.uAlphaGamma.value).toBe(alphaGammaFor(options.postProcessing));
      expect(uniforms.uDither.value).toBe(ditherAmplitudeFor(options.postProcessing));
      rig.dispose();
    }
    // Under the composer the palette colours are pushed through the inverse tone curve.
    const plain = new BackdropRig(OPTIONS[1]);
    const post = new BackdropRig(OPTIONS[2]);
    expect(post.fogColor.b).toBeGreaterThan(plain.fogColor.b);
    expect(plain.fogColor.getHexString()).toBe("03203e");
    // Lanterns go HDR only where a bloom pass can pick them up.
    expect(byName(plain, "BackdropLanterns").material.uniforms.uGlow.value).toBeLessThan(1.5);
    expect(byName(post, "BackdropLanterns").material.uniforms.uGlow.value).toBeGreaterThan(1.5);
    plain.dispose();
    post.dispose();
  });

  it("uses the cheaper mist shader on the Low preset only", () => {
    const low = new BackdropRig(OPTIONS[0]);
    const medium = new BackdropRig(OPTIONS[1]);
    expect(byName(low, "BackdropMistFloor").material.defines).toHaveProperty("BD_LOW_DETAIL");
    expect(byName(medium, "BackdropMistFloor").material.defines).not.toHaveProperty("BD_LOW_DETAIL");
    low.dispose();
    medium.dispose();
  });

  it("disposes every geometry, material and texture, and survives being disposed twice", () => {
    const rig = new BackdropRig(OPTIONS[2]);
    const disposed = new Set<unknown>();
    const track = (target: THREE.EventDispatcher<{ dispose: object }>) =>
      target.addEventListener("dispose", () => disposed.add(target));

    const resources: unknown[] = [];
    for (const mesh of meshes(rig)) {
      track(mesh.geometry);
      track(mesh.material);
      resources.push(mesh.geometry, mesh.material);
      for (const uniform of Object.values(mesh.material.uniforms)) {
        if (uniform.value instanceof THREE.Texture) {
          track(uniform.value);
          resources.push(uniform.value);
        }
      }
    }
    expect(resources.length).toBe(7 * 2 + 1); // + the mist noise texture

    rig.dispose();
    for (const resource of resources) expect(disposed.has(resource)).toBe(true);
    // StrictMode replays effects: a second dispose (and further updates) must be harmless.
    expect(() => rig.dispose()).not.toThrow();
    expect(() => rig.update(0.016)).not.toThrow();
  });

  it("keeps nothing in the backdrop from casting or blocking: the group sits at the origin", () => {
    const rig = new BackdropRig(OPTIONS[1]);
    expect(rig.group.position.lengthSq()).toBe(0);
    expect(rig.group.children.length).toBe(7);
    rig.dispose();
  });
});
