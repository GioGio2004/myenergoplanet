"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { RoomStatus } from "@/convex/shared";
import { useGame, useGameEvent, usePlayers } from "@/game/hooks";
import type { HostRoom } from "@/lib/sessions";
import { useHostTouch } from "./useHostTouch";

/**
 * Keeps the host's match and the Convex room in step (rendered inside the game screen):
 * - room says "playing" and the arena is idle → start the match;
 * - the leader asks for a rematch from their phone → rematch;
 * - the match moves on (intro / results / back to lobby) → tell the room, so phones follow.
 */
export function RoomBridge({
  room,
  status,
  onBackToLobby,
}: {
  room: HostRoom;
  status: RoomStatus;
  onBackToLobby: () => void;
}) {
  const { runtime, match } = useGame();
  const players = usePlayers();
  const setStatus = useMutation(api.rooms.setStatus);
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

  useGameEvent("phase", (event) => {
    if (event.phase === "intro") void report("playing");
    else if (event.phase === "results") void report("results");
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

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-stone-blue/25 bg-egyptian-blue/80 px-4 py-1.5 text-xs tracking-wide text-stone-blue">
      Room {room.code} · phone controls arrive in the next update, bots wrestle for now
    </div>
  );
}
