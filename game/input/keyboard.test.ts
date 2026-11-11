import { describe, expect, it } from "vitest";
import { GameRuntime } from "../runtime";
import type { PlayerInput } from "../types";
import {
  KeyTracker,
  createKeyboardSource,
  createKeyboardSourceOn,
  isTypingTarget,
  readScheme,
  shouldPreventDefault,
  shouldTrackKeyDown,
  stickFromKeys,
  type KeyEventLike,
  type KeyboardHost,
} from "./keyboard";
import { KEYBOARD_SCHEMES } from "./schemes";

const A = KEYBOARD_SCHEMES.keyboardA;
const B = KEYBOARD_SCHEMES.keyboardB;

function keys(...codes: string[]): Set<string> {
  return new Set(codes);
}

function input(): PlayerInput {
  return { x: 9, y: 9, dash: true, brace: true };
}

function keyEvent(code: string, extra: Partial<KeyEventLike> = {}): KeyEventLike & { prevented: boolean } {
  const event = {
    code,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...extra,
  };
  return event;
}

/** A fake window/document pair built on Node's EventTarget, counting live listeners. */
function fakeHost() {
  let listeners = 0;
  const counting = <T extends EventTarget>(target: T): T => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (...args: Parameters<EventTarget["addEventListener"]>) => {
      listeners++;
      add(...args);
    };
    target.removeEventListener = (...args: Parameters<EventTarget["removeEventListener"]>) => {
      listeners--;
      remove(...args);
    };
    return target;
  };
  const win = counting(new EventTarget());
  const doc = Object.assign(counting(new EventTarget()), { hidden: false });
  const host: KeyboardHost = { window: win, document: doc };
  const fire = (type: "keydown" | "keyup", code: string, extra: Record<string, unknown> = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, ...extra });
    win.dispatchEvent(event);
    return event;
  };
  return {
    host,
    win,
    doc,
    fire,
    get listeners() {
      return listeners;
    },
  };
}

describe("stickFromKeys", () => {
  it("is neutral with nothing held", () => {
    expect(stickFromKeys(keys(), A, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
  });

  it("maps single keys to unit axes (y = up the screen)", () => {
    expect(stickFromKeys(keys("KeyW"), A, { x: 0, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(stickFromKeys(keys("KeyS"), A, { x: 0, y: 0 })).toEqual({ x: 0, y: -1 });
    expect(stickFromKeys(keys("KeyA"), A, { x: 0, y: 0 })).toEqual({ x: -1, y: 0 });
    expect(stickFromKeys(keys("KeyD"), A, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(stickFromKeys(keys("ArrowUp"), B, { x: 0, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(stickFromKeys(keys("ArrowLeft"), B, { x: 0, y: 0 })).toEqual({ x: -1, y: 0 });
  });

  it("cancels opposite keys", () => {
    expect(stickFromKeys(keys("KeyA", "KeyD"), A, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(stickFromKeys(keys("KeyW", "KeyS", "KeyD"), A, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
  });

  it("normalises diagonals to length 1", () => {
    const v = stickFromKeys(keys("KeyW", "KeyD"), A, { x: 0, y: 0 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 10);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeGreaterThan(0);
    const w = stickFromKeys(keys("ArrowDown", "ArrowLeft"), B, { x: 0, y: 0 });
    expect(Math.hypot(w.x, w.y)).toBeCloseTo(1, 10);
    expect(w.x).toBeLessThan(0);
    expect(w.y).toBeLessThan(0);
  });

  it("ignores the other player's keys", () => {
    expect(stickFromKeys(keys("ArrowUp", "ArrowRight", "Enter"), A, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(stickFromKeys(keys("KeyW", "KeyD", "Space"), B, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("readScheme", () => {
  it("reads held buttons, including aliases", () => {
    for (const code of B.dash) {
      const out = readScheme(keys(code), B, input());
      expect(out).toEqual({ x: 0, y: 0, dash: true, brace: false });
    }
    for (const code of A.brace) {
      const out = readScheme(keys(code), A, input());
      expect(out).toEqual({ x: 0, y: 0, dash: false, brace: true });
    }
    expect(readScheme(keys("Space", "KeyE", "KeyD"), A, input())).toEqual({ x: 1, y: 0, dash: true, brace: true });
  });

  it("overwrites every field when nothing is held", () => {
    expect(readScheme(keys(), A, input())).toEqual({ x: 0, y: 0, dash: false, brace: false });
  });
});

describe("preventDefault policy", () => {
  const active = keys("Space", "ArrowUp", "Enter", "KeyW");

  it("blocks keys used by an active scheme", () => {
    expect(shouldPreventDefault(keyEvent("Space"), active)).toBe(true);
    expect(shouldPreventDefault(keyEvent("ArrowUp"), active)).toBe(true);
    expect(shouldPreventDefault(keyEvent("Enter", { target: { tagName: "BUTTON" } }), active)).toBe(true);
  });

  it("never blocks keys outside the active schemes", () => {
    expect(shouldPreventDefault(keyEvent("Tab"), active)).toBe(false);
    expect(shouldPreventDefault(keyEvent("F5"), active)).toBe(false);
    expect(shouldPreventDefault(keyEvent("Space"), keys())).toBe(false);
  });

  it("never blocks shortcuts", () => {
    expect(shouldPreventDefault(keyEvent("KeyW", { ctrlKey: true }), active)).toBe(false);
    expect(shouldPreventDefault(keyEvent("KeyW", { metaKey: true }), active)).toBe(false);
    expect(shouldPreventDefault(keyEvent("ArrowUp", { altKey: true }), active)).toBe(false);
  });

  it("does not swallow keys while the user is typing", () => {
    for (const target of [
      { tagName: "INPUT" },
      { tagName: "input" },
      { tagName: "TEXTAREA" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
    ]) {
      expect(isTypingTarget(target)).toBe(true);
      expect(shouldPreventDefault(keyEvent("Space", { target }), active)).toBe(false);
      expect(shouldTrackKeyDown(keyEvent("KeyW", { target }))).toBe(false);
    }
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("INPUT")).toBe(false);
  });

  it("ignores auto-repeat and shortcuts for key state", () => {
    expect(shouldTrackKeyDown(keyEvent("KeyW"))).toBe(true);
    expect(shouldTrackKeyDown(keyEvent("KeyW", { repeat: true }))).toBe(false);
    expect(shouldTrackKeyDown(keyEvent("KeyD", { ctrlKey: true }))).toBe(false);
  });
});

describe("KeyTracker", () => {
  const runtime = new GameRuntime();

  it("feeds sources from window key events", () => {
    const h = fakeHost();
    const tracker = new KeyTracker(() => h.host);
    const a = createKeyboardSourceOn(tracker, A);
    const b = createKeyboardSourceOn(tracker, B);
    const outA = input();
    const outB = input();

    h.fire("keydown", "KeyW");
    h.fire("keydown", "ArrowLeft");
    h.fire("keydown", "Enter");
    a.sample(outA, 0, runtime, 1 / 60);
    b.sample(outB, 1, runtime, 1 / 60);
    expect(outA).toEqual({ x: 0, y: 1, dash: false, brace: false });
    expect(outB).toEqual({ x: -1, y: 0, dash: true, brace: false });

    h.fire("keyup", "KeyW");
    h.fire("keyup", "Enter");
    a.sample(outA, 0, runtime, 1 / 60);
    b.sample(outB, 1, runtime, 1 / 60);
    expect(outA).toEqual({ x: 0, y: 0, dash: false, brace: false });
    expect(outB).toEqual({ x: -1, y: 0, dash: false, brace: false });

    a.dispose?.();
    b.dispose?.();
  });

  it("prevents the default action only for active scheme keys", () => {
    const h = fakeHost();
    const tracker = new KeyTracker(() => h.host);
    const a = createKeyboardSourceOn(tracker, A);

    expect(h.fire("keydown", "Space").defaultPrevented).toBe(true);
    expect(h.fire("keyup", "Space").defaultPrevented).toBe(true);
    expect(h.fire("keydown", "Space", { repeat: true }).defaultPrevented).toBe(true);
    // Arrows belong to scheme B, which has no source: the page may scroll.
    expect(h.fire("keydown", "ArrowDown").defaultPrevented).toBe(false);
    expect(h.fire("keydown", "Tab").defaultPrevented).toBe(false);
    expect(h.fire("keydown", "KeyW", { ctrlKey: true }).defaultPrevented).toBe(false);

    const b = createKeyboardSourceOn(tracker, B);
    expect(h.fire("keydown", "ArrowDown").defaultPrevented).toBe(true);
    b.dispose?.();
    expect(h.fire("keydown", "ArrowDown").defaultPrevented).toBe(false);
    expect(h.fire("keydown", "Space").defaultPrevented).toBe(true);
    a.dispose?.();
    expect(h.fire("keydown", "Space").defaultPrevented).toBe(false);
  });

  it("leaves typing alone but still honours the key release", () => {
    const tracker = new KeyTracker(() => null);
    const a = createKeyboardSourceOn(tracker, A);
    const out = input();
    const field = { tagName: "INPUT" };

    const typed = keyEvent("KeyW", { target: field });
    tracker.handleKeyDown(typed);
    expect(typed.prevented).toBe(false);
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.y).toBe(0);

    // Pressed in the game, released after focus moved into a text field.
    tracker.handleKeyDown(keyEvent("KeyW"));
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.y).toBe(1);
    const released = keyEvent("KeyW", { target: field });
    tracker.handleKeyUp(released);
    expect(released.prevented).toBe(false);
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.y).toBe(0);
    a.dispose?.();
  });

  it("clears every key on blur and when the tab is hidden", () => {
    const h = fakeHost();
    const tracker = new KeyTracker(() => h.host);
    const a = createKeyboardSourceOn(tracker, A);
    const out = input();

    h.fire("keydown", "KeyD");
    h.win.dispatchEvent(new Event("blur"));
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.x).toBe(0);

    // Auto-repeat after the blur must not resurrect the key.
    h.fire("keydown", "KeyD", { repeat: true });
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.x).toBe(0);

    h.fire("keydown", "KeyD");
    h.doc.dispatchEvent(new Event("visibilitychange"));
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.x).toBe(1); // still visible: nothing cleared
    h.doc.hidden = true;
    h.doc.dispatchEvent(new Event("visibilitychange"));
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.x).toBe(0);
    a.dispose?.();
  });

  it("drops all keys when the Meta key is released", () => {
    const h = fakeHost();
    const tracker = new KeyTracker(() => h.host);
    const a = createKeyboardSourceOn(tracker, A);
    const out = input();
    h.fire("keydown", "KeyD");
    h.fire("keyup", "MetaLeft");
    a.sample(out, 0, runtime, 1 / 60);
    expect(out.x).toBe(0);
    a.dispose?.();
  });

  it("is ref-counted: listeners live from the first source to the last dispose", () => {
    const h = fakeHost();
    const tracker = new KeyTracker(() => h.host);
    expect(h.listeners).toBe(0);

    const a = createKeyboardSourceOn(tracker, A);
    const attached = h.listeners;
    expect(attached).toBe(4); // keydown, keyup, blur, visibilitychange
    const b = createKeyboardSourceOn(tracker, B);
    expect(h.listeners).toBe(attached);
    expect(tracker.userCount).toBe(2);

    a.dispose?.();
    expect(h.listeners).toBe(attached);
    a.dispose?.(); // double dispose must not release twice
    expect(tracker.userCount).toBe(1);
    expect(h.listeners).toBe(attached);

    const out = input();
    h.fire("keydown", "KeyW");
    h.fire("keydown", "ArrowUp");
    a.sample(out, 0, runtime, 1 / 60);
    expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false }); // disposed → neutral
    b.sample(out, 1, runtime, 1 / 60);
    expect(out.y).toBe(1);

    b.dispose?.();
    expect(h.listeners).toBe(0);
    expect(tracker.attached).toBe(false);
    expect(tracker.pressed.size).toBe(0);
  });

  it("survives StrictMode's create → dispose → create", () => {
    const h = fakeHost();
    const tracker = new KeyTracker(() => h.host);
    const first = createKeyboardSourceOn(tracker, A);
    first.dispose?.();
    expect(h.listeners).toBe(0);
    const second = createKeyboardSourceOn(tracker, A);
    expect(h.listeners).toBe(4);

    const out = input();
    h.fire("keydown", "KeyA");
    second.sample(out, 0, runtime, 1 / 60);
    expect(out.x).toBe(-1);
    second.dispose?.();
    expect(h.listeners).toBe(0);
  });
});

describe("createKeyboardSource", () => {
  it("is safe without a window (SSR / node)", () => {
    const source = createKeyboardSource(A);
    const out = input();
    source.sample(out, 0, new GameRuntime(), 1 / 60);
    expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false });
    source.dispose?.();
    source.dispose?.();
  });
});
