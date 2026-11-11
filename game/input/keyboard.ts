// Keyboard input for local play: up to two players sharing the host's keyboard.
//
// One key-state tracker is shared by every keyboard source. It is ref-counted: the
// listeners go onto `window` when the first source is created and come off again when
// the last one is disposed, so React StrictMode's create → dispose → create is safe and
// nothing touches `window` at module load (SSR).

import type { InputSource, PlayerInput } from "../types";
import type { KeyboardScheme } from "./schemes";

// ── pure helpers (no DOM, unit-tested) ───────────────────────────────────────

/** Anything that can answer "is this `KeyboardEvent.code` held?" (a `Set<string>` works). */
export type KeySet = { has(code: string): boolean };

type Stick = Pick<PlayerInput, "x" | "y">;

/** The structural part of a `KeyboardEvent` the tracker needs. */
export type KeyEventLike = {
  readonly code: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: unknown;
  preventDefault(): void;
};

function anyHeld(pressed: KeySet, codes: readonly string[]): boolean {
  for (let i = 0; i < codes.length; i++) {
    if (pressed.has(codes[i])) return true;
  }
  return false;
}

/**
 * Stick vector for a set of held key codes: x = right, y = up the screen.
 * Opposite keys cancel, diagonals are normalised to length 1. Writes into `out`.
 */
export function stickFromKeys<T extends Stick>(pressed: KeySet, scheme: KeyboardScheme, out: T): T {
  let x = (anyHeld(pressed, scheme.right) ? 1 : 0) - (anyHeld(pressed, scheme.left) ? 1 : 0);
  let y = (anyHeld(pressed, scheme.up) ? 1 : 0) - (anyHeld(pressed, scheme.down) ? 1 : 0);
  if (x !== 0 && y !== 0) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  out.x = x;
  out.y = y;
  return out;
}

/** Full controller sample (stick + held buttons) for a set of held key codes. */
export function readScheme(pressed: KeySet, scheme: KeyboardScheme, out: PlayerInput): PlayerInput {
  stickFromKeys(pressed, scheme, out);
  out.dash = anyHeld(pressed, scheme.dash);
  out.brace = anyHeld(pressed, scheme.brace);
  return out;
}

/** True when the event target is somewhere the user types (name inputs in the lobby). */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  if (typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function hasModifier(event: KeyEventLike): boolean {
  return event.ctrlKey === true || event.metaKey === true || event.altKey === true;
}

/**
 * Should the browser's default action for this key event be suppressed?
 * Only for keys an active scheme uses (arrows / Space scroll the page, Enter / Space
 * click the focused button) — never while typing and never for shortcuts.
 */
export function shouldPreventDefault(event: KeyEventLike, activeCodes: KeySet): boolean {
  if (hasModifier(event)) return false;
  if (!activeCodes.has(event.code)) return false;
  return !isTypingTarget(event.target);
}

/**
 * Should this keydown count as game input? Auto-repeat, shortcuts (Ctrl/Meta/Alt held)
 * and keys typed into a text field do not.
 */
export function shouldTrackKeyDown(event: KeyEventLike): boolean {
  if (event.repeat === true) return false;
  if (hasModifier(event)) return false;
  return !isTypingTarget(event.target);
}

// ── shared key-state tracker ─────────────────────────────────────────────────

type Listener = (event: Event) => void;

/** The slice of `window` / `document` the tracker listens on. */
export type ListenerTarget = {
  addEventListener(type: string, listener: Listener, options?: boolean): void;
  removeEventListener(type: string, listener: Listener, options?: boolean): void;
};

/** Where key events come from. In the browser: `{ window, document }`. */
export type KeyboardHost = {
  window: ListenerTarget;
  document?: ListenerTarget & { readonly hidden: boolean };
};

function isMetaCode(code: string): boolean {
  return code === "MetaLeft" || code === "MetaRight" || code === "OSLeft" || code === "OSRight";
}

/**
 * Tracks which keys are held, for any number of keyboard sources.
 * `retain` / `release` are called once per source; listeners live exactly as long as
 * at least one source does.
 */
export class KeyTracker {
  /** Codes currently held. Read by every source's `sample`. */
  readonly pressed = new Set<string>();

  /** code → number of active sources whose scheme uses it. */
  private readonly activeCounts = new Map<string, number>();
  /** `has(code)` view of the codes used by any active scheme. */
  readonly activeCodes: KeySet = this.activeCounts;

  private users = 0;
  private host: KeyboardHost | null = null;
  private readonly resolveHost: () => KeyboardHost | null;

  constructor(resolveHost: () => KeyboardHost | null) {
    this.resolveHost = resolveHost;
  }

  /** Number of live sources (for tests / diagnostics). */
  get userCount(): number {
    return this.users;
  }

  get attached(): boolean {
    return this.host !== null;
  }

  retain(scheme: KeyboardScheme): void {
    this.countCodes(scheme, 1);
    this.users++;
    // Also retried on later retains, in case the first one happened without a window.
    if (this.host === null) this.attach();
  }

  release(scheme: KeyboardScheme): void {
    if (this.users === 0) return;
    this.countCodes(scheme, -1);
    this.users--;
    if (this.users === 0) this.detach();
  }

  handleKeyDown(event: KeyEventLike): void {
    if (shouldPreventDefault(event, this.activeCodes)) event.preventDefault();
    if (shouldTrackKeyDown(event)) this.pressed.add(event.code);
  }

  handleKeyUp(event: KeyEventLike): void {
    // Space activates a focused button on keyup, so the release is suppressed too.
    if (shouldPreventDefault(event, this.activeCodes)) event.preventDefault();
    // Always honour a release, wherever focus is, so no key can stick.
    this.pressed.delete(event.code);
    // macOS swallows the keyup of other keys while Cmd is held: drop everything.
    if (isMetaCode(event.code)) this.pressed.clear();
  }

  /** Forget every held key (focus left the window, tab hidden, last source gone). */
  clear(): void {
    this.pressed.clear();
  }

  private countCodes(scheme: KeyboardScheme, delta: number): void {
    this.countList(scheme.up, delta);
    this.countList(scheme.down, delta);
    this.countList(scheme.left, delta);
    this.countList(scheme.right, delta);
    this.countList(scheme.dash, delta);
    this.countList(scheme.brace, delta);
  }

  private countList(codes: readonly string[], delta: number): void {
    for (let i = 0; i < codes.length; i++) {
      const next = (this.activeCounts.get(codes[i]) ?? 0) + delta;
      if (next > 0) this.activeCounts.set(codes[i], next);
      else this.activeCounts.delete(codes[i]);
    }
  }

  // Stable listener identities so add/remove always pair up.
  private readonly onKeyDown: Listener = (event) => {
    this.handleKeyDown(event as KeyboardEvent);
  };
  private readonly onKeyUp: Listener = (event) => {
    this.handleKeyUp(event as KeyboardEvent);
  };
  private readonly onBlur: Listener = () => {
    this.clear();
  };
  private readonly onVisibilityChange: Listener = () => {
    if (this.host?.document?.hidden) this.clear();
  };

  private attach(): void {
    const host = this.resolveHost();
    if (!host) return;
    this.host = host;
    // Capture phase: a component calling stopPropagation() must not leave a key stuck.
    host.window.addEventListener("keydown", this.onKeyDown, true);
    host.window.addEventListener("keyup", this.onKeyUp, true);
    host.window.addEventListener("blur", this.onBlur);
    host.document?.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private detach(): void {
    const host = this.host;
    this.host = null;
    this.pressed.clear();
    if (!host) return;
    host.window.removeEventListener("keydown", this.onKeyDown, true);
    host.window.removeEventListener("keyup", this.onKeyUp, true);
    host.window.removeEventListener("blur", this.onBlur);
    host.document?.removeEventListener("visibilitychange", this.onVisibilityChange);
  }
}

/** A keyboard source reading from the given tracker (the public factory uses the shared one). */
export function createKeyboardSourceOn(tracker: KeyTracker, scheme: KeyboardScheme): InputSource {
  let disposed = false;
  tracker.retain(scheme);
  return {
    sample(out: PlayerInput): void {
      if (disposed) {
        out.x = 0;
        out.y = 0;
        out.dash = false;
        out.brace = false;
        return;
      }
      readScheme(tracker.pressed, scheme, out);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      tracker.release(scheme);
    },
  };
}

function browserHost(): KeyboardHost | null {
  if (typeof window === "undefined") return null;
  return { window, document: typeof document === "undefined" ? undefined : document };
}

/** The one tracker shared by every source made with `createKeyboardSource`. */
const sharedTracker = new KeyTracker(browserHost);

/**
 * Input source for one half of the keyboard. Call `dispose()` when the player leaves;
 * the window listeners are removed once the last keyboard source is disposed.
 */
export function createKeyboardSource(scheme: KeyboardScheme): InputSource {
  return createKeyboardSourceOn(sharedTracker, scheme);
}
