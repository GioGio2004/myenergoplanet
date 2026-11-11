"use client";

import { useSyncExternalStore } from "react";
import { randomFunName } from "./funNames";

// One random suggestion per page load. Read through useSyncExternalStore so the server
// render (empty) and the browser (random) never disagree during hydration.
let suggestion: string | null = null;

const subscribe = () => () => {};
const getSnapshot = () => (suggestion ??= randomFunName());
const getServerSnapshot = () => "";

/** A fun default player name such as "Swift Dumpling" (empty during server rendering). */
export function useSuggestedName(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
