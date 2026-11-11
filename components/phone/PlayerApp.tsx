"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  HEARTBEAT_INTERVAL_MS,
  MIN_PLAYERS,
  NAME_MAX_LENGTH,
  normalizeRoomCode,
} from "@/convex/shared";
import { BlobAvatar } from "@/game/hud/BlobAvatar";
import { PLAYER_STYLES } from "@/game/config";
import type { PlayerSlot } from "@/game/types";
import { SealStamp } from "@/components/motifs/SealStamp";
import { usePlayerSeat, type PlayerSeat } from "@/lib/sessions";
import { roomErrorCode, roomErrorMessage } from "@/lib/roomErrors";
import { useSuggestedName } from "@/lib/suggestedName";

type Room = NonNullable<ReturnType<typeof useLobby>>;

function useLobby(code: string | null) {
  return useQuery(api.rooms.lobby, code ? { code } : "skip");
}

/** Everything a phone shows for one room: join form, then the player's own lobby screen. */
export function PlayerApp({ rawCode }: { rawCode: string }) {
  const code = normalizeRoomCode(rawCode);
  if (!code) {
    return (
      <Notice title="That isn't a room code">
        Room codes are 4 letters and numbers, like <b>K2ZH</b>.
      </Notice>
    );
  }
  return <PlayerRoom code={code} />;
}

function PlayerRoom({ code }: { code: string }) {
  const room = useLobby(code);
  const [seat, setSeat] = usePlayerSeat(code);

  useSeatSession(seat, setSeat);

  if (room === undefined) return <Loading label="Finding the room…" />;
  if (room === null) {
    return (
      <Notice title={`No room ${code}`}>
        Check the code on the big screen and try again.
      </Notice>
    );
  }
  if (room.status === "closed") {
    return <Notice title="Room closed">The host closed this room. Scan the new QR code to play.</Notice>;
  }

  const me = seat ? room.players.find((p) => p.id === seat.playerId) : undefined;
  if (seat && me) return <SeatView room={room} me={me} seat={seat} onLeave={() => setSeat(null)} />;
  if (seat) return <Loading label="Reconnecting…" />;
  return <JoinForm room={room} onSeated={setSeat} />;
}

/**
 * Keep a stored seat alive: take it back once on load (after a refresh), then send a
 * heartbeat every few seconds and whenever the page becomes visible again.
 * A seat the server no longer knows is forgotten, which brings back the join form.
 */
function useSeatSession(seat: PlayerSeat | null, setSeat: (seat: PlayerSeat | null) => void) {
  const rejoin = useMutation(api.players.rejoin);
  const heartbeat = useMutation(api.players.heartbeat);
  const playerId = seat?.playerId ?? null;
  const rejoinToken = seat?.rejoinToken ?? null;

  useEffect(() => {
    if (!playerId || !rejoinToken) return;
    let cancelled = false;
    const args = { playerId, rejoinToken };

    const forgetIfGone = (error: unknown) => {
      const code = roomErrorCode(error);
      if (!cancelled && (code === "PLAYER_GONE" || code === "ROOM_CLOSED")) setSeat(null);
    };
    const beat = () => void heartbeat(args).catch(forgetIfGone);

    void rejoin(args).catch(forgetIfGone);
    const id = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [playerId, rejoinToken, rejoin, heartbeat, setSeat]);
}

// ── join form ────────────────────────────────────────────────────────────────

function JoinForm({ room, onSeated }: { room: Room; onSeated: (seat: PlayerSeat) => void }) {
  const join = useMutation(api.players.join);
  const suggestion = useSuggestedName();
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = edited ?? suggestion;
  const inLobby = room.status === "lobby";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !inLobby) return;
    setBusy(true);
    setError(null);
    try {
      const seat = await join({ code: room.code, name });
      onSeated({ playerId: seat.playerId, rejoinToken: seat.rejoinToken });
    } catch (e) {
      setError(roomErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="flex flex-col items-center gap-3 text-center">
        <SealStamp size={52} />
        <p className="text-xs tracking-[0.32em] text-stone-blue uppercase">Room {room.code}</p>
        <h1 className="font-serif text-4xl text-rice-paper">Join the ring</h1>
      </div>

      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm tracking-wide text-stone-blue">Your name</span>
          <input
            value={name}
            onChange={(e) => setEdited(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            enterKeyHint="go"
            className="h-14 rounded-2xl bg-rice-paper px-5 font-serif text-2xl text-ink outline-none focus-visible:ring-2 focus-visible:ring-scarlet"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !inLobby}
          className="h-14 rounded-full bg-scarlet text-lg font-medium tracking-[0.18em] text-rice-paper uppercase transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-rice-paper disabled:opacity-45"
        >
          {busy ? "Joining…" : "Join"}
        </button>
        <p aria-live="polite" className="min-h-10 text-center text-sm text-stone-blue">
          {error ??
            (inLobby
              ? `${room.players.length} of 4 seats taken`
              : "A match is under way. You can join as soon as it ends.")}
        </p>
      </form>
    </Screen>
  );
}

// ── seated ───────────────────────────────────────────────────────────────────

function SeatView({
  room,
  me,
  seat,
  onLeave,
}: {
  room: Room;
  me: Room["players"][number];
  seat: PlayerSeat;
  onLeave: () => void;
}) {
  const style = PLAYER_STYLES[me.slot as PlayerSlot];
  const setStatus = useMutation(api.rooms.setStatus);
  const leave = useMutation(api.players.leave);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = room.players.filter((p) => p.connected).length;
  const missing = Math.max(0, MIN_PLAYERS - connected);

  async function startMatch() {
    setBusy(true);
    setError(null);
    try {
      await setStatus({ code: room.code, status: "playing", caller: seat });
    } catch (e) {
      setError(roomErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function leaveRoom() {
    void leave(seat).catch(() => {});
    onLeave();
  }

  let status: ReactNode;
  if (room.status === "lobby") {
    status = me.isLeader ? (
      <LeaderButton onClick={startMatch} disabled={busy || missing > 0} ink={style.ink}>
        {missing > 0 ? `Waiting for ${missing} more player${missing === 1 ? "" : "s"}…` : "Start the match"}
      </LeaderButton>
    ) : (
      <p className="text-lg">Waiting for the host to start…</p>
    );
  } else if (room.status === "playing") {
    status = (
      <div className="flex flex-col gap-2">
        <p className="font-serif text-2xl">Match on! Watch the big screen.</p>
        <p className="text-sm opacity-75">
          Phone controls arrive in the next update. A bot wrestles for you this round.
        </p>
      </div>
    );
  } else {
    status = me.isLeader ? (
      <LeaderButton onClick={startMatch} disabled={busy} ink={style.ink}>
        Rematch
      </LeaderButton>
    ) : (
      <p className="text-lg">Match over. Waiting for the host…</p>
    );
  }

  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-between gap-8 px-6 py-10 text-center transition-colors duration-700"
      style={{ background: style.color, color: style.ink }}
    >
      <p className="text-xs tracking-[0.32em] uppercase opacity-70">Room {room.code}</p>

      <div className="flex flex-col items-center gap-5">
        <div
          className="grid size-40 place-items-center rounded-full"
          style={{ background: style.belt }}
        >
          <BlobAvatar slot={me.slot as PlayerSlot} className="size-28" title={style.label} />
        </div>
        <div>
          <h1 className="font-serif text-5xl leading-tight">You&rsquo;re {style.label}</h1>
          <p className="mt-1 text-lg opacity-80">
            {me.name}
            {me.isLeader ? " · leader" : ""}
          </p>
        </div>
        <div aria-live="polite" className="max-w-xs">
          {status}
          {error && <p className="mt-3 text-sm font-medium">{error}</p>}
        </div>
      </div>

      <button
        type="button"
        onClick={leaveRoom}
        className="rounded-full px-4 py-2 text-sm underline-offset-4 opacity-70 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-current"
      >
        Leave room
      </button>
    </main>
  );
}

function LeaderButton({
  onClick,
  disabled,
  ink,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  ink: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-14 w-full rounded-full px-8 text-base font-medium tracking-[0.14em] uppercase transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
      style={{ background: ink, color: ink === "#F2EAD8" ? "#01101F" : "#F2EAD8" }}
    >
      {children}
    </button>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-egyptian-blue px-6 py-10">
      {children}
    </main>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <Screen>
      <SealStamp size={56} className="animate-pulse" />
      <p className="font-serif text-2xl text-rice-paper">{label}</p>
    </Screen>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen>
      <SealStamp size={52} />
      <div className="max-w-sm text-center">
        <h1 className="font-serif text-4xl text-rice-paper">{title}</h1>
        <p className="mt-3 text-base text-stone-blue">{children}</p>
      </div>
      <Link
        href="/join"
        className="rounded-full border border-stone-blue/40 px-6 py-3 text-sm tracking-wide text-rice-paper outline-none focus-visible:ring-2 focus-visible:ring-stone-blue"
      >
        Enter a room code
      </Link>
    </Screen>
  );
}
