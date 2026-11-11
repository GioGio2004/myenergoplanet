"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { QUALITY_PRESETS, type QualityLevel, type QualityPreset } from "./config";
import type { GameRuntime } from "./runtime";
import type {
  GameEventOf,
  GameEventType,
  HudState,
  MatchController,
  WrestlerRuntime,
} from "./types";

export type GameSettings = {
  qualityLevel: QualityLevel;
  quality: QualityPreset;
  reduceMotion: boolean;
};

export type GameContextValue = {
  runtime: GameRuntime;
  match: MatchController;
  settings: GameSettings;
};

const GameContext = createContext<GameContextValue | null>(null);

/**
 * Provides the runtime, the match controller and the display settings.
 * It must be rendered both outside the <Canvas> (for the HUD) and again inside it,
 * because React context does not cross the R3F reconciler boundary.
 */
export function GameProvider({
  value,
  children,
}: {
  value: GameContextValue;
  children: ReactNode;
}) {
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}

export function useRuntime(): GameRuntime {
  return useGame().runtime;
}

export function useMatch(): MatchController {
  return useGame().match;
}

export function useGameSettings(): GameSettings {
  return useGame().settings;
}

export function makeGameSettings(qualityLevel: QualityLevel, reduceMotion: boolean): GameSettings {
  return { qualityLevel, quality: QUALITY_PRESETS[qualityLevel], reduceMotion };
}

/** Low-frequency HUD state (phase, clock, scores, callouts). Re-renders on change. */
export function useHud(): HudState {
  const runtime = useRuntime();
  return useSyncExternalStore(runtime.subscribeHud, runtime.getHud, runtime.getHud);
}

/**
 * The current wrestlers. Re-renders only when the set of players changes
 * (`runtime.setPlayers`), never per frame — read positions from the records in `useFrame`.
 */
export function usePlayers(): WrestlerRuntime[] {
  const runtime = useRuntime();
  useSyncExternalStore(
    runtime.subscribePlayers,
    runtime.getPlayersVersion,
    runtime.getPlayersVersion,
  );
  return runtime.wrestlers;
}

/** Subscribe to a game event for the lifetime of the component. The handler may change freely. */
export function useGameEvent<T extends GameEventType>(
  type: T,
  handler: (event: GameEventOf<T>) => void,
): void {
  const runtime = useRuntime();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => runtime.on(type, (e) => ref.current(e)), [runtime, type]);
}
