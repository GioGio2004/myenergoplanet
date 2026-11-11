// Keyboard layouts for local play on the host screen. Values are KeyboardEvent.code.
// Shift is avoided on purpose: tapping it repeatedly opens Windows' Sticky Keys prompt.

export type KeyboardScheme = {
  id: "keyboardA" | "keyboardB";
  up: readonly string[];
  down: readonly string[];
  left: readonly string[];
  right: readonly string[];
  dash: readonly string[];
  brace: readonly string[];
  /** Short labels for the on-screen controls hint. */
  hint: { move: string; dash: string; brace: string };
};

export const KEYBOARD_SCHEMES: Record<"keyboardA" | "keyboardB", KeyboardScheme> = {
  keyboardA: {
    id: "keyboardA",
    up: ["KeyW"],
    down: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    dash: ["Space"],
    brace: ["KeyE", "KeyQ"],
    hint: { move: "W A S D", dash: "Space", brace: "E" },
  },
  keyboardB: {
    id: "keyboardB",
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    dash: ["Enter", "Slash", "Numpad0"],
    brace: ["Period", "Quote", "NumpadDecimal"],
    hint: { move: "Arrow keys", dash: "Enter", brace: "." },
  },
};
