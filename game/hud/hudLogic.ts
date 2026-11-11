// Pure presentation helpers for the HUD. No React, no DOM.

import { PLAYER_STYLES } from "../config";
import type { HudCallout, HudPlayer, PlayerSlot } from "../types";

/** Match clock as `m:ss`. Negative and fractional input is clamped / rounded up. */
export function formatClock(secondsLeft: number): string {
  const total = Number.isFinite(secondsLeft) ? Math.max(0, Math.ceil(secondsLeft)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/** Scoreboard order: best score first, ties broken by slot. Returns a new array. */
export function rankPlayers(players: readonly HudPlayer[]): HudPlayer[] {
  return [...players].sort((a, b) => b.score - a.score || a.slot - b.slot);
}

export type ScoreboardEntry = { player: HudPlayer; place: number };

/**
 * Final standings. The declared winner always comes first in place 1, even if a
 * tie-break decided it; everyone else is ranked by score, and equal scores share
 * a place ("1, 2, 2, 4").
 */
export function scoreboard(
  players: readonly HudPlayer[],
  winner: PlayerSlot | null,
): ScoreboardEntry[] {
  const champion = winner === null ? undefined : players.find((p) => p.slot === winner);
  const rest = rankPlayers(champion ? players.filter((p) => p !== champion) : players);
  const offset = champion ? 2 : 1;
  const entries: ScoreboardEntry[] = champion ? [{ player: champion, place: 1 }] : [];
  for (const player of rest) {
    const ahead = rest.filter((other) => other.score > player.score).length;
    entries.push({ player, place: offset + ahead });
  }
  return entries;
}

/** A run of banner text; `slot` is set when the run is that player's name. */
export type TextSegment = { text: string; slot: PlayerSlot | null };

type NamedSlot = { name: string; slot: PlayerSlot };
type Mark = { start: number; end: number; slot: PlayerSlot };

/** First occurrence of `name` in `text` that does not overlap an already marked range. */
function findFree(text: string, name: string, taken: readonly Mark[]): number {
  if (name.length === 0) return -1;
  let from = 0;
  while (from <= text.length - name.length) {
    const start = text.indexOf(name, from);
    if (start < 0) return -1;
    const end = start + name.length;
    if (!taken.some((m) => start < m.end && end > m.start)) return start;
    from = start + 1;
  }
  return -1;
}

/**
 * Split `text` into segments so the given players' names can be tinted.
 * Returns null if any of the names cannot be located in the text.
 * Longer names are matched first so "Bo" never claims the start of "Bob".
 */
export function tintNames(text: string, names: readonly NamedSlot[]): TextSegment[] | null {
  const order = names
    .map((n, i) => ({ ...n, i }))
    .sort((a, b) => b.name.length - a.name.length || a.i - b.i);

  const marks: Mark[] = [];
  for (const n of order) {
    const start = findFree(text, n.name, marks);
    if (start < 0) return null;
    marks.push({ start, end: start + n.name.length, slot: n.slot });
  }
  marks.sort((a, b) => a.start - b.start);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.start > cursor) segments.push({ text: text.slice(cursor, m.start), slot: null });
    segments.push({ text: text.slice(m.start, m.end), slot: m.slot });
    cursor = m.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), slot: null });
  return segments;
}

function nameOf(players: readonly HudPlayer[], slot: PlayerSlot): string {
  const name = players.find((p) => p.slot === slot)?.name.trim() ?? "";
  return name.length > 0 ? name : PLAYER_STYLES[slot].label;
}

/**
 * Banner text for a knockout, split so both names can be tinted in their player
 * colours. Uses the wording supplied by the rules when the names can be found in
 * it, and otherwise falls back to an equivalent sentence built from the slots.
 */
export function calloutSegments(
  callout: HudCallout,
  players: readonly HudPlayer[],
): TextSegment[] {
  const victim: NamedSlot = { name: nameOf(players, callout.victim), slot: callout.victim };
  const attacker: NamedSlot | null =
    callout.by === null ? null : { name: nameOf(players, callout.by), slot: callout.by };

  const text = callout.text.trim();
  if (text.length > 0) {
    const tinted = tintNames(text, attacker ? [attacker, victim] : [victim]);
    if (tinted) return tinted;
  }

  return attacker
    ? [
        { text: attacker.name, slot: attacker.slot },
        { text: " knocked out ", slot: null },
        { text: victim.name, slot: victim.slot },
        { text: "!", slot: null },
      ]
    : [
        { text: victim.name, slot: victim.slot },
        { text: " fell off!", slot: null },
      ];
}
