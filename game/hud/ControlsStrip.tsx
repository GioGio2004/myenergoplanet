"use client";

import { AnimatePresence, motion } from "motion/react";
import type { HudPlayer } from "../types";
import { BlobAvatar } from "./BlobAvatar";
import { KeyHints } from "./KeyHints";
import { displayName, isKeyboardControl } from "./lobbyLogic";
import { INK_EASE, SETTLE, playerTint } from "./ui";
import { useHudValue } from "./useHudValue";

/**
 * Key reminder for the players on this keyboard, shown along the bottom while the
 * wrestlers drop in and the countdown runs. It fades away once play begins.
 */
export function ControlsStrip() {
  const phase = useHudValue((hud) => hud.phase);
  const players = useHudValue((hud) => hud.players);
  const show = phase === "intro" || phase === "countdown";
  const onKeyboard = players.filter((player) => isKeyboardControl(player.control));

  return (
    <AnimatePresence>
      {show && onKeyboard.length > 0 && (
        <motion.div
          key="controls"
          className="absolute inset-x-0 bottom-[3vh] flex flex-col items-center gap-[1vh] px-[4vw]"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10, transition: { duration: 0.6, ease: INK_EASE } }}
          transition={{ ...SETTLE, delay: 0.35 }}
        >
          {onKeyboard.map((player) => (
            <ControlsRow key={player.slot} player={player} />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ControlsRow({ player }: { player: HudPlayer }) {
  if (!isKeyboardControl(player.control)) return null;
  return (
    <div className="flex max-w-full items-center gap-[1.1em] rounded-full border border-stone-blue/25 bg-ink/70 py-[0.45em] pr-[1.5em] pl-[0.9em] text-[clamp(0.85rem,1.9vh,1.3rem)]">
      <span className="flex min-w-0 items-center gap-[0.5em]">
        <BlobAvatar slot={player.slot} className="w-[1.9em]" />
        <span
          className="max-w-[8em] truncate font-serif text-[1.25em] leading-tight font-medium"
          style={{ color: playerTint(player.slot) }}
        >
          {displayName(player.name, player.slot)}
        </span>
      </span>
      <span aria-hidden className="h-[1.4em] w-px shrink-0 bg-stone-blue/30" />
      <KeyHints scheme={player.control} layout="inline" />
    </div>
  );
}
