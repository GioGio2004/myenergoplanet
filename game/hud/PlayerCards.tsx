"use client";

import { useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { PLAYER_STYLES } from "../config";
import { useGameEvent } from "../hooks";
import type { HudPlayer, PlayerSlot } from "../types";
import { BlobAvatar } from "./BlobAvatar";
import { displayName } from "./lobbyLogic";
import { INK_EASE, SETTLE, ScorePips } from "./ui";
import { useHudValue } from "./useHudValue";

type Corner = { box: string; origin: string; right: boolean; bottom: boolean };

/** Slot 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
const CORNERS: Record<PlayerSlot, Corner> = {
  0: { box: "top-[3vh] left-[2.2vw]", origin: "origin-top-left", right: false, bottom: false },
  1: { box: "top-[3vh] right-[2.2vw]", origin: "origin-top-right", right: true, bottom: false },
  2: { box: "bottom-[3vh] left-[2.2vw]", origin: "origin-bottom-left", right: false, bottom: true },
  3: { box: "right-[2.2vw] bottom-[3vh]", origin: "origin-bottom-right", right: true, bottom: true },
};

/** One score card per configured player, pinned to that slot's screen corner. */
export function PlayerCards() {
  const players = useHudValue((hud) => hud.players);
  const phase = useHudValue((hud) => hud.phase);
  // Before the first bell nobody is "out": they simply have not dropped in yet.
  const live = phase === "playing" || phase === "suddenDeath";
  return (
    <>
      {players.map((player) => (
        <PlayerCard key={player.slot} player={player} live={live} />
      ))}
    </>
  );
}

function PlayerCard({ player, live }: { player: HudPlayer; live: boolean }) {
  const { slot } = player;
  const style = PLAYER_STYLES[slot];
  const corner = CORNERS[slot];
  const name = displayName(player.name, slot);
  const out = live && !player.inPlay;

  // A point scored: the card swells once and throws a ring of the player's glow.
  const bump = useAnimationControls();
  const [pulse, setPulse] = useState(0);
  useGameEvent("score", (event) => {
    if (event.slot !== slot || event.delta <= 0) return;
    setPulse((n) => n + 1);
    void bump.start({ scale: [1, 1.07, 1], transition: { duration: 0.6, ease: INK_EASE } });
  });

  return (
    <motion.div
      role="group"
      aria-label={`${name}: ${player.score} points${out ? ", respawning" : ""}`}
      className={`absolute ${corner.box}`}
      initial={{ opacity: 0, y: corner.bottom ? 18 : -18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SETTLE, delay: 0.08 * slot }}
    >
      <motion.div
        animate={bump}
        className={`relative rounded-[28px] border border-stone-blue/25 bg-ink/70 ${corner.origin}`}
      >
        {pulse > 0 && (
          <motion.span
            key={pulse}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{ boxShadow: `0 0 0 2px ${style.color}, 0 0 38px 6px ${style.glow}` }}
            initial={{ opacity: 0.95, scale: 1 }}
            animate={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.95, ease: INK_EASE }}
          />
        )}

        <motion.div
          initial={false}
          animate={{ opacity: out ? 0.42 : 1 }}
          transition={{ duration: 0.35, ease: INK_EASE }}
          className={`flex items-center gap-[1.5vh] py-[1.2vh] ${
            corner.right ? "flex-row-reverse pr-[1.3vh] pl-[2.6vh]" : "pr-[2.6vh] pl-[1.3vh]"
          }`}
        >
          {/* colour bar on the outer edge: readable even when the avatar is tiny */}
          <span
            aria-hidden
            className="w-[5px] self-stretch rounded-full"
            style={{ backgroundColor: style.color }}
          />
          <BlobAvatar slot={slot} className="w-[clamp(46px,8vh,92px)]" />
          <div
            className={`flex min-w-0 flex-col gap-[0.8vh] ${
              corner.right ? "items-end" : "items-start"
            }`}
          >
            <span className="max-w-[9.5em] truncate font-serif text-[clamp(1.3rem,3vh,2.3rem)] leading-[1.15] font-medium text-rice-paper">
              {name}
            </span>
            <ScorePips
              slot={slot}
              score={player.score}
              className="text-[clamp(0.8rem,1.9vh,1.35rem)]"
            />
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {out && (
          <motion.span
            key="respawn"
            aria-hidden
            className={`absolute text-[clamp(0.7rem,1.5vh,1rem)] tracking-[0.26em] whitespace-nowrap text-stone-blue uppercase ${
              corner.bottom ? "bottom-full mb-[0.9vh]" : "top-full mt-[0.9vh]"
            } ${corner.right ? "right-[1.4vh]" : "left-[1.4vh]"}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.55, 1] }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 1.6, ease: "easeInOut" }}
          >
            Respawning…
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
