"use client";

import { AnimatePresence, motion } from "motion/react";
import type { HudCallout, HudPlayer } from "../types";
import { BlobAvatar } from "./BlobAvatar";
import { calloutSegments } from "./hudLogic";
import { SETTLE, SealSlam, playerTint } from "./ui";
import { useHudValue } from "./useHudValue";

/**
 * Knockout banner in the lower third: "Scarlet knocked out Imperial Gold!" with
 * both names in their player colours and a seal stamped beside it. One banner at
 * a time; it leaves when the rules clear `hud.callout`.
 */
export function Callouts() {
  const callout = useHudValue((hud) => hud.callout);
  const players = useHudValue((hud) => hud.players);
  return (
    <div
      aria-live="polite"
      className="absolute inset-x-0 bottom-[19vh] flex justify-center px-[5vw]"
    >
      <AnimatePresence mode="wait">
        {callout && <CalloutBanner key={callout.id} callout={callout} players={players} />}
      </AnimatePresence>
    </div>
  );
}

function CalloutBanner({ callout, players }: { callout: HudCallout; players: HudPlayer[] }) {
  const segments = calloutSegments(callout, players);
  return (
    <motion.div
      className="flex max-w-full items-center gap-[1.8vh] rounded-[44px] border border-stone-blue/30 bg-ink/80 py-[1.4vh] pr-[4vh] pl-[1.4vh] shadow-[0_24px_70px_-28px_var(--ink)]"
      initial={{ opacity: 0, y: 28, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.22, ease: "easeIn" } }}
      transition={SETTLE}
    >
      {/* the stamp is taller than the banner on purpose: it overhangs like a real chop */}
      <SealSlam className="-my-[1.2vh] -ml-[3vh] size-[clamp(48px,8.4vh,96px)]" delay={0.12} />
      <p className="min-w-0 text-center font-serif text-[clamp(1.45rem,3.7vh,2.9rem)] leading-[1.2] text-rice-paper">
        {segments.map((segment, i) =>
          segment.slot === null ? (
            <span key={i}>{segment.text}</span>
          ) : (
            <span
              key={i}
              className="font-semibold whitespace-nowrap"
              style={{ color: playerTint(segment.slot) }}
            >
              {/* avatar beside the name: the tint alone cannot mark the rice-white player */}
              <BlobAvatar
                slot={segment.slot}
                className="mr-[0.22em] inline-block w-[1em] align-[-0.16em]"
              />
              {segment.text}
            </span>
          ),
        )}
      </p>
    </motion.div>
  );
}
