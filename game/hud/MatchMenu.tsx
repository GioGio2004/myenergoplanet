"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMatch } from "../hooks";
import { INK_EASE, QUIET_LINK } from "./ui";

/** How long the "End match?" question stays up before it folds away again. */
const CONFIRM_MS = 4000;

const SIZE = "text-[clamp(0.8rem,1.6vh,1.05rem)]";

/**
 * A deliberately quiet way out of a running match, bottom centre. Ending takes two
 * clicks (ask, then confirm) so a stray click cannot throw a match away.
 * Mount it only while a match is being played; unmounting resets it.
 */
export function MatchMenu() {
  const match = useMatch();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => window.clearTimeout(id);
  }, [confirming]);

  return (
    // Arrives late, after the controls reminder that shares this spot has faded out.
    <motion.div
      className="absolute inset-x-0 bottom-[1.4vh] flex justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.9 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {confirming ? (
          <motion.div
            key="confirm"
            role="group"
            aria-label="End match?"
            className={`pointer-events-auto flex items-center gap-[0.3em] rounded-full border border-stone-blue/30 bg-ink/85 py-[0.3em] pr-[0.4em] pl-[1.3em] ${SIZE}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3, ease: INK_EASE }}
          >
            <span className="pr-[0.5em] tracking-wide text-rice-paper">End match?</span>
            <button
              type="button"
              onClick={() => match.toLobby()}
              className="rounded-full bg-scarlet px-[1.1em] py-[0.4em] font-medium tracking-wide text-rice-paper outline-none transition-colors duration-300 ease-ink hover:bg-[#f2454b] focus-visible:ring-2 focus-visible:ring-rice-paper/80"
            >
              End
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={QUIET_LINK}>
              Keep playing
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="ask"
            type="button"
            onClick={() => setConfirming(true)}
            className={`${QUIET_LINK} ${SIZE}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.4, ease: INK_EASE }}
          >
            End match
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
