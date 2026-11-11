"use client";

import type { JSX } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useGameSettings } from "../hooks";
import type { Phase, PlayerSetup } from "../types";
import { Callouts } from "./Callouts";
import { Clock } from "./Clock";
import { ControlsStrip } from "./ControlsStrip";
import { Countdown } from "./Countdown";
import { LocalLobby } from "./LocalLobby";
import { MatchMenu } from "./MatchMenu";
import { PlayerCards } from "./PlayerCards";
import { Results } from "./Results";
import { useHudValue } from "./useHudValue";

export type HudProps = {
  /** Local player setup shown/edited in the lobby. */
  setups: PlayerSetup[];
  onSetupsChange: (next: PlayerSetup[]) => void;
  /** Leave the game screen (back to the landing page). */
  onExit: () => void;
  /** False when the roster comes from elsewhere (an online room): the local lobby is hidden. */
  showLobby?: boolean;
};

type Screen = "lobby" | "match" | "results";

function screenOf(phase: Phase): Screen {
  if (phase === "lobby") return "lobby";
  if (phase === "results") return "results";
  return "match";
}

/**
 * The DOM overlay on top of the 3D canvas: lobby, in-match HUD and results.
 *
 * It never renders per frame. Each piece subscribes to just the slice of the HUD
 * store it shows (`useHudValue`), so a clock tick re-renders the clock and nothing
 * else. The root ignores the pointer; only the interactive panels take it back.
 */
export function Hud({ setups, onSetupsChange, onExit, showLobby = true }: HudProps): JSX.Element {
  const { reduceMotion } = useGameSettings();
  const phase = useHudValue((hud) => hud.phase);
  const screen = screenOf(phase);
  const live = phase === "playing" || phase === "suddenDeath";

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden font-sans text-rice-paper">
        <AnimatePresence>
          {screen === "lobby" && showLobby && (
            <LocalLobby
              key="lobby"
              setups={setups}
              onSetupsChange={onSetupsChange}
              onExit={onExit}
            />
          )}

          {screen === "match" && (
            <motion.div
              key="match"
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.35 } }}
              transition={{ duration: 0.5 }}
            >
              <PlayerCards />
              <Clock />
              <Callouts />
              <ControlsStrip />
              {live && <MatchMenu />}
              <Countdown />
            </motion.div>
          )}

          {screen === "results" && <Results key="results" />}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
