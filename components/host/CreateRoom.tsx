"use client";

import Link from "next/link";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { preloadArena } from "@/components/arena/ArenaLoader";
import { QrCode } from "./QrCode";
import { SealStamp } from "@/components/motifs/SealStamp";
import { joinUrl } from "@/lib/roomCode";

export type RoomState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; code: string };

// Weighted, slightly overshooting spring: the pill "pours" into the card.
const MORPH: Transition = { type: "spring", stiffness: 170, damping: 21, mass: 1.1 };
const RADIUS = 36;
const QUIET_LINK =
  "inline-block rounded-full px-4 py-1.5 text-sm tracking-wide text-stone-blue transition-colors hover:text-rice-paper focus-visible:ring-1 focus-visible:ring-stone-blue outline-none";

export function CreateRoom({
  room,
  onCreate,
  onClose,
}: {
  room: RoomState;
  onCreate: () => void;
  onClose: () => void;
}) {
  const ready = room.status === "ready";

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="relative">
        {/* Ink pulse while the room is being opened */}
        <AnimatePresence>
          {room.status === "creating" &&
            [0, 1].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute inset-0 border border-scarlet"
                style={{ borderRadius: RADIUS }}
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: 1.45, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  delay: i * 0.8,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            ))}
        </AnimatePresence>

        <motion.div
          layout
          transition={MORPH}
          style={{ borderRadius: RADIUS }}
          className="relative overflow-hidden bg-scarlet shadow-[0_24px_80px_-24px_rgba(236,47,54,0.55),0_8px_30px_-12px_var(--ink)]"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {ready ? (
              <ReadyCard key="card" code={room.code} />
            ) : (
              <motion.button
                key="pill"
                layout
                type="button"
                onClick={onCreate}
                disabled={room.status === "creating"}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                className="group flex h-[72px] items-center gap-3 px-12 font-sans text-lg font-medium tracking-[0.16em] text-rice-paper uppercase outline-none focus-visible:ring-2 focus-visible:ring-rice-paper/70 focus-visible:ring-inset disabled:cursor-wait"
              >
                <motion.span
                  layout="position"
                  animate={room.status === "creating" ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
                  transition={
                    room.status === "creating"
                      ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
                      : { duration: 0.2 }
                  }
                >
                  {room.status === "creating" ? "Opening room…" : "Create Room"}
                </motion.span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {ready ? (
          <motion.button
            key="close"
            type="button"
            onClick={onClose}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.5, duration: 0.5 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className={QUIET_LINK}
          >
            Close room
          </motion.button>
        ) : (
          <motion.div
            key="practice"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.4 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            {/* Local match on this screen: two players on the keyboard, or bots. */}
            <Link
              href="/arena"
              onPointerEnter={preloadArena}
              onFocus={preloadArena}
              className={QUIET_LINK}
            >
              Practice on this keyboard
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReadyCard({ code }: { code: string }) {
  const url = joinUrl(code);
  const typeUrl = url.replace(/^https?:\/\//, "").replace(/\/play\/.*$/, "/join");

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.18, duration: 0.45 } }}
      className="relative flex flex-col items-center gap-9 p-8 sm:p-10 lg:flex-row lg:gap-12 lg:p-12"
    >
      <LatticeCorners />

      {/* QR on a rice-paper inset for contrast */}
      <div className="rounded-[26px] bg-rice-paper p-4 shadow-[inset_0_0_0_1px_rgba(3,32,62,0.08)] sm:p-5">
        <div className="size-[clamp(220px,32vh,420px)]">
          <QrCode value={url} label={`QR code to join room ${code}`} />
        </div>
      </div>

      <div className="flex flex-col items-center gap-6 text-rice-paper lg:items-start lg:pr-4">
        <div className="flex items-center gap-3">
          <SealStamp size={30} inverted />
          <span className="font-serif text-sm tracking-[0.32em] uppercase">Room open</span>
        </div>

        <div className="text-center lg:text-left">
          <div className="text-xs tracking-[0.32em] text-rice-paper/75 uppercase">Room code</div>
          <div
            aria-label={`Room code ${code.split("").join(" ")}`}
            className="mt-1 font-serif text-[clamp(4.25rem,10vh,8rem)] leading-none font-semibold tracking-[0.14em]"
          >
            {code}
          </div>
        </div>

        <div className="h-px w-24 bg-rice-paper/40" />

        <div className="text-center lg:text-left">
          <p className="font-serif text-[clamp(1.25rem,2.4vh,1.75rem)]">
            Scan to join · at least 2 players
          </p>
          <p className="mt-1.5 text-sm text-rice-paper/75">
            or open <span className="font-medium text-rice-paper">{typeUrl}</span> and type
            the code
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/** Thin lattice-window brackets in the card corners. */
function LatticeCorners() {
  const base = "pointer-events-none absolute size-6 border-rice-paper/45";
  return (
    <>
      <span aria-hidden className={`${base} top-4 left-4 rounded-tl-xl border-t border-l`} />
      <span aria-hidden className={`${base} top-4 right-4 rounded-tr-xl border-t border-r`} />
      <span aria-hidden className={`${base} bottom-4 left-4 rounded-bl-xl border-b border-l`} />
      <span aria-hidden className={`${base} right-4 bottom-4 rounded-br-xl border-r border-b`} />
    </>
  );
}
