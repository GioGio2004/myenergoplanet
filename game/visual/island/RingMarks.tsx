"use client";

import { useEffect, useMemo, type JSX } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ISLAND_COLORS } from "./palette";

/** Each line's length, width and thickness, world units. */
const LINE_LENGTH = 1.1;
const LINE_WIDTH = 0.12;
const LINE_THICKNESS = 0.012;
/** Distance of each line from the centre of the ring: both stay on the centre pad. */
const LINE_OFFSET = 0.7;
/** Clearance above the centre pad (its top is at y = 0). */
const LINE_LIFT = 0.003;

/**
 * Both lines as one geometry (one draw call). Two wrestlers spawn facing each other
 * along Z, so the lines run along X, one on each side of the centre.
 */
function createMarksGeometry(): THREE.BufferGeometry {
  const y = LINE_LIFT + LINE_THICKNESS / 2;
  const near = new THREE.BoxGeometry(LINE_LENGTH, LINE_THICKNESS, LINE_WIDTH);
  near.translate(0, y, LINE_OFFSET);
  const far = new THREE.BoxGeometry(LINE_LENGTH, LINE_THICKNESS, LINE_WIDTH);
  far.translate(0, y, -LINE_OFFSET);
  const merged = mergeGeometries([near, far], false);
  near.dispose();
  far.dispose();
  return merged;
}

/**
 * Shikiri-sen: the two short chalk starting lines at the centre of the ring.
 * Deliberately subtle; they sit a few millimetres above the centre pad.
 *
 * Swappable asset: replace with a decal or a Blender-made inlay.
 */
export function RingMarks(): JSX.Element {
  const geometry = useMemo(() => createMarksGeometry(), []);
  // Geometries made in useMemo are not disposed by R3F.
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh name="island-ring-marks" geometry={geometry} receiveShadow>
      <meshStandardMaterial color={ISLAND_COLORS.marks} roughness={0.9} metalness={0} />
    </mesh>
  );
}
