"use client";

import { AnimatePresence, motion } from "motion/react";
import { BlobAvatar } from "@/game/hud/BlobAvatar";
import { PLAYER_STYLES } from "@/game/config";
import type { PlayerSlot } from "@/game/types";
import { MAX_PLAYERS, MIN_PLAYERS } from "@/convex/shared";
import { bucket, type LinkStatus } from "@/lib/net/hostTransport";

export type LobbyPlayer = {
  id: string;
  name: string;
  slot: number;
  connected: boolean;
  isLeader: boolean;
  isBot: boolean;
};

/** The four seats under the QR card, filling live as phones join, plus the Start button. */
export function HostLobby({
  players,
  links,
  onStart,
  onAddBot,
  onRemoveBot,
  starting,
  error,
}: {
  players: LobbyPlayer[];
  /** Live controller connection per player id. */
  links: ReadonlyMap<string, LinkStatus>;
  onStart: () => void;
  onAddBot: () => void;
  onRemoveBot: (playerId: string) => void;
  starting: boolean;
  error: string | null;
}) {
  const ready = players.filter((p) => p.connected).length;
  const missing = Math.max(0, MIN_PLAYERS - ready);
  const canStart = missing === 0 && !starting;
  const firstEmpty = Array.from({ length: MAX_PLAYERS }, (_, s) => s).find(
    (s) => !players.some((p) => p.slot === s),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { delay: 0.35, duration: 0.5 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="flex w-full flex-col items-center gap-6"
    >
      <ul className="grid w-full max-w-[880px] grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Players">
        {Array.from({ length: MAX_PLAYERS }, (_, slot) => {
          const player = players.find((p) => p.slot === slot) ?? null;
          return (
            <li key={slot}>
              <Seat
                slot={slot as PlayerSlot}
                player={player}
                link={player ? links.get(player.id) ?? null : null}
                // Bots fill seats in order, so only the first empty seat offers one.
                onAddBot={slot === firstEmpty ? onAddBot : null}
                onRemoveBot={onRemoveBot}
              />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="h-14 rounded-full bg-scarlet px-12 text-base font-medium tracking-[0.18em] text-rice-paper uppercase shadow-[0_16px_50px_-18px_rgba(236,47,54,0.7)] transition-[opacity,transform,background-color] duration-300 ease-ink outline-none hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-rice-paper/70 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-stone-blue/20 disabled:text-stone-blue disabled:shadow-none"
        >
          {starting ? "Starting…" : "Start"}
        </button>
        <p aria-live="polite" className="h-5 text-sm text-stone-blue">
          {error ??
            (missing > 0
              ? `Waiting for ${missing} more player${missing === 1 ? "" : "s"}… or add a bot`
              : "The first player to join can also start from their phone.")}
        </p>
      </div>
    </motion.div>
  );
}

const DOT: Record<ReturnType<typeof bucket>, string> = {
  good: "#7BE0A0",
  ok: "#D9A441",
  poor: "#EC2F36",
  unknown: "#629CC5",
};

function Seat({
  slot,
  player,
  link,
  onAddBot,
  onRemoveBot,
}: {
  slot: PlayerSlot;
  player: LobbyPlayer | null;
  link: LinkStatus | null;
  onAddBot: (() => void) | null;
  onRemoveBot: (playerId: string) => void;
}) {
  const style = PLAYER_STYLES[slot];

  let detail: string;
  let dot: string;
  if (!player) {
    detail = "";
    dot = "transparent";
  } else if (player.isBot) {
    detail = "Bot";
    dot = style.color;
  } else if (!player.connected) {
    detail = "Reconnecting…";
    dot = "var(--stone-blue)";
  } else if (link?.state === "open") {
    detail = link.rttMs === null ? "Controller linked" : `Controller · ${link.rttMs} ms`;
    dot = DOT[bucket(link.rttMs)];
  } else {
    detail = "Linking controller…";
    dot = "var(--stone-blue)";
  }

  return (
    <div className="group relative h-[124px] overflow-hidden rounded-[22px] border border-stone-blue/30">
      <AnimatePresence mode="popLayout" initial={false}>
        {player ? (
          <motion.div
            key={player.id}
            // The liquid "drop": falls in stretched, squashes on landing, settles.
            initial={{ y: -70, scaleX: 0.75, scaleY: 1.3, opacity: 0 }}
            animate={{
              y: 0,
              scaleX: [0.75, 1.18, 0.95, 1],
              scaleY: [1.3, 0.8, 1.05, 1],
              opacity: 1,
            }}
            exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.2 } }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: "50% 100%" }}
            className={`flex h-full items-center gap-3 px-4 transition-[filter,opacity] duration-500 ${
              player.connected ? "" : "opacity-45 grayscale"
            }`}
          >
            <BlobAvatar slot={slot} className="size-14 shrink-0" title={style.label} />
            <div className="min-w-0">
              <div className="truncate font-serif text-xl text-rice-paper">{player.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs tracking-wide text-stone-blue">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} />
                <span className="truncate">
                  {detail}
                  {player.isLeader && <span className="text-rice-paper/60"> · leader</span>}
                </span>
              </div>
            </div>
            {player.isBot && (
              <button
                type="button"
                onClick={() => onRemoveBot(player.id)}
                aria-label={`Remove ${player.name}`}
                className="absolute top-2 right-2 grid size-7 place-items-center rounded-full text-stone-blue opacity-60 transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-stone-blue"
              >
                ×
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="flex h-full flex-col items-center justify-center gap-2 text-stone-blue/70"
          >
            <span
              aria-hidden
              className="size-9 rounded-full border border-dashed"
              style={{ borderColor: style.color, opacity: 0.55 }}
            />
            {onAddBot ? (
              <button
                type="button"
                onClick={onAddBot}
                className="rounded-full border border-stone-blue/35 px-3 py-1 text-xs tracking-[0.18em] text-stone-blue uppercase transition-colors outline-none hover:border-rice-paper/60 hover:text-rice-paper focus-visible:ring-1 focus-visible:ring-stone-blue"
              >
                + Add bot
              </button>
            ) : (
              <span className="text-xs tracking-[0.2em] uppercase">Open seat</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
