"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Quality = "low" | "medium" | "high";

export type Settings = {
  sound: boolean;
  quality: Quality;
  reduceMotion: boolean;
};

const DEFAULTS: Settings = { sound: true, quality: "medium", reduceMotion: false };
const KEY = "liquid-sumo:settings";

let cache: Settings | null = null;
const listeners = new Set<() => void>();

function read(): Settings {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}

function write(next: Settings) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode etc.) — keep the in-memory value.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Host-screen preferences, remembered per browser. */
export function useSettings() {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback(
    (patch: Partial<Settings>) => write({ ...read(), ...patch }),
    [],
  );
  return [settings, update] as const;
}
