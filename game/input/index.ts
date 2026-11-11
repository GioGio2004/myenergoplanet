// Input sources for local play: two players on one keyboard, and bots.

import type { ControlKind, InputSource } from "../types";
import { createBotSource } from "./bot";
import { createKeyboardSource } from "./keyboard";
import { KEYBOARD_SCHEMES } from "./schemes";

export { createBotSource, worldToInput } from "./bot";
export type { BotOptions } from "./bot";
export { createKeyboardSource, stickFromKeys } from "./keyboard";
export { KEYBOARD_SCHEMES } from "./schemes";
export type { KeyboardScheme } from "./schemes";

/**
 * The input source for a way of controlling a wrestler, or `null` when the input does
 * not come from this machine (`remote` = a phone, wired up in a later phase).
 * The caller owns the source and must `dispose()` it.
 */
export function createInputSource(control: ControlKind): InputSource | null {
  switch (control) {
    case "keyboardA":
    case "keyboardB":
      return createKeyboardSource(KEYBOARD_SCHEMES[control]);
    case "bot":
      return createBotSource();
    case "remote":
      return null;
  }
}
