"use client";

// ── Playroom glue ────────────────────────────────────────────────────────────
// The FAST LANE of our two-lane architecture: ephemeral game traffic (poses,
// shots, damage) over Playroom's WebSocket rooms. The durable SLOW LANE
// (accounts, skin ownership, leaderboards) comes later on Clerk + Convex.
//
// Model: every client simulates its own character and broadcasts its pose at
// ~12 Hz (unreliable — lost packets are overwritten by the next one anyway).
// Damage is victim-authoritative: the shooter announces the hit, the victim
// applies it to their own HP and announces their own death.

import {
  insertCoin,
  myPlayer,
  onPlayerJoin,
  RPC,
  getRoomCode,
} from "playroomkit";

// Minimal structural type for a Playroom player — keeps us resilient to
// upstream type churn.
export interface NetPlayer {
  id: string;
  getState: (key: string) => unknown;
  setState: (key: string, value: unknown, reliable?: boolean) => void;
  onQuit: (cb: () => void) => void;
}

export interface NetPose {
  p: [number, number, number];
  ry: number;
  a: string; // current animation clip name, or "dead"
}

export interface ShotFxMsg {
  f: [number, number, number];
  t: [number, number, number];
}
export interface DamageMsg {
  t: string; // target player id
  d: number; // damage
  k: string; // shooter id
  kn: string; // shooter name
}
export interface DiedMsg {
  v: string; // victim id
  vn: string;
  k: string; // killer id
  kn: string;
}

let joined = false;

export function isJoined(): boolean {
  return joined;
}

export async function joinRoom(
  skinId: string,
  name: string,
  gunId: string,
  roomCode?: string,
): Promise<void> {
  if (joined) {
    // The socket survives client-side navigation, so a second match in the
    // same tab would silently stay in the OLD room with stale kill counters.
    // Playroom has no leave API — reload to reconnect fresh to the new room.
    const current = getRoomCode();
    if (roomCode && current && current !== roomCode) {
      window.location.reload();
      await new Promise(() => {}); // never settles — the page is reloading
    }
    return;
  }
  // No gameId: fine for development. For production, create a game at
  // dev.joinplayroom.com and pass { gameId: "..." } here.
  // roomCode pins us to a specific room — the bridge from a Convex match.
  await insertCoin({
    skipLobby: true,
    maxPlayersPerRoom: 8,
    ...(roomCode ? { roomCode } : {}),
  });
  joined = true;
  const me = myPlayer();
  me.setState("skin", skinId, true);
  me.setState("gun", gunId, true);
  me.setState("name", name, true);
  me.setState("kills", 0, true);
  me.setState("deaths", 0, true);
}

export function myId(): string {
  return joined ? myPlayer().id : "";
}
export function myName(): string {
  return joined ? ((myPlayer().getState("name") as string) ?? "PLAYER") : "PLAYER";
}
export function me(): NetPlayer | null {
  return joined ? (myPlayer() as unknown as NetPlayer) : null;
}

export function subscribePlayers(cb: (p: NetPlayer) => void): () => void {
  return onPlayerJoin((p) => cb(p as unknown as NetPlayer));
}

export function inviteLink(): string {
  if (typeof window === "undefined") return "";
  const code = getRoomCode();
  const base = `${window.location.origin}${window.location.pathname}`;
  return code ? `${base}#r=${code}` : window.location.href;
}

// ── RPC wrappers ─────────────────────────────────────────────────────────────
export const netEvents = {
  registerShotFx(cb: (m: ShotFxMsg) => void) {
    RPC.register("fx", async (m: ShotFxMsg) => cb(m));
  },
  registerDamage(cb: (m: DamageMsg) => void) {
    RPC.register("dmg", async (m: DamageMsg) => cb(m));
  },
  registerDied(cb: (m: DiedMsg) => void) {
    RPC.register("died", async (m: DiedMsg) => cb(m));
  },
  shotFx(m: ShotFxMsg) {
    if (joined) RPC.call("fx", m, RPC.Mode.OTHERS).catch(() => {});
  },
  damage(m: DamageMsg) {
    if (joined) RPC.call("dmg", m, RPC.Mode.OTHERS).catch(() => {});
  },
  died(m: DiedMsg) {
    if (joined) RPC.call("died", m, RPC.Mode.ALL).catch(() => {});
  },
};
