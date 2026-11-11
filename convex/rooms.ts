import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import {
  fail,
  findRoomByCode,
  playersInRoom,
  presenceOf,
  randomRoomCode,
  randomToken,
  requireHostRoom,
  requireOpenRoom,
  requirePlayer,
  touchRoom,
} from "./model";
import {
  CLOSED_ROOM_TTL_MS,
  DEFAULT_ROOM_SETTINGS,
  MIN_PLAYERS,
  ROOM_IDLE_CLOSE_MS,
} from "./shared";

const publicPlayer = v.object({
  id: v.id("players"),
  name: v.string(),
  slot: v.number(),
  connected: v.boolean(),
  isLeader: v.boolean(),
});

const lobbyView = v.object({
  code: v.string(),
  status: v.union(v.literal("lobby"), v.literal("playing"), v.literal("results"), v.literal("closed")),
  settings: v.object({ pointsToWin: v.number(), matchSeconds: v.number() }),
  players: v.array(publicPlayer),
});

/** Who is asking: the host screen (secret) or a player's phone (id + token). */
const caller = v.union(
  v.object({ hostSecret: v.string() }),
  v.object({ playerId: v.id("players"), rejoinToken: v.string() }),
);

/** Host screen: open a new room. */
export const create = mutation({
  args: {},
  returns: v.object({ code: v.string(), hostSecret: v.string() }),
  handler: async (ctx) => {
    let code = randomRoomCode();
    for (let attempt = 0; await findRoomByCode(ctx, code); attempt++) {
      if (attempt > 20) throw new Error("Could not allocate a room code");
      code = randomRoomCode();
    }
    const hostSecret = randomToken();
    await ctx.db.insert("rooms", {
      code,
      hostSecret,
      status: "lobby",
      lastActiveAt: Date.now(),
      settings: { ...DEFAULT_ROOM_SETTINGS },
    });
    return { code, hostSecret };
  },
});

/** Everything a screen needs to draw the lobby. Null when the code matches no room. */
export const lobby = query({
  args: { code: v.string() },
  returns: v.union(v.null(), lobbyView),
  handler: async (ctx, args) => {
    const room = await findRoomByCode(ctx, args.code);
    if (!room) return null;
    const players = await playersInRoom(ctx, room._id);
    return {
      code: room.code,
      status: room.status,
      settings: room.settings,
      players: players
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({
          id: p._id,
          name: p.name,
          slot: p.slot,
          connected: p.connected,
          isLeader: p.isLeader,
        })),
    };
  },
});

/** Host screen heartbeat: keeps the room from being cleaned up while it is open. */
export const touch = mutation({
  args: { code: v.string(), hostSecret: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireHostRoom(ctx, args.code, args.hostSecret);
    await touchRoom(ctx, room, Date.now());
    return null;
  },
});

/**
 * Move the room between lobby / playing / results.
 * The host may make any move. The leader's phone may only start a match
 * (lobby → playing) or ask for a rematch (results → playing).
 * Starting needs at least MIN_PLAYERS connected players.
 */
export const setStatus = mutation({
  args: {
    code: v.string(),
    status: v.union(v.literal("lobby"), v.literal("playing"), v.literal("results")),
    caller,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await requireOpenRoom(ctx, args.code);

    if ("hostSecret" in args.caller) {
      if (room.hostSecret !== args.caller.hostSecret) {
        fail("NOT_ALLOWED", "Only the host screen can do that.");
      }
    } else {
      const player = await requirePlayer(ctx, args.caller.playerId, args.caller.rejoinToken);
      const startOrRematch =
        args.status === "playing" && (room.status === "lobby" || room.status === "results");
      if (player.roomId !== room._id || !player.isLeader || !startOrRematch) {
        fail("NOT_ALLOWED", "Only the first player to join can start the match.");
      }
    }

    if (room.status === args.status) return null;

    if (args.status === "playing" && room.status === "lobby") {
      const players = await playersInRoom(ctx, room._id);
      const ready = players.filter((p) => p.connected).length;
      if (ready < MIN_PLAYERS) {
        fail("NOT_ENOUGH_PLAYERS", `At least ${MIN_PLAYERS} players are needed to start.`);
      }
    }

    await ctx.db.patch("rooms", room._id, { status: args.status, lastActiveAt: Date.now() });
    return null;
  },
});

/** Host screen: close the room. Phones see it as closed; the cron deletes it later. */
export const close = mutation({
  args: { code: v.string(), hostSecret: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await findRoomByCode(ctx, args.code);
    if (!room || room.status === "closed") return null;
    if (room.hostSecret !== args.hostSecret) fail("NOT_ALLOWED", "Only the host screen can do that.");
    await closeRoom(ctx, room._id);
    return null;
  },
});

/** Close a room and remove its players. */
async function closeRoom(ctx: MutationCtx, roomId: Id<"rooms">): Promise<void> {
  for (const player of await playersInRoom(ctx, roomId)) {
    const presence = await presenceOf(ctx, player._id);
    if (presence) await ctx.db.delete("presence", presence._id);
    await ctx.db.delete("players", player._id);
  }
  await ctx.db.patch("rooms", roomId, { status: "closed", lastActiveAt: Date.now() });
}

const CLEANUP_BATCH = 50;

/** Cron: close rooms idle for 2 hours, delete rooms closed for an hour. */
export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    let more = false;

    for (const status of ["lobby", "playing", "results"] as const) {
      const idle = await ctx.db
        .query("rooms")
        .withIndex("by_status_and_lastActiveAt", (q) =>
          q.eq("status", status).lt("lastActiveAt", now - ROOM_IDLE_CLOSE_MS),
        )
        .take(CLEANUP_BATCH);
      for (const room of idle) await closeRoom(ctx, room._id);
      if (idle.length === CLEANUP_BATCH) more = true;
    }

    const expired = await ctx.db
      .query("rooms")
      .withIndex("by_status_and_lastActiveAt", (q) =>
        q.eq("status", "closed").lt("lastActiveAt", now - CLOSED_ROOM_TTL_MS),
      )
      .take(CLEANUP_BATCH);
    for (const room of expired) await ctx.db.delete("rooms", room._id);
    if (expired.length === CLEANUP_BATCH) more = true;

    if (more) await ctx.scheduler.runAfter(0, internal.rooms.cleanup, {});
    return null;
  },
});
