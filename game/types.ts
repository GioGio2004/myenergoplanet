import type { PlayerStyle } from "./config";
import type { GameRuntime } from "./runtime";

export type PlayerSlot = 0 | 1 | 2 | 3;

/** `lobby → intro → countdown → playing → (suddenDeath) → results`. */
export type Phase = "lobby" | "intro" | "countdown" | "playing" | "suddenDeath" | "results";

/**
 * One controller sample. Screen-relative: `x` is right, `y` is "up the screen"
 * (away from the camera). Both in [-1, 1]. `dash` / `brace` are HELD states;
 * the simulation detects the press edge itself.
 */
export type PlayerInput = {
  x: number;
  y: number;
  dash: boolean;
  brace: boolean;
};

export const NEUTRAL_INPUT: Readonly<PlayerInput> = { x: 0, y: 0, dash: false, brace: false };

/** Who drives a slot. `remote` = a phone over WebRTC (later phase). */
export type ControlKind = "keyboardA" | "keyboardB" | "bot" | "remote";

export type PlayerSetup = {
  slot: PlayerSlot;
  name: string;
  control: ControlKind;
};

/**
 * Anything that can produce input for one slot (keyboard, bot, phone).
 * `sample` is called once per fixed simulation step and must write into `out`
 * without allocating.
 */
export interface InputSource {
  sample(out: PlayerInput, slot: PlayerSlot, runtime: GameRuntime, dt: number): void;
  dispose?(): void;
}

/**
 * `idle`  — not in play (lobby), body parked and hidden.
 * `alive` — on (or falling off) the island, simulated and visible.
 * `out`   — knocked out, hidden, waiting for `respawnAt`.
 */
export type WrestlerStatus = "idle" | "alive" | "out";

/** Mutable per-wrestler state shared by physics, rules, visuals and camera. */
export type WrestlerRuntime = {
  readonly slot: PlayerSlot;
  readonly style: PlayerStyle;
  name: string;
  control: ControlKind;

  // ── written by the match rules ──────────────────────────────────────────
  status: WrestlerStatus;
  score: number;
  /** Sim time until which this wrestler cannot push or be pushed. */
  invulnerableUntil: number;
  /** Slot of whoever touched this wrestler last, or -1. */
  lastTouchedBy: number;
  /** Sim time of that touch. */
  lastTouchedAt: number;
  /** Sim time at which an `out` wrestler comes back. */
  respawnAt: number;
  /**
   * Set by the rules when the body must be placed at (spawnX, spawnY, spawnZ) with
   * zero velocity. The physics layer performs the move and clears the flag.
   */
  teleport: boolean;
  spawnX: number;
  spawnY: number;
  spawnZ: number;

  // ── written by the physics layer ────────────────────────────────────────
  /** Render-interpolated world position of the body centre, updated every frame. */
  x: number;
  y: number;
  z: number;
  /** Velocity after the latest fixed step. */
  vx: number;
  vy: number;
  vz: number;
  /** Heading in radians, `atan2(dirX, dirZ)` of the last intended/moving direction. */
  facing: number;
  grounded: boolean;
  /** Within `arena.edgeWarningDistance` of the current edge while grounded. */
  onEdge: boolean;
  dashing: boolean;
  /** Seconds of dash left (0 when not dashing). */
  dashTimeLeft: number;
  dashCooldownLeft: number;
  bracing: boolean;
  /** Seconds of brace hold still available in the current hold. */
  braceTimeLeft: number;
  braceCooldownLeft: number;
};

export type GameEvent =
  | { type: "phase"; phase: Phase; prev: Phase }
  /** Countdown beat: 3, 2, 1, then 0 = "FIGHT". */
  | { type: "countdown"; n: number }
  /** A real impact between two wrestlers. `strength` is 0..1. Position is the contact point. */
  | {
      type: "hit";
      a: PlayerSlot;
      b: PlayerSlot;
      strength: number;
      x: number;
      y: number;
      z: number;
      /** At least one of them was dashing. */
      dash: boolean;
      /** At least one of them was bracing. */
      braced: boolean;
    }
  /** A wrestler landed on the island (intro drop or respawn). */
  | { type: "land"; slot: PlayerSlot; x: number; z: number; speed: number }
  | { type: "dash"; slot: PlayerSlot; dirX: number; dirZ: number }
  | { type: "brace"; slot: PlayerSlot; on: boolean }
  /** `by` is the credited attacker, or null for a self knockout. Position is where they went out. */
  | { type: "knockout"; victim: PlayerSlot; by: PlayerSlot | null; x: number; y: number; z: number }
  | { type: "score"; slot: PlayerSlot; score: number; delta: number }
  | { type: "respawn"; slot: PlayerSlot; x: number; z: number }
  /** Tiles outside `radius` start cracking; they fall `seconds` later. */
  | { type: "crumbleWarn"; radius: number; seconds: number }
  /** The walkable radius is now `radius`; tiles outside it fall away. */
  | { type: "crumble"; radius: number }
  | { type: "suddenDeath" }
  | { type: "matchEnd"; winner: PlayerSlot | null };

export type GameEventType = GameEvent["type"];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

export type HudPlayer = {
  slot: PlayerSlot;
  name: string;
  control: ControlKind;
  score: number;
  /** False while knocked out and waiting to respawn. */
  inPlay: boolean;
};

export type HudCallout = {
  /** Increments for every new callout so the HUD can key animations on it. */
  id: number;
  victim: PlayerSlot;
  by: PlayerSlot | null;
  text: string;
};

/** Low-frequency state for React UI. Replaced (never mutated) on every change. */
export type HudState = {
  phase: Phase;
  /** Whole seconds left on the match clock. */
  secondsLeft: number;
  /** 3, 2, 1, 0 (= FIGHT) while a countdown beat is showing, else null. */
  countdown: number | null;
  players: HudPlayer[];
  callout: HudCallout | null;
  winner: PlayerSlot | null;
  /** True during the final crumble stretch (camera + HUD get more dramatic). */
  finalStretch: boolean;
};

/**
 * The match rules. Pure logic: no three.js, no Rapier, no DOM.
 * The physics layer calls `reportContact` / `reportRingOut` during a fixed step and
 * then `step(dt)` exactly once per fixed step.
 */
export interface MatchController {
  /** lobby/results → intro. Needs at least `minPlayers` configured wrestlers. Returns false if it cannot start. */
  start(): boolean;
  /** results → intro with the same players and scores reset. */
  rematch(): void;
  /** Any phase → lobby. Parks every wrestler (`idle`). */
  toLobby(): void;
  /** Advance `runtime.simTime`, timers and the phase machine by one fixed step. */
  step(dt: number): void;
  /** Two wrestlers are touching this step (call once per pair per step, order irrelevant). */
  reportContact(a: PlayerSlot, b: PlayerSlot): void;
  /** The wrestler's body fell below the kill plane this step. */
  reportRingOut(slot: PlayerSlot): void;
  /** True when the slot's input should drive its body (alive and in a playing phase). */
  canControl(slot: PlayerSlot): boolean;
}
