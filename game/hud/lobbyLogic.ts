// Pure helpers for editing the local player setup in the lobby. No React, no DOM.

import { PLAYER_STYLES, gameConfig } from "../config";
import type { ControlKind, PlayerSetup, PlayerSlot } from "../types";

/** What a lobby slot is set to: a controller, or nobody at all. */
export type SlotControl = ControlKind | "off";

export const ALL_SLOTS: readonly PlayerSlot[] = [0, 1, 2, 3];
export const MAX_NAME_LENGTH = 14;

/** Order the control selector goes through. `remote` (phones) is not selectable locally. */
export const CONTROL_CYCLE: readonly SlotControl[] = ["off", "keyboardA", "keyboardB", "bot"];

/** Short labels for the segmented control. */
export const CONTROL_LABELS: Record<SlotControl, string> = {
  off: "Off",
  keyboardA: "Keys A",
  keyboardB: "Keys B",
  bot: "Bot",
  remote: "Phone",
};

/** Long form of the control labels (aria labels and status lines). */
export const CONTROL_NAMES: Record<SlotControl, string> = {
  off: "Off",
  keyboardA: "Keyboard A",
  keyboardB: "Keyboard B",
  bot: "Bot",
  remote: "Phone",
};

export function isKeyboardControl(
  control: SlotControl,
): control is "keyboardA" | "keyboardB" {
  return control === "keyboardA" || control === "keyboardB";
}

export function defaultName(slot: PlayerSlot): string {
  return PLAYER_STYLES[slot].label;
}

/** The name to show for a player: their own, or the slot colour name if it is blank. */
export function displayName(name: string, slot: PlayerSlot): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : defaultName(slot);
}

/**
 * Clean a name while it is being typed: collapse whitespace runs, drop leading
 * spaces and cap the length (by code point, so an emoji is never cut in half).
 * A trailing space is kept so "Big Wave" can be typed naturally.
 */
export function sanitizeName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").replace(/^ /, "");
  return Array.from(collapsed).slice(0, MAX_NAME_LENGTH).join("");
}

export function findSetup(
  setups: readonly PlayerSetup[],
  slot: PlayerSlot,
): PlayerSetup | undefined {
  return setups.find((s) => s.slot === slot);
}

export function controlOf(setups: readonly PlayerSetup[], slot: PlayerSlot): SlotControl {
  return findSetup(setups, slot)?.control ?? "off";
}

/** Next entry of the Off, Keyboard A, Keyboard B, Bot cycle. */
export function nextControl(current: SlotControl): SlotControl {
  // Anything outside the cycle (a phone) has index -1 and so steps to "off".
  const i = CONTROL_CYCLE.indexOf(current);
  return CONTROL_CYCLE[(i + 1) % CONTROL_CYCLE.length];
}

function bySlot(a: PlayerSetup, b: PlayerSetup): number {
  return a.slot - b.slot;
}

/**
 * Returns a new setup list with `slot` set to `control`.
 * - "off" removes the slot.
 * - A keyboard scheme belongs to one slot at a time: taking it turns its previous
 *   holder into a bot.
 * - A slot that is switched on keeps its name, else gets `rememberedName`, else
 *   the slot colour name.
 * The result is always sorted by slot.
 */
export function setSlotControl(
  setups: readonly PlayerSetup[],
  slot: PlayerSlot,
  control: SlotControl,
  rememberedName?: string,
): PlayerSetup[] {
  const next: PlayerSetup[] = [];
  for (const setup of setups) {
    if (setup.slot === slot) continue;
    next.push(
      isKeyboardControl(control) && setup.control === control
        ? { ...setup, control: "bot" }
        : setup,
    );
  }
  if (control !== "off") {
    const existing = findSetup(setups, slot);
    const name = existing?.name ?? sanitizeName(rememberedName ?? "");
    next.push({ slot, name: name.trim().length > 0 ? name : defaultName(slot), control });
  }
  return next.sort(bySlot);
}

/** Returns a new setup list with the slot renamed (no-op for a slot that is off). */
export function setSlotName(
  setups: readonly PlayerSetup[],
  slot: PlayerSlot,
  rawName: string,
): PlayerSetup[] {
  const name = sanitizeName(rawName);
  return setups.map((s) => (s.slot === slot ? { ...s, name } : s)).sort(bySlot);
}

/** Tidy a name once editing ends: trimmed, and never blank. */
export function commitSlotName(
  setups: readonly PlayerSetup[],
  slot: PlayerSlot,
): PlayerSetup[] {
  return setups
    .map((s) => (s.slot === slot ? { ...s, name: displayName(s.name, slot) } : s))
    .sort(bySlot);
}

/** How many more active slots are needed before a match can start (0 = ready). */
export function playersNeeded(setups: readonly PlayerSetup[]): number {
  return Math.max(0, gameConfig.minPlayers - setups.length);
}
