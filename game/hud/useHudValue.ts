"use client";

import { useSyncExternalStore } from "react";
import { useRuntime } from "../hooks";
import type { HudState } from "../types";

/**
 * Subscribe to one slice of the HUD store, so e.g. the clock ticking does not
 * re-render the player cards.
 *
 * `select` must return a primitive or a reference taken straight from the state
 * (the store replaces only the fields that change), never a freshly built object.
 */
export function useHudValue<T>(select: (hud: HudState) => T): T {
  const runtime = useRuntime();
  const getSnapshot = () => select(runtime.getHud());
  return useSyncExternalStore(runtime.subscribeHud, getSnapshot, getSnapshot);
}
