// ─────────────────────────────────────────────────────────────────────────────
// Liquid Sumo — every tunable number lives here.
// Units: metres-ish world units, seconds, radians. Y is up, the island top is y = 0.
// ─────────────────────────────────────────────────────────────────────────────

export type TopknotStyle = "bun" | "fan" | "twin" | "loop";
export type BeltPattern = "plain" | "stripe" | "knot" | "double";

/** How one wrestler looks. Slots must be tellable apart by more than colour. */
export type PlayerStyle = {
  /** Display name of the colour, used as the default player name. */
  label: string;
  /** Body colour (sRGB hex). */
  color: string;
  /** Darker shade for the mawashi belt. */
  belt: string;
  /** Inner glow / rim tint. */
  glow: string;
  /** Readable text colour on top of `color` (HUD cards, name tags). */
  ink: string;
  topknot: TopknotStyle;
  beltPattern: BeltPattern;
};

export const PLAYER_STYLES: readonly PlayerStyle[] = [
  {
    label: "Scarlet",
    color: "#EC2F36",
    belt: "#7A1016",
    glow: "#FF7A70",
    ink: "#F2EAD8",
    topknot: "bun",
    beltPattern: "plain",
  },
  {
    label: "Stone Blue",
    color: "#629CC5",
    belt: "#1D4263",
    glow: "#A8D4F2",
    ink: "#01101F",
    topknot: "fan",
    beltPattern: "stripe",
  },
  {
    label: "Rice White",
    color: "#F2EAD8",
    belt: "#8A7A5C",
    glow: "#FFFFFF",
    ink: "#01101F",
    topknot: "twin",
    beltPattern: "knot",
  },
  {
    label: "Imperial Gold",
    color: "#D9A441",
    belt: "#6E4A0C",
    glow: "#FFD98A",
    ink: "#01101F",
    topknot: "loop",
    beltPattern: "double",
  },
];

export const PALETTE = {
  egyptianBlue: "#03203E",
  stoneBlue: "#629CC5",
  scarlet: "#EC2F36",
  ricePaper: "#F2EAD8",
  ink: "#01101F",
  gold: "#D9A441",
} as const;

export type QualityLevel = "low" | "medium" | "high";

export type QualityPreset = {
  /** Upper bound for devicePixelRatio. */
  maxDpr: number;
  shadows: boolean;
  shadowMapSize: number;
  postProcessing: boolean;
  /** Max live splash droplets. */
  particles: number;
  /** Width segments of a wrestler's body sphere (height = half). */
  sphereSegments: number;
  /** Drifting cloud instances in the backdrop. */
  clouds: number;
};

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    maxDpr: 1,
    shadows: false,
    shadowMapSize: 512,
    postProcessing: false,
    particles: 60,
    sphereSegments: 32,
    clouds: 10,
  },
  medium: {
    maxDpr: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    postProcessing: false,
    particles: 140,
    sphereSegments: 48,
    clouds: 18,
  },
  high: {
    maxDpr: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    postProcessing: true,
    particles: 260,
    sphereSegments: 72,
    clouds: 26,
  },
};

export const gameConfig = {
  maxPlayers: 4,
  minPlayers: 2,

  rules: {
    pointsToWin: 5,
    matchSeconds: 180,
    /** A knockout is credited to whoever touched the faller within this window. */
    attributionSeconds: 3,
    /** Points lost for falling off with nobody to credit (score never goes below 0). */
    selfKnockoutPenalty: 1,
    respawnSeconds: 2,
    invulnerableSeconds: 1.5,
    /** Camera sweep + drop-in before the countdown. */
    introSeconds: 3,
    /** Seconds per countdown beat: 3, 2, 1. */
    countdownBeatSeconds: 0.9,
    /** How long "FIGHT" stays up after the countdown (play has already begun). */
    fightBannerSeconds: 0.9,
    /** Knockout callout lifetime on the HUD. */
    calloutSeconds: 2.4,
  },

  arena: {
    /** Island radius at the start of a match. */
    radius: 6,
    /** Tiles are laid in concentric rings this wide; the centre is a disc of this radius. */
    ringWidth: 1,
    /** Thickness of the walkable dirt slab (collider and tiles). */
    slabThickness: 0.6,
    /** A wrestler whose centre drops below this is knocked out. */
    killY: -2,
    /** Spawn points sit on a circle of this radius, evenly spaced, slot 0 at angle 0. */
    spawnRadius: 3.2,
    /** Height wrestlers drop from in the intro. */
    introDropHeight: 9,
    /** Height wrestlers drop from when respawning. */
    respawnDropHeight: 2.5,
    /** Distance from the current edge at which a wrestler counts as "on the edge". */
    edgeWarningDistance: 1.1,
    /**
     * Final-stretch shrink. When `secondsLeft` reaches `at`, ring tiles outside `radius`
     * start cracking; `warnSeconds` later they fall and the walkable radius becomes `radius`.
     */
    crumble: {
      warnSeconds: 2,
      steps: [
        { at: 30, radius: 5 },
        { at: 15, radius: 4 },
      ],
    },
  },

  wrestler: {
    radius: 0.6,
    /** Mass of the body in normal state. */
    mass: 1,
    /** Acceleration toward the stick direction (units/s²) at full tilt. */
    moveAcceleration: 30,
    /** Self-propelled speed cap (units/s). Knockback may exceed it. */
    maxSpeed: 5.5,
    linearDamping: 1.6,
    /** Extra damping while airborne is NOT applied; falling should feel free. */
    floorFriction: 0.05,
    restitution: 0.35,
    /** Stick magnitude below this is treated as zero. */
    deadzone: 0.15,
    /** No input for this long → neutral. */
    inputTimeoutMs: 500,

    dash: {
      /** Launch speed = maxSpeed × this, along the stick (or facing) direction. */
      speedMultiplier: 3,
      durationSeconds: 0.25,
      cooldownSeconds: 1.2,
      /** Extra knockback multiplier applied to whoever a dashing wrestler hits. */
      knockbackMultiplier: 1.9,
    },

    brace: {
      massMultiplier: 4,
      /** Damping while rooted, so the body is "mostly anchored". */
      linearDamping: 9,
      maxHoldSeconds: 1.5,
      cooldownSeconds: 2,
      /** Fraction of incoming knockback a braced wrestler still takes. */
      knockbackTaken: 0.25,
    },

    hit: {
      /** Relative speed (units/s) below which a touch is just a nudge (no pop, no splash). */
      minImpactSpeed: 1.2,
      /** Extra separating impulse per unit of relative speed. */
      knockbackPerSpeed: 0.55,
      /** Flat "pop" impulse added on every real impact so hits feel juicy. */
      popImpulse: 1.4,
      /** Relative speed that maps to hit strength 1 (camera shake, big splash). */
      bigImpactSpeed: 11,
      /** Minimum seconds between two registered impacts for the same pair. */
      pairCooldownSeconds: 0.12,
    },
  },

  sim: {
    /** Fixed physics/logic rate. */
    hz: 60,
    /** Never simulate more than this many fixed steps in one rendered frame. */
    maxStepsPerFrame: 5,
    gravity: -24,
  },

  camera: {
    fov: 38,
    /** Downward pitch of the default view, degrees. */
    pitchDegrees: 50,
    /** Lower, more dramatic pitch for the final stretch. */
    finalPitchDegrees: 36,
    minDistance: 11,
    maxDistance: 22,
    /** Extra room around the group of wrestlers, world units. */
    framePadding: 3,
    /** Slow orbit drift, radians per second. */
    orbitSpeed: 0.035,
    finalOrbitSpeed: 0.07,
    /** Spring smoothing times (seconds to mostly settle). */
    positionSmoothTime: 0.55,
    zoomSmoothTime: 0.7,
    shake: { maxOffset: 0.35, decayPerSecond: 5.5 },
    punchIn: { amount: 1.4, seconds: 0.28 },
    edgeLean: 0.9,
    knockoutSlowMo: { scale: 0.3, seconds: 0.4 },
    knockoutFollowSeconds: 0.7,
    introOrbitRadians: 2.6,
    resultsOrbitSpeed: 0.35,
    resultsDistance: 6.5,
  },
} as const;

export type GameConfig = typeof gameConfig;

/** Spawn point for a slot: evenly spaced on the spawn circle. */
export function spawnPoint(slot: number, playerCount: number): { x: number; z: number } {
  const n = Math.max(playerCount, 2);
  const angle = (slot / n) * Math.PI * 2;
  return {
    x: Math.sin(angle) * gameConfig.arena.spawnRadius,
    z: Math.cos(angle) * gameConfig.arena.spawnRadius,
  };
}
