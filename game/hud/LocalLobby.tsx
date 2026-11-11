"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { SealStamp } from "@/components/motifs/SealStamp";
import { PLAYER_STYLES, gameConfig } from "../config";
import { useMatch } from "../hooks";
import type { PlayerSetup, PlayerSlot } from "../types";
import { BlobAvatar } from "./BlobAvatar";
import { KeyHints } from "./KeyHints";
import {
  ALL_SLOTS,
  CONTROL_CYCLE,
  CONTROL_LABELS,
  CONTROL_NAMES,
  defaultName,
  displayName,
  findSetup,
  isKeyboardControl,
  playersNeeded,
  sanitizeName,
  setSlotControl,
  setSlotName,
  type SlotControl,
} from "./lobbyLogic";
import { PILL_PRIMARY, PILL_WAITING, QUIET_LINK, SETTLE, usePanelClass } from "./ui";

export type LocalLobbyProps = {
  setups: PlayerSetup[];
  onSetupsChange: (next: PlayerSetup[]) => void;
  onExit: () => void;
};

type RememberedNames = Partial<Record<PlayerSlot, string>>;

/**
 * Pre-match setup for players sharing this screen: who sits in which of the four
 * colour seats and what drives them. Docked along the bottom so the island and
 * the previewed wrestlers stay in view above it.
 */
export function LocalLobby({ setups, onSetupsChange, onExit }: LocalLobbyProps) {
  const match = useMatch();
  const panel = usePanelClass();
  // A seat that is switched off and on again gets its name back.
  const [remembered, setRemembered] = useState<RememberedNames>({});

  const needed = playersNeeded(setups);
  const ready = needed === 0;

  const changeControl = (slot: PlayerSlot, control: SlotControl) => {
    const current = findSetup(setups, slot);
    if (control === (current?.control ?? "off")) return;
    if (control === "off" && current) {
      setRemembered((names) => ({ ...names, [slot]: current.name }));
    }
    onSetupsChange(setSlotControl(setups, slot, control, remembered[slot]));
  };

  return (
    <motion.section
      aria-label="Local match setup"
      className={`absolute inset-x-0 bottom-[2.4vh] mx-auto flex max-h-[calc(100%-4.8vh)] w-[min(95vw,1680px)] flex-col gap-[1.7vh] overflow-y-auto px-[2.4vh] pt-[2vh] pb-[2.2vh] ${panel}`}
      initial={{ opacity: 0, y: 48 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 36, transition: { duration: 0.3, ease: "easeIn" } }}
      transition={SETTLE}
    >
      <header className="flex items-center gap-[1.5vh]">
        <SealStamp className="size-[clamp(28px,4.2vh,44px)] shrink-0" />
        <h2 className="min-w-0 flex-1 truncate font-serif text-[clamp(1.5rem,3.4vh,2.5rem)] leading-[1.1] font-medium text-rice-paper">
          Choose your wrestlers
        </h2>
        <button
          type="button"
          onClick={onExit}
          className={`${QUIET_LINK} text-[clamp(0.9rem,1.9vh,1.2rem)]`}
        >
          Back
        </button>
      </header>

      <ul className="grid grid-cols-2 gap-[1.2vh] xl:grid-cols-4">
        {ALL_SLOTS.map((slot) => (
          <SlotCard
            key={slot}
            slot={slot}
            setup={findSetup(setups, slot)}
            rememberedName={remembered[slot]}
            onControl={(control) => changeControl(slot, control)}
            onName={(name) => onSetupsChange(setSlotName(setups, slot, name))}
          />
        ))}
      </ul>

      <footer className="flex flex-wrap items-center justify-between gap-x-[3vh] gap-y-[1.2vh]">
        <p className="font-serif text-[clamp(1.05rem,2.3vh,1.6rem)] leading-snug text-rice-paper/85">
          Push everyone off the island. First to {gameConfig.rules.pointsToWin} knockouts wins.
        </p>
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            match.start();
          }}
          className={`${ready ? PILL_PRIMARY : PILL_WAITING} ml-auto text-[clamp(1rem,2.2vh,1.4rem)]`}
        >
          {ready ? "Start" : `Waiting for ${needed} more player${needed === 1 ? "" : "s"}…`}
        </button>
      </footer>
    </motion.section>
  );
}

// ── one seat ─────────────────────────────────────────────────────────────────

/** What the hint row says for a seat that has no keys to show. */
const SEAT_NOTES: Record<Exclude<SlotControl, "keyboardA" | "keyboardB">, string> = {
  off: "Empty seat",
  bot: "Plays on its own",
  remote: "Played from a phone",
};

function SlotCard({
  slot,
  setup,
  rememberedName,
  onControl,
  onName,
}: {
  slot: PlayerSlot;
  setup: PlayerSetup | undefined;
  rememberedName: string | undefined;
  onControl: (control: SlotControl) => void;
  onName: (name: string) => void;
}) {
  const style = PLAYER_STYLES[slot];
  const control: SlotControl = setup?.control ?? "off";
  const active = setup !== undefined;
  const name = setup?.name ?? rememberedName ?? defaultName(slot);

  return (
    <li
      className={`relative flex flex-col gap-[1vh] overflow-hidden rounded-[22px] border px-[1.5vh] pt-[1.8vh] pb-[1.3vh] transition-colors duration-500 ease-ink ${
        active ? "border-stone-blue/30 bg-ink/50" : "border-stone-blue/15 bg-ink/20"
      }`}
    >
      {/* seat colour along the top edge */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[4px] transition-opacity duration-500 ease-ink"
        style={{ backgroundColor: style.color, opacity: active ? 1 : 0.3 }}
      />

      <div className="flex items-center gap-[1.3vh]">
        {/* the wrestler pours in when the seat is taken and shrinks back when it empties */}
        <motion.div
          className="shrink-0"
          initial={false}
          animate={{ opacity: active ? 1 : 0.3, scale: active ? 1 : 0.86 }}
          transition={SETTLE}
        >
          <BlobAvatar slot={slot} className="w-[clamp(46px,7.4vh,84px)]" />
        </motion.div>

        <div className="flex min-w-0 flex-1 flex-col gap-[0.8vh]">
          <NameField slot={slot} name={name} disabled={!active} onCommit={onName} />
          <ControlPicker slot={slot} control={control} onChange={onControl} />
        </div>
      </div>

      <div className="flex min-h-[clamp(34px,4.6vh,52px)] items-center text-[clamp(0.8rem,1.7vh,1.05rem)]">
        {isKeyboardControl(control) ? (
          <KeyHints scheme={control} layout="stacked" />
        ) : (
          <p className="tracking-wide text-stone-blue/80">{SEAT_NOTES[control]}</p>
        )}
      </div>
    </li>
  );
}

// ── name ─────────────────────────────────────────────────────────────────────

/**
 * The player's name. Typing edits a local draft; the name is handed up once, when
 * editing ends (blur or Enter), so the 3D preview is not rebuilt on every keystroke.
 */
function NameField({
  slot,
  name,
  disabled,
  onCommit,
}: {
  slot: PlayerSlot;
  name: string;
  disabled: boolean;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const finish = () => {
    if (draft === null) return;
    const next = displayName(draft, slot);
    setDraft(null);
    if (next !== name) onCommit(next);
  };

  return (
    <input
      type="text"
      value={draft ?? name}
      disabled={disabled}
      aria-label={`${PLAYER_STYLES[slot].label} player name`}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      onFocus={(event) => {
        setDraft(name);
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(sanitizeName(event.target.value))}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-full min-w-0 rounded-[0.5em] border border-transparent bg-transparent px-[0.4em] py-[0.12em] font-serif text-[clamp(1.2rem,2.7vh,1.9rem)] leading-tight font-medium text-rice-paper outline-none transition-colors duration-300 ease-ink select-text hover:border-stone-blue/30 focus:border-stone-blue/60 focus:bg-ink/50 disabled:text-stone-blue/55 disabled:hover:border-transparent"
    />
  );
}

// ── control ──────────────────────────────────────────────────────────────────

/** Off / Keys A / Keys B / Bot. The chosen option is filled in the seat's own colour. */
function ControlPicker({
  slot,
  control,
  onChange,
}: {
  slot: PlayerSlot;
  control: SlotControl;
  onChange: (control: SlotControl) => void;
}) {
  const style = PLAYER_STYLES[slot];
  return (
    <div
      role="group"
      aria-label={`${style.label} controller`}
      className="flex rounded-full border border-stone-blue/35 p-[3px] text-[clamp(0.75rem,1.5vh,0.95rem)]"
    >
      {CONTROL_CYCLE.map((option) => {
        const on = option === control;
        const tinted = on && option !== "off";
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            title={CONTROL_NAMES[option]}
            onClick={() => onChange(option)}
            style={tinted ? { backgroundColor: style.color, color: style.ink } : undefined}
            className={`min-w-0 flex-1 rounded-full py-[0.42em] leading-none font-medium whitespace-nowrap outline-none transition-colors duration-300 ease-ink focus-visible:ring-1 focus-visible:ring-rice-paper ${
              tinted
                ? ""
                : on
                  ? "bg-stone-blue/25 text-rice-paper"
                  : "text-stone-blue hover:text-rice-paper"
            }`}
          >
            {CONTROL_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
