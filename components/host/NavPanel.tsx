"use client";

import { motion } from "motion/react";
import { GAME_NAME } from "@/lib/brand";
import { SealStamp } from "@/components/motifs/SealStamp";
import { LatticeBand } from "@/components/motifs/LatticeBand";

export type HostView = "play" | "how" | "settings" | "about";

const ITEMS: { id: HostView; label: string }[] = [
  { id: "play", label: "Play" },
  { id: "how", label: "How to Play" },
  { id: "settings", label: "Settings" },
  { id: "about", label: "About" },
];

export function NavPanel({
  view,
  onChange,
}: {
  view: HostView;
  onChange: (view: HostView) => void;
}) {
  return (
    <aside className="relative flex shrink-0 flex-col border-stone-blue/25 bg-egyptian-blue max-md:border-b md:h-full md:w-[24%] md:min-w-[260px] md:max-w-[400px] md:border-r">
      <div className="flex items-center gap-4 px-6 pt-6 pb-5 md:px-9 md:pt-11">
        <SealStamp size={48} />
        <div className="leading-none">
          <div className="font-brush text-[2rem] text-rice-paper">{GAME_NAME}</div>
          <div className="mt-1.5 font-serif text-sm tracking-[0.18em] text-stone-blue uppercase">
            Party sumo
          </div>
        </div>
      </div>

      <LatticeBand className="max-md:hidden" />

      <nav
        aria-label="Main"
        className="flex gap-1 px-4 pb-3 max-md:overflow-x-auto md:flex-col md:px-6 md:pt-10"
      >
        {ITEMS.map((item) => {
          const active = item.id === view;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={active ? "page" : undefined}
              className={`relative flex shrink-0 items-center gap-3 rounded-full px-4 py-2.5 text-left font-serif text-xl transition-colors duration-300 ease-ink outline-none focus-visible:ring-1 focus-visible:ring-stone-blue md:text-2xl ${
                active ? "text-rice-paper" : "text-stone-blue hover:text-rice-paper/85"
              }`}
            >
              <span className="relative flex size-2 items-center justify-center">
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute size-2 rounded-full bg-scarlet"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto px-9 pb-9 max-md:hidden">
        <div className="mb-4 h-px bg-stone-blue/20" />
        <p className="text-xs leading-relaxed tracking-wide text-stone-blue/80">
          Up to 4 players · Phones are your controllers
        </p>
      </div>
    </aside>
  );
}
