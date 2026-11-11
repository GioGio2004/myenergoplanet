import { PALETTE } from "../../config";

/**
 * Backdrop colours, all derived from the six palette colours.
 * sRGB hex strings: these are the colours that should reach the screen. Turn them into
 * shader/fog colours with `sceneColor()` (colors.ts), which accounts for tone mapping.
 */
export const BACKDROP_COLORS = {
  /** Sky just below the horizon: the "upper part" of what the game camera sees. */
  sky: PALETTE.egyptianBlue,
  /** Straight down / far below the island. */
  deep: PALETTE.ink,
  /** Overhead: egyptian blue pulled halfway to ink. */
  zenith: "#021A33",
  /** Thin band of lighter air sitting on the horizon; distant things dissolve into it. */
  haze: "#143A5E",
  /** Soft cushion of light under the island so its rim reads against the dark. */
  islandGlow: PALETTE.stoneBlue,

  /** Sea-of-clouds washes (mist floor): lowest tier → highest tier. */
  mistDeep: "#3A6C94",
  mist: "#9DBBD0",
  /** Cloud scrolls: lit top and shaded underside. */
  cloudLight: "#B4CAD9",
  cloudShade: "#2C5A80",
  paper: PALETTE.ricePaper,

  /** Ink-wash mountain ridges, nearest (darkest) to farthest (lightest, bluest). */
  mountainNear: "#031A33",
  mountainFar: "#11355A",

  /** Paper lanterns (emissive, not tone-compensated). */
  lanternScarlet: PALETTE.scarlet,
  lanternGold: PALETTE.gold,
  lanternCore: "#FFC56B",
  lanternTrim: "#3A2606",
  haloScarlet: "#FF5A3C",
  haloGold: "#FFB347",

  /** Lighting. */
  keyLight: "#FFE2B8",
  fillSky: "#AFCFE8",
  fillGround: "#0A2744",
  rimLight: "#7FB4E0",
} as const;

/**
 * Linear scene fog. Starts beyond the far rim of the island at the widest camera
 * framing, so play is never hazed; debris falling toward the sea of clouds melts away.
 */
export const FOG_NEAR = 27;
export const FOG_FAR = 92;

/** Height of the flat mist layer that forms the floor of the sea of clouds. */
export const SEA_LEVEL = -16;

/** Backdrop drift runs at this fraction of normal speed when reduced motion is requested. */
export const REDUCED_MOTION_SCALE = 0.3;

/** Longest real frame the backdrop animation will swallow in one go (tab switches, hitches). */
export const MAX_FRAME_DELTA = 0.1;
