// The packed-dirt floor: every tile of the dohyo in ONE InstancedMesh, plus the
// crack-and-fall animation of its rings. Plain three.js so the React component only
// ever calls methods on it.

import * as THREE from "three";
import { gameConfig } from "../../config";
import { CrumbleField, CrumbleState } from "./crumbleField";
import { computeIslandLayout, firstRingOutside, type IslandLayout } from "./layout";
import { ISLAND_COLORS, fillTileColors } from "./palette";
import { createTilePrismGeometry } from "./tileGeometry";
import { buildTileItems } from "./tileItems";

export type ArenaShape = {
  radius: number;
  ringWidth: number;
  slabThickness: number;
};

export class DirtTilesRig {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly layout: IslandLayout;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly field: CrumbleField;

  constructor(arena: ArenaShape = gameConfig.arena) {
    this.layout = computeIslandLayout({ radius: arena.radius, ringWidth: arena.ringWidth });
    const items = buildTileItems(this.layout, { thickness: arena.slabThickness });
    fillTileColors(this.layout, items.color);

    this.geometry = createTilePrismGeometry();
    // White base colour: the albedo is instance colour × the prism's vertex shading.
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      vertexColors: true,
    });

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, items.pieceCount);
    mesh.name = "island-dirt-tiles";
    mesh.frustumCulled = false; // falling tiles leave the (never refreshed) bounds
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false; // stays at the identity
    this.mesh = mesh;

    this.field = new CrumbleField(mesh, items, {
      warnColor: ISLAND_COLORS.tileCracked,
      fadeColor: ISLAND_COLORS.dissolve,
      seed: 11,
    });
  }

  /** True while any ring is cracking or falling. */
  get active(): boolean {
    return this.field.active;
  }

  /** Rings outside `radius` start cracking and will fall in about `seconds`. */
  warn(radius: number, seconds: number): void {
    for (let ring = firstRingOutside(this.layout, radius); ring < this.field.groupCount; ring++) {
      this.field.warn(ring, seconds);
    }
  }

  /** The island is now `radius` wide: every ring outside it falls away. */
  crumble(radius: number): void {
    for (let ring = firstRingOutside(this.layout, radius); ring < this.field.groupCount; ring++) {
      this.field.drop(ring);
    }
  }

  /** A fresh match: every tile back in place, instantly. */
  reset(): void {
    this.field.reset();
  }

  /** Match the island to a walkable radius with no animation (mounting mid-match). */
  syncTo(radius: number): void {
    this.field.reset();
    for (let ring = firstRingOutside(this.layout, radius); ring < this.field.groupCount; ring++) {
      this.field.hide(ring);
    }
  }

  /** True when the ring has not started falling (it may be cracking). */
  ringStanding(ring: number): boolean {
    const state = this.field.stateOf(ring);
    return state === CrumbleState.Solid || state === CrumbleState.Warning;
  }

  update(dt: number, reduceMotion: boolean): void {
    this.field.update(dt, reduceMotion);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
