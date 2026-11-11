"use client";

import { AnimatePresence, motion } from "motion/react";
import { INK_EASE, SETTLE, SealSlam } from "./ui";
import { useHudValue } from "./useHudValue";

const INK_SHADOW = "[text-shadow:0_10px_60px_rgba(1,16,31,0.75)]";

/** 3, 2, 1 in brush numerals, then "FIGHT" with the seal slammed next to it. */
export function Countdown() {
  const countdown = useHudValue((hud) => hud.countdown);
  return (
    <>
      <div aria-hidden className="absolute inset-0">
        <AnimatePresence>
          {countdown !== null &&
            (countdown > 0 ? <Beat key={countdown} n={countdown} /> : <Fight key="fight" />)}
        </AnimatePresence>
      </div>
      {/* One announcement per stage, not one per beat. */}
      <span className="sr-only" aria-live="polite">
        {countdown === null ? "" : countdown > 0 ? "Get ready." : "Fight!"}
      </span>
    </>
  );
}

function Beat({ n }: { n: number }) {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, scale: 1.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.72, transition: { duration: 0.35, ease: INK_EASE } }}
      transition={{
        scale: { type: "spring", stiffness: 210, damping: 17 },
        opacity: { duration: 0.18 },
      }}
    >
      {/* a ring of ink spreading out from the numeral */}
      <motion.span
        className="absolute size-[min(46vh,46vw)] rounded-full border border-scarlet/70"
        initial={{ scale: 0.55, opacity: 0.9 }}
        animate={{ scale: 1.25, opacity: 0 }}
        transition={{ duration: 0.85, ease: INK_EASE }}
      />
      <span
        className={`font-brush text-[clamp(9rem,min(40vh,30vw),26rem)] leading-none text-rice-paper ${INK_SHADOW}`}
      >
        {n}
      </span>
    </motion.div>
  );
}

function Fight() {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.08, transition: { duration: 0.4, ease: INK_EASE } }}
      transition={{ duration: 0.12 }}
    >
      <div className="relative">
        <motion.span
          className={`block font-brush text-[clamp(6.5rem,min(32vh,21vw),21rem)] leading-none text-rice-paper ${INK_SHADOW}`}
          initial={{ scale: 1.5 }}
          animate={{ scale: 1 }}
          transition={SETTLE}
        >
          FIGHT
        </motion.span>
        <span className="absolute -top-[6%] -right-[15%]">
          <SealSlam className="size-[clamp(60px,13vh,150px)]" delay={0.14} tilt={9} />
        </span>
      </div>
    </motion.div>
  );
}
