"use client";

import { useSyncExternalStore } from "react";

// Minimal shared game state — no dependencies. The 3D world (Player, Targets)
// writes with simStore.set(); the DOM HUD reads reactively with useSimState().
// Per-frame data (positions, velocities) stays in refs — this store is only for
// values the HUD must re-render on.

export interface FeedEntry {
  id: number;
  text: string;
}

export interface SimState {
  ammo: number;
  magSize: number;
  reloading: boolean;
  score: number;
  hitAt: number; // performance.now() of the last confirmed hit (drives hitmarker)
  // ── multiplayer ──
  online: boolean;
  hp: number;
  maxHp: number;
  dead: boolean;
  damagedAt: number; // last time WE took damage (drives the red flash)
  feed: FeedEntry[]; // kill feed, newest first
}

let state: SimState = {
  ammo: 30,
  magSize: 30,
  reloading: false,
  score: 0,
  hitAt: 0,
  online: false,
  hp: 100,
  maxHp: 100,
  dead: false,
  damagedAt: 0,
  feed: [],
};

const subs = new Set<() => void>();
let feedId = 1;

export const simStore = {
  get: (): SimState => state,
  set: (patch: Partial<SimState>) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  },
  pushFeed: (text: string) => {
    state = { ...state, feed: [{ id: feedId++, text }, ...state.feed].slice(0, 5) };
    subs.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useSimState(): SimState {
  return useSyncExternalStore(simStore.subscribe, simStore.get, simStore.get);
}
