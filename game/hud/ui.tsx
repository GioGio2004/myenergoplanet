"use client";

import { AnimatePresence, motion, type Transition } from "motion/react";
import { SealStamp } from "@/components/motifs/SealStamp";
import { PLAYER_STYLES, gameConfig } from "../config";
import { useGameSettings } from "../hooks";
import type { PlayerSlot } from "../types";

// Shared look-and-feel for the HUD: easings, surfaces, buttons and the two
// recurring ink motifs (score pips and the seal "chop").

/** Same curve as the `ease-ink` Tailwind token. */
export const INK_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Weighted spring with a slight overshoot, for things that pour into place. */
export const SETTLE: Transition = { type: "spring", stiffness: 170, damping: 21, mass: 1.1 };

/** Fast, heavy spring: a stamp hitting paper. */
const CHOP: Transition = { type: "spring", stiffness: 620, damping: 24, mass: 0.9 };

// ── surfaces and buttons ─────────────────────────────────────────────────────

const PANEL_BASE =
  "pointer-events-auto rounded-[32px] border border-stone-blue/25 shadow-[0_30px_90px_-30px_var(--ink)]";

/**
 * Class list for a large interactive panel floating over the 3D scene.
 * Blurring a full-motion canvas every frame is costly on integrated GPUs, so the
 * low quality preset gets a more opaque flat panel instead.
 */
export function usePanelClass(): string {
  const { qualityLevel } = useGameSettings();
  return qualityLevel === "low"
    ? `${PANEL_BASE} bg-egyptian-blue/95`
    : `${PANEL_BASE} bg-egyptian-blue/80 backdrop-blur-md`;
}

const PILL_BASE =
  "rounded-full px-[2.2em] py-[0.85em] font-sans font-medium tracking-[0.16em] uppercase outline-none transition-[background-color,border-color,color,scale] duration-300 ease-ink focus-visible:ring-2 focus-visible:ring-rice-paper/80 focus-visible:ring-offset-2 focus-visible:ring-offset-egyptian-blue active:scale-[0.97]";

export const PILL_PRIMARY = `${PILL_BASE} bg-scarlet text-rice-paper shadow-[0_18px_50px_-18px_rgba(236,47,54,0.6)] hover:bg-[#f2454b]`;

export const PILL_SECONDARY = `${PILL_BASE} border border-stone-blue/45 text-rice-paper hover:border-rice-paper/70`;

/** A pill that cannot be pressed yet: outlined, quiet, no hover. */
export const PILL_WAITING =
  "rounded-full border border-stone-blue/30 px-[2.2em] py-[0.85em] font-sans font-medium tracking-[0.08em] text-stone-blue outline-none cursor-not-allowed";

/** The landing page's quiet text link: for "Back" and other secondary exits. Sized in `em`. */
export const QUIET_LINK =
  "pointer-events-auto inline-block rounded-full px-[1.1em] py-[0.4em] font-sans tracking-wide text-stone-blue outline-none transition-colors duration-300 ease-ink hover:text-rice-paper focus-visible:ring-1 focus-visible:ring-stone-blue";

/** Readable tint for a player's name on the dark HUD surfaces. */
export function playerTint(slot: PlayerSlot): string {
  return PLAYER_STYLES[slot].color;
}

// ── score pips ───────────────────────────────────────────────────────────────

const PIP_INDICES: readonly number[] = Array.from(
  { length: gameConfig.rules.pointsToWin },
  (_, i) => i,
);

function Pip({ filled, color, glow }: { filled: boolean; color: string; glow: string }) {
  return (
    <span className="relative block size-[1em] rounded-full border border-rice-paper/35">
      {/* the ink drop: lands a little too big, then settles */}
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: color }}
        initial={false}
        animate={filled ? { scale: [0, 1.4, 1], opacity: 1 } : { scale: 0, opacity: 0 }}
        transition={{ duration: 0.55, ease: INK_EASE }}
      />
      {/* and the ripple it leaves */}
      <AnimatePresence initial={false}>
        {filled && (
          <motion.span
            key="ripple"
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: glow }}
            initial={{ scale: 0.8, opacity: 0.9 }}
            animate={{ scale: 2.8, opacity: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.8, ease: INK_EASE }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * The score as `pointsToWin` pips in the player's colour. Sized in `em`: set the
 * font size on `className` to scale it.
 */
export function ScorePips({
  slot,
  score,
  className = "",
}: {
  slot: PlayerSlot;
  score: number;
  className?: string;
}) {
  const style = PLAYER_STYLES[slot];
  return (
    <div
      role="img"
      aria-label={`${score} of ${gameConfig.rules.pointsToWin} points`}
      className={`flex items-center gap-[0.42em] ${className}`}
    >
      {PIP_INDICES.map((i) => (
        <Pip key={i} filled={i < score} color={style.color} glow={style.glow} />
      ))}
    </div>
  );
}

// ── seal stamp ───────────────────────────────────────────────────────────────

/**
 * The red seal slamming onto the page: drops from 1.6x with a twist, settles
 * quickly, and leaves a faint ring of ink. Give it a size through `className`.
 */
export function SealSlam({
  className = "",
  delay = 0,
  tilt = -7,
}: {
  className?: string;
  delay?: number;
  /** Resting rotation in degrees. */
  tilt?: number;
}) {
  return (
    <span aria-hidden className={`relative inline-block shrink-0 ${className}`}>
      <motion.span
        className="absolute inset-0 rounded-[22%] border-2 border-scarlet"
        initial={{ opacity: 0, scale: 1 }}
        animate={{ opacity: [0, 0.75, 0], scale: [1, 1.2, 1.75] }}
        transition={{ duration: 0.75, delay: delay + 0.1, ease: INK_EASE, times: [0, 0.18, 1] }}
      />
      <motion.span
        className="block size-full drop-shadow-[0_10px_24px_rgba(1,16,31,0.55)]"
        initial={{ scale: 1.6, rotate: tilt - 12, opacity: 0 }}
        animate={{ scale: 1, rotate: tilt, opacity: 1 }}
        transition={{ ...CHOP, delay, opacity: { duration: 0.1, delay } }}
      >
        <SealStamp className="size-full" />
      </motion.span>
    </span>
  );
}
