// Structure-of-arrays description of things that can crack and fall away:
// tiles (several instanced pieces each) and rope bales (one piece each).
// Plain typed arrays so the animator can walk them every frame without allocating.

export type CrumbleItems = {
  itemCount: number;
  /** Total instances in the InstancedMesh. */
  pieceCount: number;
  /** Items are grouped (tiles: one group per ring) and a group cracks/falls as one. */
  groupCount: number;
  /** Items of group g are `[groupStart[g], groupStart[g + 1])`. Items are sorted by group. */
  groupStart: Uint16Array;
  /** Instances of item i are `[pieceStart[i], pieceStart[i + 1])`. */
  pieceStart: Uint16Array;
  /** xyz per item: the point the item shakes and tumbles around (its centre of mass). */
  pivot: Float32Array;
  /** xyz per item, unit length: the axis it tumbles around while falling. */
  axis: Float32Array;
  /** xz per item, unit length (or zero): the direction it drifts in while falling. */
  outward: Float32Array;
  /** 16 per piece, column-major: the piece's matrix relative to its item's pivot. */
  pieceLocal: Float32Array;
  /** rgb per item, linear working space: the instance colour at rest. */
  color: Float32Array;
};

/** Allocate zeroed arrays; the caller fills them. Colours start white. */
export function createCrumbleItems(
  itemCount: number,
  pieceCount: number,
  groupCount: number,
): CrumbleItems {
  return {
    itemCount,
    pieceCount,
    groupCount,
    groupStart: new Uint16Array(groupCount + 1),
    pieceStart: new Uint16Array(itemCount + 1),
    pivot: new Float32Array(itemCount * 3),
    axis: new Float32Array(itemCount * 3),
    outward: new Float32Array(itemCount * 2),
    pieceLocal: new Float32Array(pieceCount * 16),
    color: new Float32Array(itemCount * 3).fill(1),
  };
}
