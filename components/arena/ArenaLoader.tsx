"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useMemo } from "react";
import { useHostTransport } from "@/lib/net/useHostTransport";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { normalizeRoomCode } from "@/convex/shared";
import { SealStamp } from "@/components/motifs/SealStamp";
import type { PlayerSetup, PlayerSlot } from "@/game/types";
import { useHostRoom } from "@/lib/sessions";
import { RoomBridge } from "./RoomBridge";

// three.js + Rapier are heavy and browser-only: load them in their own chunk.
const GameScreen = dynamic(() => import("@/game/GameScreen"), {
  ssr: false,
  loading: () => <ArenaMessage title="Preparing the ring…" pulse />,
});

/** Warm the game chunk in the background (call from an effect or event handler). */
export function preloadArena(): void {
  void import("@/game/GameScreen");
}

/** `/arena` (local practice) or `/arena?room=CODE` (the players of an online room). */
export default function ArenaLoader({ roomCode }: { roomCode: string | null }) {
  const router = useRouter();
  const goHome = useCallback(() => router.push("/"), [router]);
  if (roomCode === null) return <GameScreen onExit={goHome} />;
  return <RoomArena rawCode={roomCode} onExit={goHome} />;
}

function RoomArena({ rawCode, onExit }: { rawCode: string; onExit: () => void }) {
  const code = normalizeRoomCode(rawCode);
  const [hostRoom] = useHostRoom();
  const lobby = useQuery(api.rooms.lobby, code ? { code } : "skip");

  const transport = useHostTransport(hostRoom && hostRoom.code === code ? hostRoom : null);

  // Only re-build the roster when who is playing changes, not on every presence flip.
  const rosterKey = lobby
    ? lobby.players.map((p) => [p.slot, p.id, p.isBot ? 1 : 0, p.name].join("\u0000")).join("\u0001")
    : "";
  const { roster, playerBySlot } = useMemo(() => {
    const roster: PlayerSetup[] = [];
    const playerBySlot = new Map<number, string>();
    if (rosterKey !== "") {
      for (const entry of rosterKey.split("\u0001")) {
        const [slot, id, bot, name] = entry.split("\u0000");
        const s = Number(slot) as PlayerSlot;
        roster.push({ slot: s, name, control: bot === "1" ? "bot" : "remote" });
        if (bot !== "1") playerBySlot.set(s, id);
      }
    }
    return { roster, playerBySlot };
  }, [rosterKey]);

  // Phones drive their own wrestler through the live connection; bots use the built-in AI.
  const inputFactory = useCallback(
    (setup: PlayerSetup) => {
      const playerId = playerBySlot.get(setup.slot);
      return setup.control === "remote" && playerId && transport
        ? transport.inputSource(playerId)
        : undefined;
    },
    [playerBySlot, transport],
  );

  if (!code || lobby === null) {
    return <ArenaMessage title="Room not found" action={<HomeLink />} />;
  }
  if (!hostRoom || hostRoom.code !== code) {
    return (
      <ArenaMessage
        title="This screen isn't hosting that room"
        detail="Open the room from the host screen that created it."
        action={<HomeLink />}
      />
    );
  }
  if (lobby === undefined || !transport) return <ArenaMessage title="Preparing the ring…" pulse />;

  return (
    <GameScreen
      onExit={onExit}
      roster={roster}
      inputFactory={inputFactory}
      overlay={
        <RoomBridge
          room={hostRoom}
          status={lobby.status}
          transport={transport}
          playerBySlot={playerBySlot}
          onBackToLobby={onExit}
        />
      }
    />
  );
}

function HomeLink() {
  return (
    <Link
      href="/"
      className="rounded-full border border-stone-blue/40 px-6 py-3 text-sm tracking-wide text-rice-paper outline-none focus-visible:ring-2 focus-visible:ring-stone-blue"
    >
      Back to the start
    </Link>
  );
}

function ArenaMessage({
  title,
  detail,
  action,
  pulse = false,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-egyptian-blue px-6 text-center">
      <SealStamp size={64} className={pulse ? "animate-pulse" : ""} />
      <p className="font-serif text-3xl tracking-wide text-rice-paper">{title}</p>
      {detail && <p className="text-stone-blue">{detail}</p>}
      {action}
    </div>
  );
}
