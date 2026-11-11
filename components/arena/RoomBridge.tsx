"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { RoomStatus } from "@/convex/shared";
import { useGame, useGameEvent, usePlayers } from "@/game/hooks";
import type { HostTransport } from "@/lib/net/hostTransport";
import { useLinkStatuses } from "@/lib/net/useHostTransport";
import type { HostRoom } from "@/lib/sessions";
import { useHostTouch } from "./useHostTouch";

/** Cooldown updates to phones while a match is live. */
const COOLDOWN_INTERVAL_MS = 100;

/**
 * Keeps the host's match, the Convex room and the phones in step (rendered inside the game screen):
 * - room says "playing" and the arena is idle → start the match;
 * - the leader asks for a rematch from their phone → rematch;
 * - the match moves on (intro / results / back to lobby) → tell the room, so phones follow;
 * - game events (score, knockouts, hits, cooldowns) → each phone over its live connection.
 */
export function RoomBridge({
  room,
  status,
  transport,
  playerBySlot,
  onBackToLobby,
}: {
  room: HostRoom;
  status: RoomStatus;
  transport: HostTransport;
  /** Player id of each phone-controlled slot (bots are absent). */
  playerBySlot: ReadonlyMap<number, string>;
  onBackToLobby: () => void;
}) {
  const { runtime, match } = useGame();
  const players = usePlayers();
  const setStatus = useMutation(api.rooms.setStatus);
  const links = useLinkStatuses(transport);
  useHostTouch(room);

  // Read inside event handlers without re-subscribing.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });

  const report = async (next: "lobby" | "playing" | "results"): Promise<void> => {
    if (statusRef.current === next) return;
    try {
      await setStatus({ code: room.code, status: next, caller: { hostSecret: room.hostSecret } });
    } catch {
      // The room may be gone; the status effect below handles that.
    }
  };

  // Start (also after a refresh of this screen mid-match) and leader rematches.
  const playerCount = players.length;
  useEffect(() => {
    if (status !== "playing" && status !== "results") return;
    if (runtime.phase === "lobby" && playerCount >= runtime.config.minPlayers) match.start();
    else if (status === "playing" && runtime.phase === "results") match.rematch();
  }, [status, playerCount, runtime, match]);

  // ── room status follows the match ────────────────────────────────────────
  useGameEvent("phase", (event) => {
    transport.broadcast({ t: "phase", phase: event.phase });
    if (event.phase === "intro") {
      void report("playing");
      for (const id of playerBySlot.values()) transport.send(id, { t: "score", score: 0 });
    } else if (event.phase === "results") void report("results");
    else if (event.phase === "lobby") {
      // Wait for the room to say "lobby" first, or the landing page would see the old
      // status and send this screen straight back to the arena.
      void report("lobby").then(onBackToLobby);
    }
  });

  // The host closed the room elsewhere: leave.
  useEffect(() => {
    if (status === "closed") onBackToLobby();
  }, [status, onBackToLobby]);

  // ── game events → phones ─────────────────────────────────────────────────
  const nameOf = (slot: number | null) => (slot === null ? null : (runtime.wrestler(slot)?.name ?? null));

  useGameEvent("score", (e) => {
    const id = playerBySlot.get(e.slot);
    if (id) transport.send(id, { t: "score", score: e.score });
  });

  useGameEvent("knockout", (e) => {
    const victim = playerBySlot.get(e.victim);
    if (victim) transport.send(victim, { t: "ko", by: nameOf(e.by) });
    const attacker = e.by === null ? undefined : playerBySlot.get(e.by);
    if (attacker) transport.send(attacker, { t: "scored", victim: nameOf(e.victim) ?? "someone" });
  });

  useGameEvent("hit", (e) => {
    const ms = Math.round(20 + e.strength * 70);
    for (const slot of [e.a, e.b]) {
      const id = playerBySlot.get(slot);
      if (id) transport.send(id, { t: "vibrate", ms });
    }
  });

  useEffect(() => {
    const { dash, brace } = runtime.config.wrestler;
    const id = window.setInterval(() => {
      const live =
        runtime.phase === "countdown" || runtime.phase === "playing" || runtime.phase === "suddenDeath";
      if (!live) return;
      for (const w of runtime.wrestlers) {
        const player = playerBySlot.get(w.slot);
        if (!player) continue;
        transport.send(player, {
          t: "cd",
          d: round2(w.dashCooldownLeft / dash.cooldownSeconds),
          b: round2(w.braceCooldownLeft / brace.cooldownSeconds),
          br: w.bracing,
          bl: round2(w.braceTimeLeft / brace.maxHoldSeconds),
        });
      }
    }, COOLDOWN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [runtime, transport, playerBySlot]);

  // ── who is not linked yet ────────────────────────────────────────────────
  const waiting = [...playerBySlot.entries()]
    .filter(([, id]) => links.get(id)?.state !== "open")
    .map(([slot]) => runtime.wrestler(slot)?.name ?? `Player ${slot + 1}`);

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-stone-blue/25 bg-egyptian-blue/80 px-4 py-1.5 text-xs tracking-wide text-stone-blue">
      Room {room.code}
      {waiting.length > 0 && ` · waiting for ${waiting.join(", ")}'s controller…`}
    </div>
  );
}

function round2(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}
