"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { api } from "@/convex/_generated/api";
import { NavPanel, type HostView } from "./NavPanel";
import { CreateRoom, type RoomState } from "./CreateRoom";
import { HostLobby } from "./HostLobby";
import { AboutView, HowToPlayView, SettingsView } from "./InfoViews";
import { CloudScroll } from "@/components/motifs/CloudScroll";
import { preloadArena } from "@/components/arena/ArenaLoader";
import { useHostTouch } from "@/components/arena/useHostTouch";
import { useHostRoom } from "@/lib/sessions";
import { HostTransport } from "@/lib/net/hostTransport";
import { useHostTransport, useLinkStatuses } from "@/lib/net/useHostTransport";
import { roomErrorMessage } from "@/lib/roomErrors";
import { useSettings } from "@/lib/settings";

export function HostHome() {
  const router = useRouter();
  const [view, setView] = useState<HostView>("play");
  const [settings] = useSettings();

  // The open room survives refreshes (per tab) so the QR code stays the same.
  const [hostRoom, setHostRoom] = useHostRoom();
  const lobby = useQuery(api.rooms.lobby, hostRoom ? { code: hostRoom.code } : "skip");
  const createRoom = useMutation(api.rooms.create);
  const closeRoom = useMutation(api.rooms.close);
  const setStatus = useMutation(api.rooms.setStatus);
  const addBot = useMutation(api.rooms.addBot);
  const removeBot = useMutation(api.rooms.removeBot);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // A stored room that no longer exists (closed, cleaned up) is forgotten.
  const roomGone = hostRoom !== null && (lobby === null || lobby?.status === "closed");
  useEffect(() => {
    if (roomGone) setHostRoom(null);
  }, [roomGone, setHostRoom]);

  useHostTouch(roomGone ? null : hostRoom);

  // Live controller links to the phones (answering their WebRTC offers starts here).
  const transport = useHostTransport(roomGone ? null : hostRoom);
  const links = useLinkStatuses(transport);
  const humanIds = (lobby?.players ?? []).filter((p) => !p.isBot).map((p) => p.id).join(",");
  const lobbyLoaded = lobby != null;
  useEffect(() => {
    if (transport && lobbyLoaded) transport.prune(humanIds ? humanIds.split(",") : []);
  }, [transport, lobbyLoaded, humanIds]);

  // Warm the 3D bundle while players join.
  const roomOpen = hostRoom !== null && !roomGone;
  useEffect(() => {
    if (roomOpen) preloadArena();
  }, [roomOpen]);

  // Started (from this screen or from the leader's phone): go to the arena.
  const matchOn = lobby?.status === "playing" || lobby?.status === "results";
  useEffect(() => {
    if (hostRoom && matchOn) router.push(`/arena?room=${hostRoom.code}`);
  }, [hostRoom, matchOn, router]);

  const room: RoomState = roomOpen
    ? { status: "ready", code: hostRoom.code }
    : creating
      ? { status: "creating" }
      : { status: "idle" };

  async function handleCreate() {
    if (creating || roomOpen) return;
    setCreating(true);
    setCreateError(null);
    try {
      setHostRoom(await createRoom({}));
    } catch (error) {
      setCreateError(roomErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  function handleClose() {
    if (!hostRoom) return;
    void closeRoom(hostRoom).catch(() => {});
    HostTransport.closeCurrent();
    setHostRoom(null);
    setStartError(null);
  }

  function handleAddBot() {
    if (!hostRoom) return;
    setStartError(null);
    void addBot(hostRoom).catch((error) => setStartError(roomErrorMessage(error)));
  }

  function handleRemoveBot(playerId: string) {
    if (!hostRoom) return;
    const bot = lobby?.players.find((p) => p.id === playerId);
    if (!bot) return;
    void removeBot({ ...hostRoom, playerId: bot.id }).catch(() => {});
  }

  async function handleStart() {
    if (!hostRoom) return;
    setStarting(true);
    setStartError(null);
    try {
      await setStatus({
        code: hostRoom.code,
        status: "playing",
        caller: { hostSecret: hostRoom.hostSecret },
      });
    } catch (error) {
      setStartError(roomErrorMessage(error));
    } finally {
      setStarting(false);
    }
  }

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "user"}>
      <div className="flex h-dvh w-full flex-col overflow-hidden md:flex-row">
        <NavPanel view={view} onChange={setView} />

        <main className="relative flex flex-1 items-center justify-center overflow-x-hidden overflow-y-auto bg-[radial-gradient(120%_90%_at_50%_45%,var(--egyptian-blue)_45%,var(--ink)_100%)] px-6 py-8">
          <StageClouds />

          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 m-auto flex w-full items-center justify-center"
            >
              {view === "play" && (
                <CreateRoom
                  room={room}
                  onCreate={handleCreate}
                  onClose={handleClose}
                  error={createError}
                  lobby={
                    <HostLobby
                      key="lobby"
                      players={lobby?.players ?? []}
                      links={links}
                      onStart={handleStart}
                      onAddBot={handleAddBot}
                      onRemoveBot={handleRemoveBot}
                      starting={starting}
                      error={startError}
                    />
                  }
                />
              )}
              {view === "how" && <HowToPlayView />}
              {view === "settings" && <SettingsView />}
              {view === "about" && <AboutView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  );
}

function StageClouds() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="cloud-drift absolute top-[8%] left-[6%]">
        <CloudScroll width={260} opacity={0.2} />
      </div>
      <div className="cloud-drift absolute top-[18%] right-[-40px] [animation-delay:-7s]">
        <CloudScroll width={340} opacity={0.14} />
      </div>
      <div className="cloud-drift absolute bottom-[10%] left-[18%] [animation-delay:-12s]">
        <CloudScroll width={200} opacity={0.12} />
      </div>
      <div className="cloud-drift absolute right-[10%] bottom-[6%] [animation-delay:-4s]">
        <CloudScroll width={300} opacity={0.18} />
      </div>
    </div>
  );
}
