"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGameEvent, useGameSettings } from "../hooks";
import { formatClock } from "./hudLogic";
import { INK_EASE, SETTLE } from "./ui";
import { useHudValue } from "./useHudValue";

const INK_SHADOW = "[text-shadow:0_4px_28px_rgba(1,16,31,0.75)]";

/**
 * Top-centre match clock. Turns scarlet and beats once a second in the final
 * stretch; in sudden death it gives way to a "Sudden death" label, announced
 * by a one-time banner across the middle of the screen.
 */
export function Clock() {
  const phase = useHudValue((hud) => hud.phase);
  const secondsLeft = useHudValue((hud) => hud.secondsLeft);
  const finalStretch = useHudValue((hud) => hud.finalStretch);
  const { reduceMotion } = useGameSettings();
  const sudden = phase === "suddenDeath";
  const time = formatClock(secondsLeft);

  // The outer rings are about to fall: a short notice under the clock, replayed per warning.
  const [crumbleWarning, setCrumbleWarning] = useState(0);
  useGameEvent("crumbleWarn", () => setCrumbleWarning((n) => n + 1));

  return (
    <>
      <div className="absolute inset-x-0 top-[2.4vh] flex flex-col items-center gap-[1.1vh]">
        <div className="rounded-full border border-stone-blue/25 bg-ink/65 px-[3.4vh] py-[0.6vh]">
          <AnimatePresence mode="wait" initial={false}>
            {sudden ? (
              <motion.div
                key="sudden"
                className="py-[0.9vh] pl-[0.34em] font-serif text-[clamp(1.4rem,3.4vh,2.6rem)] leading-none font-semibold tracking-[0.34em] text-scarlet uppercase"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: reduceMotion ? 1 : [1, 0.62, 1], y: 0 }}
                transition={{
                  y: { duration: 0.4, ease: INK_EASE },
                  opacity: reduceMotion
                    ? { duration: 0.4 }
                    : { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
                }}
              >
                Sudden death
              </motion.div>
            ) : (
              <motion.div
                key="clock"
                role="timer"
                aria-label={`Time left ${time}`}
                className={`font-serif text-[clamp(2.6rem,6.6vh,4.9rem)] leading-none font-medium tabular-nums lining-nums transition-colors duration-700 ease-ink ${
                  finalStretch ? "text-scarlet" : "text-rice-paper"
                }`}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                {/* Re-keyed every second in the final stretch so each tick lands as a beat. */}
                <motion.span
                  key={finalStretch ? secondsLeft : "steady"}
                  className="block"
                  initial={finalStretch ? { scale: 1.16 } : false}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.65, ease: INK_EASE }}
                >
                  {time}
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {crumbleWarning > 0 && (
          <motion.div
            key={crumbleWarning}
            className={`font-serif text-[clamp(1rem,2.3vh,1.6rem)] tracking-[0.28em] text-gold uppercase ${INK_SHADOW}`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: [0, 1, 1, 0], y: 0 }}
            transition={{
              opacity: { duration: 3.2, times: [0, 0.12, 0.8, 1], ease: "easeOut" },
              y: { duration: 0.5, ease: INK_EASE },
            }}
          >
            The ring is crumbling
          </motion.div>
        )}

        {/* Milestones only: reading out every second would drown everything else. */}
        <span className="sr-only" aria-live="polite">
          {sudden ? "Sudden death. Next knockout wins." : finalStretch ? "Final stretch." : ""}
        </span>
      </div>

      {sudden && <SuddenDeathBanner />}
    </>
  );
}

/** Plays once when it mounts (the moment sudden death begins), then stays invisible. */
function SuddenDeathBanner() {
  return (
    <motion.div
      aria-hidden
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: 2.7, times: [0, 0.1, 0.76, 1], ease: "easeOut" }}
    >
      {/* ink wash behind the lettering so it reads over any part of the scene */}
      <div className="absolute inset-x-0 top-1/2 h-[46vh] -translate-y-1/2 bg-[linear-gradient(to_bottom,transparent,rgba(1,16,31,0.78)_32%,rgba(1,16,31,0.78)_68%,transparent)]" />
      <motion.div
        className="relative h-px w-[min(62vw,960px)] bg-scarlet/70"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: INK_EASE }}
      />
      <motion.div
        className="relative px-[4vw] py-[1.5vh] font-brush text-[clamp(4.2rem,min(17vh,11vw),12rem)] leading-[1.05] whitespace-nowrap text-scarlet"
        initial={{ scale: 1.4 }}
        animate={{ scale: 1 }}
        transition={SETTLE}
      >
        Sudden Death
      </motion.div>
      <div className="relative pb-[2vh] pl-[0.3em] font-serif text-[clamp(1.2rem,3.1vh,2.3rem)] tracking-[0.3em] text-rice-paper uppercase">
        Next knockout wins
      </div>
      <motion.div
        className="relative h-px w-[min(62vw,960px)] bg-scarlet/70"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: INK_EASE }}
      />
    </motion.div>
  );
}
