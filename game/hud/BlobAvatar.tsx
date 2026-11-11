"use client";

import { PALETTE, PLAYER_STYLES, type BeltPattern, type TopknotStyle } from "../config";
import type { PlayerSlot } from "../types";

// The 2D stand-in for a wrestler: a round liquid body in the slot colour with the
// slot's own topknot silhouette and belt pattern, so a player can be matched to
// their 3D character by shape as well as by colour.
//
// Drawn in a 100 x 110 box. The body is a slightly squat ellipse; the belt bands
// are computed against that ellipse so no clip paths (and no element ids) are needed.

const CX = 50;
const CY = 66;
const RX = 38;
const RY = 36;

/** Half-width of the body ellipse at height `y`. */
function halfWidth(y: number): number {
  const t = (y - CY) / RY;
  return RX * Math.sqrt(Math.max(0, 1 - t * t));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A horizontal band across the body between `top` and `bottom`, hugging the
 * outline on both sides. `sag` bows the band downward like a belt seen from above.
 */
function bandPath(top: number, bottom: number, sag: number): string {
  const a = r2(halfWidth(top));
  const b = r2(halfWidth(bottom));
  return [
    `M ${CX - a} ${top}`,
    `Q ${CX} ${top + sag} ${CX + a} ${top}`,
    `A ${RX} ${RY} 0 0 1 ${CX + b} ${bottom}`,
    `Q ${CX} ${bottom + sag} ${CX - b} ${bottom}`,
    `A ${RX} ${RY} 0 0 1 ${CX - a} ${top}`,
    "Z",
  ].join(" ");
}

/** Everything below `top`: the same sagging upper edge, closed by the body outline itself. */
function bellyPath(top: number, sag: number): string {
  const a = r2(halfWidth(top));
  return [
    `M ${CX - a} ${top}`,
    `Q ${CX} ${top + sag} ${CX + a} ${top}`,
    `A ${RX} ${RY} 0 0 1 ${CX - a} ${top}`,
    "Z",
  ].join(" ");
}

const BELT_SAG = 6;
const BELT_FULL = bandPath(71, 87, BELT_SAG);
const BELT_STRIPE = bandPath(77.4, 80.6, BELT_SAG);
const BELT_KNOT = bandPath(72.5, 85.5, BELT_SAG);
const BELT_UPPER = bandPath(69, 76, BELT_SAG);
const BELT_LOWER = bandPath(81, 88, BELT_SAG);
const UNDER_SHADE = bellyPath(91, 3);

function Belt({ pattern, belt, accent }: { pattern: BeltPattern; belt: string; accent: string }) {
  switch (pattern) {
    case "plain":
      return <path d={BELT_FULL} fill={belt} />;
    case "stripe":
      return (
        <>
          <path d={BELT_FULL} fill={belt} />
          <path d={BELT_STRIPE} fill={accent} />
        </>
      );
    case "knot":
      return (
        <>
          <path d={BELT_KNOT} fill={belt} />
          {/* a big bow on the belly: two fanned loops, two hanging tails, a bright knot */}
          <path
            d="M47 87 L43 99 M53 87 L57 99"
            fill="none"
            stroke={belt}
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <ellipse
            cx="38.5"
            cy="76"
            rx="11"
            ry="6.5"
            fill={belt}
            stroke={accent}
            strokeWidth="1.6"
            transform="rotate(-16 38.5 76)"
          />
          <ellipse
            cx="61.5"
            cy="76"
            rx="11"
            ry="6.5"
            fill={belt}
            stroke={accent}
            strokeWidth="1.6"
            transform="rotate(16 61.5 76)"
          />
          <circle cx={CX} cy="78.5" r="6" fill={accent} stroke={belt} strokeWidth="2" />
        </>
      );
    case "double":
      return (
        <>
          <path d={BELT_UPPER} fill={belt} />
          <path d={BELT_LOWER} fill={belt} />
        </>
      );
  }
}

/**
 * Drawn before the body, so the body overlaps the base of the knot. Like the 3D
 * character the hair is in the belt shade; a rim of the body colour keeps the
 * silhouette readable against the dark HUD surfaces.
 */
function Topknot({ kind, hair, rim }: { kind: TopknotStyle; hair: string; rim: string }) {
  switch (kind) {
    case "bun":
      return <circle cx={CX} cy="20" r="12" fill={hair} stroke={rim} strokeWidth="3" />;
    case "fan":
      return (
        <path
          d="M45 36 L26 15 Q50 1 74 15 L55 36 Z"
          fill={hair}
          stroke={rim}
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
      );
    case "twin":
      return (
        <>
          <circle cx="33" cy="25" r="10" fill={hair} stroke={rim} strokeWidth="3" />
          <circle cx="67" cy="25" r="10" fill={hair} stroke={rim} strokeWidth="3" />
        </>
      );
    case "loop":
      // An upright ring: a wide rim-coloured stroke under a narrower hair-coloured one.
      return (
        <>
          <circle cx={CX} cy="17" r="11.5" fill="none" stroke={rim} strokeWidth="10" />
          <circle cx={CX} cy="17" r="11.5" fill="none" stroke={hair} strokeWidth="5" />
        </>
      );
  }
}

/** The cord at the base of the topknot, in the bright accent like the 3D character. */
function Tie({ kind, accent, belt }: { kind: TopknotStyle; accent: string; belt: string }) {
  const paint = { fill: accent, stroke: belt, strokeWidth: 1 };
  switch (kind) {
    case "twin":
      return (
        <>
          <rect
            {...paint}
            x="27"
            y="31.5"
            width="12"
            height="4.5"
            rx="2.25"
            transform="rotate(-18 33 33.75)"
          />
          <rect
            {...paint}
            x="61"
            y="31.5"
            width="12"
            height="4.5"
            rx="2.25"
            transform="rotate(18 67 33.75)"
          />
        </>
      );
    case "loop":
      return <circle {...paint} cx={CX} cy="31" r="4.5" />;
    default:
      return <rect {...paint} x="42" y="29" width="16" height="5" rx="2.5" />;
  }
}

export function BlobAvatar({
  slot,
  className = "",
  title,
}: {
  slot: PlayerSlot;
  /** Set the width here (e.g. `w-16`); the height follows the 10:11 box. */
  className?: string;
  /** Accessible name. Omit when the avatar sits next to the player's name. */
  title?: string;
}) {
  const style = PLAYER_STYLES[slot];
  return (
    <svg
      viewBox="0 0 100 110"
      className={`h-auto shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <Topknot kind={style.topknot} hair={style.belt} rim={style.color} />
      <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill={style.color} />
      {/* soft shade under the belly, then the belt */}
      <path d={UNDER_SHADE} fill={style.belt} opacity="0.28" />
      <Belt pattern={style.beltPattern} belt={style.belt} accent={style.glow} />
      <Tie kind={style.topknot} accent={style.glow} belt={style.belt} />
      {/* wet highlights */}
      <ellipse
        cx="32"
        cy="50"
        rx="6.5"
        ry="12"
        fill="#ffffff"
        opacity="0.42"
        transform="rotate(32 32 50)"
      />
      <circle cx="26.5" cy="66" r="2.6" fill="#ffffff" opacity="0.38" />
      {/* eyes */}
      <ellipse cx="42" cy="57" rx="2.7" ry="3.7" fill={PALETTE.ink} />
      <ellipse cx="60" cy="57" rx="2.7" ry="3.7" fill={PALETTE.ink} />
    </svg>
  );
}
