"use client";

import { useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { NavPanel, type HostView } from "./NavPanel";
import { CreateRoom, type RoomState } from "./CreateRoom";
import { AboutView, HowToPlayView, SettingsView } from "./InfoViews";
import { CloudScroll } from "@/components/motifs/CloudScroll";
import { createRoomStub } from "@/lib/devRoom";
import { useSettings } from "@/lib/settings";

export function HostHome() {
  const [view, setView] = useState<HostView>("play");
  const [room, setRoom] = useState<RoomState>({ status: "idle" });
  const [settings] = useSettings();

  async function handleCreate() {
    if (room.status !== "idle") return;
    setRoom({ status: "creating" });
    try {
      const { code } = await createRoomStub();
      setRoom({ status: "ready", code });
    } catch {
      setRoom({ status: "idle" });
    }
  }

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "user"}>
      <div className="flex h-dvh w-full flex-col overflow-hidden md:flex-row">
        <NavPanel view={view} onChange={setView} />

        <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(120%_90%_at_50%_45%,var(--egyptian-blue)_45%,var(--ink)_100%)] px-6 py-10">
          <StageClouds />

          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 flex w-full items-center justify-center"
            >
              {view === "play" && (
                <CreateRoom
                  room={room}
                  onCreate={handleCreate}
                  onClose={() => setRoom({ status: "idle" })}
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
