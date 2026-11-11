"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { useStoredValue } from "./storedValue";

/** The room this host screen opened. Per tab, so it survives refreshes and the trip to /arena. */
export type HostRoom = { code: string; hostSecret: string };

const HOST_KEY = "liquid-sumo:host-room";

export function useHostRoom() {
  return useStoredValue<HostRoom>("session", HOST_KEY);
}

/** A phone's seat in one room. Kept per room code so a phone can be in several rooms over time. */
export type PlayerSeat = { playerId: Id<"players">; rejoinToken: string };

export function usePlayerSeat(code: string) {
  return useStoredValue<PlayerSeat>("local", `liquid-sumo:seat:${code}`);
}
