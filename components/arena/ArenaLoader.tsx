"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { SealStamp } from "@/components/motifs/SealStamp";

// three.js + Rapier are heavy and browser-only: load them in their own chunk.
const GameScreen = dynamic(() => import("@/game/GameScreen"), {
  ssr: false,
  loading: () => <ArenaLoading />,
});

/** Warm the game chunk in the background (call from an effect or event handler). */
export function preloadArena(): void {
  void import("@/game/GameScreen");
}

function ArenaLoading() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-egyptian-blue">
      <SealStamp size={64} className="animate-pulse" />
      <p className="font-serif text-2xl tracking-wide text-rice-paper">Preparing the ring…</p>
    </div>
  );
}

export default function ArenaLoader() {
  const router = useRouter();
  return <GameScreen onExit={() => router.push("/")} />;
}
