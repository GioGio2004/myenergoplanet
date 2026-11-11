import { PLAYER_STYLES, gameConfig } from "./config";
import type {
  GameEvent,
  GameEventOf,
  GameEventType,
  HudState,
  InputSource,
  Phase,
  PlayerSetup,
  PlayerSlot,
  WrestlerRuntime,
} from "./types";

type Handler<T extends GameEventType> = (event: GameEventOf<T>) => void;
type AnyHandler = (event: GameEvent) => void;

function createWrestler(setup: PlayerSetup): WrestlerRuntime {
  return {
    slot: setup.slot,
    style: PLAYER_STYLES[setup.slot],
    name: setup.name,
    control: setup.control,
    status: "idle",
    score: 0,
    invulnerableUntil: 0,
    lastTouchedBy: -1,
    lastTouchedAt: -Infinity,
    respawnAt: 0,
    teleport: false,
    spawnX: 0,
    spawnY: -50,
    spawnZ: 0,
    x: 0,
    y: -50,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 0,
    grounded: false,
    onEdge: false,
    dashing: false,
    dashTimeLeft: 0,
    dashCooldownLeft: 0,
    bracing: false,
    braceTimeLeft: 0,
    braceCooldownLeft: 0,
  };
}

function initialHud(): HudState {
  return {
    phase: "lobby",
    secondsLeft: gameConfig.rules.matchSeconds,
    countdown: null,
    players: [],
    callout: null,
    winner: null,
    finalStretch: false,
  };
}

/**
 * The one shared, mutable game state. Plain numbers and arrays only, so every layer
 * (rules, physics, visuals, camera, HUD) can read it every frame without allocating.
 *
 * Who writes what:
 * - match rules:   simTime, phase, phaseTime, secondsLeft, arenaRadius, winner, hud, wrestler rule fields
 * - physics layer: wrestler kinematic fields, calls `advanceReal` once per rendered frame
 * - camera:        cameraYaw, calls `requestSlowMo`
 */
export class GameRuntime {
  readonly config = gameConfig;

  /** Wrestlers in play, ordered by slot. Replaced by `setPlayers`. */
  wrestlers: WrestlerRuntime[] = [];
  /** Input source per slot (index = slot). */
  readonly inputs: (InputSource | null)[] = [null, null, null, null];

  phase: Phase = "lobby";
  /** Seconds since the current phase began (sim time). */
  phaseTime = 0;
  /** Simulated seconds since the runtime was created. Advanced by `MatchController.step`. */
  simTime = 0;
  /** Match clock, counts down during `playing`. */
  secondsLeft: number = gameConfig.rules.matchSeconds;
  /** Current walkable radius of the island (shrinks in the final stretch). */
  arenaRadius: number = gameConfig.arena.radius;
  winner: PlayerSlot | null = null;

  /** Camera heading: the camera sits at (sin yaw, ·, cos yaw) × distance looking at the centre. */
  cameraYaw = 0;
  /** Multiplier applied to real time before it is fed to the simulation and animations. */
  timeScale = 1;

  private slowMoScale = 1;
  private slowMoLeft = 0;

  // ── events ───────────────────────────────────────────────────────────────
  private handlers = new Map<GameEventType, Set<AnyHandler>>();
  private anyHandlers = new Set<AnyHandler>();

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends GameEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = handler as AnyHandler;
    set.add(h);
    return () => {
      set.delete(h);
    };
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  emit(event: GameEvent): void {
    const set = this.handlers.get(event.type);
    if (set) for (const h of set) h(event);
    for (const h of this.anyHandlers) h(event);
  }

  // ── HUD store (for useSyncExternalStore) ─────────────────────────────────
  private hud: HudState = initialHud();
  private hudListeners = new Set<() => void>();

  getHud = (): HudState => this.hud;

  subscribeHud = (listener: () => void): (() => void) => {
    this.hudListeners.add(listener);
    return () => {
      this.hudListeners.delete(listener);
    };
  };

  /** Shallow-merge a patch into the HUD state and notify React. */
  setHud(patch: Partial<HudState>): void {
    this.hud = { ...this.hud, ...patch };
    for (const l of this.hudListeners) l();
  }

  // ── players ──────────────────────────────────────────────────────────────
  private playersVersion = 0;
  private playersListeners = new Set<() => void>();

  getPlayersVersion = (): number => this.playersVersion;

  subscribePlayers = (listener: () => void): (() => void) => {
    this.playersListeners.add(listener);
    return () => {
      this.playersListeners.delete(listener);
    };
  };

  /**
   * Replace the set of wrestlers (lobby only). Creates fresh runtime records,
   * refreshes the HUD player list and notifies `usePlayers` subscribers.
   */
  setPlayers(setups: PlayerSetup[]): void {
    this.wrestlers = [...setups].sort((a, b) => a.slot - b.slot).map(createWrestler);
    this.playersVersion++;
    this.setHud({
      players: this.wrestlers.map((w) => ({
        slot: w.slot,
        name: w.name,
        control: w.control,
        score: 0,
        inPlay: false,
      })),
    });
    for (const l of this.playersListeners) l();
  }

  /** Attach (or clear with null) the input source for a slot, disposing the previous one. */
  setInput(slot: number, source: InputSource | null): void {
    const previous = this.inputs[slot];
    if (previous && previous !== source) previous.dispose?.();
    this.inputs[slot] = source;
  }

  /** Dispose and clear every input source. */
  clearInputs(): void {
    for (let slot = 0; slot < this.inputs.length; slot++) this.setInput(slot, null);
  }

  wrestler(slot: number): WrestlerRuntime | undefined {
    for (const w of this.wrestlers) if (w.slot === slot) return w;
    return undefined;
  }

  isInvulnerable(w: WrestlerRuntime): boolean {
    return this.simTime < w.invulnerableUntil;
  }

  // ── time ─────────────────────────────────────────────────────────────────
  /** Ask for slow motion: `scale` (e.g. 0.3) for `seconds` of real time. */
  requestSlowMo(scale: number, seconds: number): void {
    this.slowMoScale = scale;
    this.slowMoLeft = seconds;
  }

  /**
   * Call once per rendered frame with the real frame delta, before stepping the
   * simulation. Updates `timeScale` and returns the scaled delta.
   */
  advanceReal(realDt: number): number {
    if (this.slowMoLeft > 0) {
      this.slowMoLeft -= realDt;
      this.timeScale = this.slowMoScale;
    } else if (this.timeScale < 1) {
      // Ease back to full speed over ~0.15 s.
      this.timeScale = Math.min(1, this.timeScale + realDt / 0.15);
    }
    return realDt * this.timeScale;
  }

  /** Drop every subscription and input source. Call when the game screen unmounts. */
  dispose(): void {
    for (let i = 0; i < this.inputs.length; i++) {
      this.inputs[i]?.dispose?.();
      this.inputs[i] = null;
    }
    this.handlers.clear();
    this.anyHandlers.clear();
    this.hudListeners.clear();
    this.playersListeners.clear();
  }
}
