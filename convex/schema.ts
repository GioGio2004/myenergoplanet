import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roomStatus = v.union(
  v.literal("lobby"),
  v.literal("playing"),
  v.literal("results"),
  v.literal("closed"),
);

export default defineSchema({
  /** One party. Created by the host screen; `createdAt` is `_creationTime`. */
  rooms: defineTable({
    code: v.string(),
    /** Proves the caller is the host screen. Never returned by public queries. */
    hostSecret: v.string(),
    status: roomStatus,
    lastActiveAt: v.number(),
    settings: v.object({
      pointsToWin: v.number(),
      matchSeconds: v.number(),
    }),
  })
    .index("by_code", ["code"])
    .index("by_status_and_lastActiveAt", ["status", "lastActiveAt"]),

  /** A phone that joined a room. The slot (0–3) decides the colour. */
  players: defineTable({
    roomId: v.id("rooms"),
    name: v.string(),
    slot: v.number(),
    /** Lets the same phone take its slot back after a refresh. Never returned by public queries. */
    rejoinToken: v.string(),
    connected: v.boolean(),
    /** The first player to join; can start the match from their phone. */
    isLeader: v.boolean(),
    /** A computer player added by the host to fill a seat. Never a leader, never times out. */
    isBot: v.optional(v.boolean()),
  }).index("by_roomId_and_slot", ["roomId", "slot"]),

  /**
   * WebRTC signalling between the host screen and each phone: offers, answers and ICE
   * candidates. Rows are deleted once read; the cleanup cron removes stragglers.
   * A peer is "host" or a player id.
   */
  signals: defineTable({
    roomId: v.id("rooms"),
    fromPeer: v.string(),
    toPeer: v.string(),
    kind: v.union(v.literal("offer"), v.literal("answer"), v.literal("ice")),
    payload: v.string(),
  })
    .index("by_roomId_and_toPeer", ["roomId", "toPeer"])
    .index("by_roomId", ["roomId"]),

  /**
   * Heartbeats live apart from `players` so the frequent writes do not re-run the
   * lobby query that every screen subscribes to. `connected` on the player flips
   * only when the state actually changes.
   */
  presence: defineTable({
    playerId: v.id("players"),
    lastSeenAt: v.number(),
    /** A `checkPresence` job is pending for this player. */
    checkScheduled: v.boolean(),
  }).index("by_playerId", ["playerId"]),
});
