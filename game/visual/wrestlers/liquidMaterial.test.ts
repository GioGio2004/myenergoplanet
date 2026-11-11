import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PLAYER_STYLES } from "../../config";
import { createLiquid, patchDepthShader, patchLitShader } from "./liquidMaterial";

/** Expand `#include <chunk>` the way the renderer does, failing on unknown chunks. */
function resolveIncludes(source: string): string {
  return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_match, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string | undefined>)[name];
    if (chunk === undefined) throw new Error(`unknown shader chunk: ${name}`);
    return resolveIncludes(chunk);
  });
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("liquid shader patches (against the installed three.js shaders)", () => {
  it("finds every hook point in the physical shader", () => {
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    expect(() => patchLitShader(shader)).not.toThrow();

    const vs = resolveIncludes(shader.vertexShader);
    const fs = resolveIncludes(shader.fragmentShader);

    // Deformation is defined once, before main, and used for positions and normals.
    expect(count(vs, "vec3 liquidDeform( vec3 p )")).toBe(1);
    expect(vs.indexOf("vec3 liquidDeform( vec3 p )")).toBeLessThan(vs.indexOf("void main()"));
    expect(count(vs, "liquidDeform( ")).toBe(1 + 3 + 1);
    // Normals are corrected before three transforms them, positions after `transformed` exists.
    expect(vs.indexOf("objectNormal = normalize( cross( lqP1")).toBeGreaterThan(
      vs.indexOf("vec3 objectNormal = vec3( normal );"),
    );
    expect(vs.indexOf("objectNormal = normalize( cross( lqP1")).toBeLessThan(
      vs.indexOf("vec3 transformedNormal = objectNormal;"),
    );
    expect(vs.indexOf("transformed = liquidDeform( transformed );")).toBeGreaterThan(
      vs.indexOf("vec3 transformed = vec3( position );"),
    );
    expect(vs.indexOf("transformed = liquidDeform( transformed );")).toBeLessThan(
      vs.indexOf("vec4 mvPosition = vec4( transformed, 1.0 );"),
    );

    // Fragment: masks are declared before they are used by later hooks.
    const order = [
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      "float lqBody =",
      "float roughnessFactor = roughness;",
      "roughnessFactor = mix( roughnessFactor, 0.62, lqCloth );",
      "vec3 normal = normalize( vNormal );",
      "float lqFresnel =",
      "material.clearcoat = saturate( material.clearcoat );",
      "material.clearcoat *= 1.0 - 0.85 * lqCloth;",
      "vec3 outgoingLight =",
      "diffuseColor.a = mix( diffuseColor.a, 1.0",
      "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = fs.indexOf(marker, cursor + 1);
      expect(at, `"${marker}" should follow the previous hook`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // Varyings are declared on both sides.
    for (const source of [vs, fs]) {
      expect(source).toContain("varying float vLqPart;");
      expect(source).toContain("varying vec3 vLqPos;");
    }
    expect(fs).toContain("varying vec3 vViewPosition;");
  });

  it("declares every uniform it uses, and nothing three already declares", () => {
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    patchLitShader(shader);
    const liquid = createLiquid(PLAYER_STYLES[0], 1);
    const vs = resolveIncludes(shader.vertexShader);
    const fs = resolveIncludes(shader.fragmentShader);
    const declared = (source: string) =>
      Array.from(source.matchAll(/^\s*uniform\s+\w+\s+(u[A-Z]\w*)\s*;/gm), (m) => m[1]);
    const mine = new Set(Object.keys(liquid.uniforms));
    // Each custom uniform declared in GLSL has a value on the JS side…
    for (const name of [...declared(vs), ...declared(fs)]) expect(mine.has(name), name).toBe(true);
    // …each JS uniform is declared exactly once in the stage(s) that use it…
    for (const name of mine) {
      const total = [...declared(vs), ...declared(fs)].filter((n) => n === name).length;
      expect(total, name).toBe(1);
    }
    // …and none collides with a built-in uniform of the physical material.
    const builtIn = THREE.ShaderLib.physical.uniforms;
    for (const name of mine) expect(name in builtIn, name).toBe(false);
    liquid.dispose();
  });

  it("patches the depth and distance shaders with the same deformation", () => {
    for (const lib of [THREE.ShaderLib.depth, THREE.ShaderLib.distance]) {
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      expect(() => patchDepthShader(shader)).not.toThrow();
      const vs = resolveIncludes(shader.vertexShader);
      expect(count(vs, "vec3 liquidDeform( vec3 p )")).toBe(1);
      expect(vs).toContain("transformed = liquidDeform( transformed );");
      // The shadow pass must not need the per-part attribute.
      expect(vs).not.toContain("aPart");
      expect(shader.fragmentShader).toBe(lib.fragmentShader);
    }
  });

  it("throws loudly if three renames a chunk", () => {
    expect(() => patchLitShader({ vertexShader: "void main() {}", fragmentShader: "" })).toThrow(
      /shader token not found/,
    );
  });
});

describe("createLiquid", () => {
  it("gives every wrestler its own uniforms but one shared program", () => {
    const a = createLiquid(PLAYER_STYLES[0], 1);
    const b = createLiquid(PLAYER_STYLES[1], 2);
    expect(a.material).not.toBe(b.material);
    expect(a.uniforms.uTime).not.toBe(b.uniforms.uTime);
    expect(a.uniforms.uDeform.value).not.toBe(b.uniforms.uDeform.value);
    expect(a.material.customProgramCacheKey()).toBe(b.material.customProgramCacheKey());
    expect(a.depthMaterial.customProgramCacheKey()).toBe(b.depthMaterial.customProgramCacheKey());
    expect(a.material.customProgramCacheKey()).not.toBe(a.depthMaterial.customProgramCacheKey());
    expect(a.depthMaterial.customProgramCacheKey()).not.toBe(a.distanceMaterial.customProgramCacheKey());
    a.dispose();
    b.dispose();
  });

  it("feeds the same uniform objects to the lit and the shadow programs", () => {
    const liquid = createLiquid(PLAYER_STYLES[3], 4);
    const run = (material: THREE.Material, lib: { vertexShader: string; fragmentShader: string }) => {
      const shader = {
        uniforms: {} as Record<string, THREE.IUniform>,
        vertexShader: lib.vertexShader,
        fragmentShader: lib.fragmentShader,
      };
      material.onBeforeCompile(
        shader as unknown as THREE.WebGLProgramParametersWithUniforms,
        null as unknown as THREE.WebGLRenderer,
      );
      return shader.uniforms;
    };
    const lit = run(liquid.material, THREE.ShaderLib.physical);
    const litAgain = run(liquid.material, THREE.ShaderLib.physical);
    const depth = run(liquid.depthMaterial, THREE.ShaderLib.depth);
    expect(lit.uTime).toBe(liquid.uniforms.uTime);
    expect(litAgain.uDeform).toBe(liquid.uniforms.uDeform);
    expect(depth.uDeform).toBe(liquid.uniforms.uDeform);
    expect(depth.uSway).toBe(liquid.uniforms.uSway);
    liquid.dispose();
  });

  it("converts the style's sRGB hex colours to linear and never uses transmission", () => {
    const style = PLAYER_STYLES[0];
    const liquid = createLiquid(style, 1);
    const expected = new THREE.Color(style.color);
    expect(liquid.material.color.r).toBeCloseTo(expected.r, 6);
    // #EC2F36 is 0.925 in sRGB red; linear must be lower.
    expect(liquid.material.color.r).toBeLessThan(0.9);
    expect(liquid.uniforms.uBeltColor.value.getHexString()).toBe(style.belt.slice(1).toLowerCase());
    expect(liquid.uniforms.uGlowColor.value.getHexString()).toBe(style.glow.slice(1).toLowerCase());
    expect(liquid.material.transmission).toBe(0);
    expect(liquid.material.transparent).toBe(true);
    expect(liquid.material.depthWrite).toBe(true);
    liquid.dispose();
  });
});
