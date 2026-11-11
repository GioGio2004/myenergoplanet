"use client";

import { motion } from "motion/react";
import { PLAYER_STYLES } from "../config";
import { useMatch } from "../hooks";
import type { HudPlayer } from "../types";
import { BlobAvatar } from "./BlobAvatar";
import { scoreboard } from "./hudLogic";
import { displayName } from "./lobbyLogic";
import {
  INK_EASE,
  PILL_PRIMARY,
  PILL_SECONDARY,
  SETTLE,
  ScorePips,
  SealSlam,
  playerTint,
  usePanelClass,
} from "./ui";
import { useHudValue } from "./useHudValue";

/** The camera needs a moment to swing round to the winner before the panel covers part of it. */
const ENTER_DELAY = 0.55;

/**
 * End-of-match panel, docked on the right so the winner (whom the camera is
 * orbiting in the middle of the screen) stays in view: who won, the final
 * scoreboard, and what to do next.
 */
export function Results() {
  const players = useHudValue((hud) => hud.players);
  const winnerSlot = useHudValue((hud) => hud.winner);
  const match = useMatch();
  const panel = usePanelClass();

  const standings = scoreboard(players, winnerSlot);
  const winner =
    winnerSlot === null ? null : (players.find((p) => p.slot === winnerSlot) ?? null);
  const winnerName = winner ? displayName(winner.name, winner.slot) : null;

  return (
    <div className="absolute inset-y-0 right-[2.6vw] flex items-center">
      <motion.section
        aria-label="Match results"
        className={`flex max-h-[94vh] w-[clamp(330px,31vw,580px)] max-w-[92vw] flex-col gap-[2.4vh] overflow-y-auto px-[3.2vh] py-[3.4vh] ${panel}`}
        initial={{ opacity: 0, x: 72 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 48, transition: { duration: 0.3, ease: "easeIn" } }}
        transition={{ ...SETTLE, delay: ENTER_DELAY }}
      >
        <div role="status" className="flex items-center gap-[2.2vh]">
          <SealSlam className="size-[clamp(54px,9.4vh,104px)]" delay={ENTER_DELAY + 0.4} />
          <div className="min-w-0 flex-1">
            <div className="pl-[0.1em] font-serif text-[clamp(1rem,2.3vh,1.6rem)] leading-none tracking-[0.34em] text-stone-blue uppercase">
              {winner ? "Winner" : "Match over"}
            </div>
            <motion.div
              className="mt-[0.9vh] font-brush text-[clamp(2.4rem,6.6vh,4.7rem)] leading-[1.05] [overflow-wrap:anywhere]"
              style={{ color: winner ? playerTint(winner.slot) : "var(--rice-paper)" }}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: INK_EASE, delay: ENTER_DELAY + 0.25 }}
            >
              {winnerName ?? "Draw"}
            </motion.div>
          </div>
        </div>

        <div aria-hidden className="h-px shrink-0 bg-stone-blue/25" />

        <ol className="flex flex-col gap-[1vh]">
          {standings.map(({ player, place }, index) => (
            <ScoreRow
              key={player.slot}
              player={player}
              place={place}
              won={player === winner}
              delay={ENTER_DELAY + 0.5 + index * 0.09}
            />
          ))}
        </ol>

        <div className="flex flex-col gap-[1.3vh] pt-[0.6vh] text-[clamp(0.95rem,2.1vh,1.35rem)]">
          <button type="button" onClick={() => match.rematch()} className={PILL_PRIMARY}>
            Rematch
          </button>
          <button type="button" onClick={() => match.toLobby()} className={PILL_SECONDARY}>
            Back to Lobby
          </button>
        </div>
      </motion.section>
    </div>
  );
}

function ScoreRow({
  player,
  place,
  won,
  delay,
}: {
  player: HudPlayer;
  place: number;
  won: boolean;
  delay: number;
}) {
  const style = PLAYER_STYLES[player.slot];
  return (
    <motion.li
      className={`flex items-center gap-[1.4vh] rounded-[20px] border py-[0.9vh] pr-[1.8vh] pl-[1.2vh] ${
        won ? "border-stone-blue/35 bg-ink/55" : "border-transparent bg-ink/25"
      }`}
      initial={{ opacity: 0, x: 26 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: INK_EASE, delay }}
    >
      <span className="w-[1.1em] shrink-0 text-center font-serif text-[clamp(1.1rem,2.6vh,1.9rem)] leading-none text-stone-blue tabular-nums lining-nums">
        {place}
      </span>
      <span
        aria-hidden
        className="w-[4px] shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: style.color }}
      />
      <BlobAvatar slot={player.slot} className="w-[clamp(34px,5.6vh,62px)]" />
      <div className="flex min-w-0 flex-1 flex-col gap-[0.7vh]">
        <span className="truncate font-serif text-[clamp(1.15rem,2.7vh,2rem)] leading-[1.15] font-medium text-rice-paper">
          {displayName(player.name, player.slot)}
        </span>
        <ScorePips
          slot={player.slot}
          score={player.score}
          className="text-[clamp(0.7rem,1.6vh,1.1rem)]"
        />
      </div>
      <span
        aria-hidden
        className="shrink-0 font-serif text-[clamp(1.9rem,4.6vh,3.3rem)] leading-none font-semibold tabular-nums lining-nums"
        style={{ color: style.color }}
      >
        {player.score}
      </span>
    </motion.li>
  );
}
