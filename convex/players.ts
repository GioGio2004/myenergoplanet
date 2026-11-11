import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import {
  assignLeader,
  fail,
  playersInRoom,
  presenceOf,
  randomToken,
  removePlayer,
  requireOpenRoom,
  requirePlayer,
  touchRoom,
} from "./model";
import { MAX_PLAYERS, PRESENCE_TIMEOUT_MS, SLOT_RESERVE_MS, sanitizeName } from "./shared";

const seat = v.object({
  playerId: v.id("players"),
  rejoinToken: v.string(),
  slot: v.number(),
  name: v.string(),
  code: v.string(),
});

/** Record a heartbeat and make sure a presence check is pending. */
async function markSeen(ctx: MutationCtx, playerId: Id<"players">, now: number): Promise<void> {
  const presence = await presenceOf(ctx, playerId);
  if (!presence) {
    await ctx.db.insert("presence", { playerId, lastSeenAt: now, checkScheduled: true });
    await ctx.scheduler.runAfter(PRESENCE_TIMEOUT_MS, internal.players.checkPresence, { playerId });
    return;
  }
  if (presence.checkScheduled) {
    await ctx.db.patch("presence", presence._id, { lastSeenAt: now });
  } else {
    await ctx.db.patch("presence", presence._id, { lastSeenAt: now, checkScheduled: true });
    await ctx.scheduler.runAfter(PRESENCE_TIMEOUT_MS, internal.players.checkPresence, { playerId });
  }
}

/**
 * Pick a slot for a newcomer: the lowest free one, or (in a full lobby) the slot of a
 * player who has been gone for longer than SLOT_RESERVE_MS.
 */
async function claimSlot(
  ctx: MutationCtx,
  players: Doc<"players">[],
  now: number,
): Promise<number | null> {
  const taken = new Set(players.map((p) => p.slot));
  for (let slot = 0; slot < MAX_PLAYERS; slot++) if (!taken.has(slot)) return slot;

  let stalest: { player: Doc<"players">; lastSeenAt: number } | null = null;
  for (const player of players) {
    if (player.connected) continue;
    const presence = await presenceOf(ctx, player._id);
    const lastSeenAt = presence?.lastSeenAt ?? 0;
    if (now - lastSeenAt < SLOT_RESERVE_MS) continue;
    if (!stalest || lastSeenAt < stalest.lastSeenAt) stalest = { player, lastSeenAt };
  }
  if (!stalest) return null;
  await removePlayer(ctx, stalest.player);
  return stalest.player.slot;
}

/** Phone: take a seat in a room's lobby. */
export const join = mutation({
  args: { code: v.string(), name: v.string() },
  returns: seat,
  handler: async (ctx, args) => {
    const room = await requireOpenRoom(ctx, args.code);
    if (room.status !== "lobby") {
      fail("GAME_RUNNING", "A match is under way. You can join when it ends.");
    }
    const now = Date.now();
    const players = await playersInRoom(ctx, room._id);
    const slot = await claimSlot(ctx, players, now);
    if (slot === null) fail("ROOM_FULL", `This room already has ${MAX_PLAYERS} players.`);

    const name = sanitizeName(args.name, `Player ${slot + 1}`);
    const rejoinToken = randomToken();
    const playerId = await ctx.db.insert("players", {
      roomId: room._id,
      name,
      slot,
      rejoinToken,
      connected: true,
      isLeader: false,
    });
    await assignLeader(ctx, room._id);
    await markSeen(ctx, playerId, now);
    await touchRoom(ctx, room, now);
    return { playerId, rejoinToken, slot, name, code: room.code };
  },
});

/** Phone: after a refresh, take the same seat back. */
export const rejoin = mutation({
  args: { playerId: v.id("players"), rejoinToken: v.string() },
  returns: seat,
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerId, args.rejoinToken);
    const room = await ctx.db.get("rooms", player.roomId);
    if (!room || room.status === "closed") fail("ROOM_CLOSED", "This room has been closed.");
    const now = Date.now();
    if (!player.connected) await ctx.db.patch("players", player._id, { connected: true });
    await markSeen(ctx, player._id, now);
    await touchRoom(ctx, room, now);
    return {
      playerId: player._id,
      rejoinToken: player.rejoinToken,
      slot: player.slot,
      name: player.name,
      code: room.code,
    };
  },
});

/** Phone: give the seat up. */
export const leave = mutation({
  args: { playerId: v.id("players"), rejoinToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const player = await ctx.db.get("players", args.playerId);
    if (!player || player.rejoinToken !== args.rejoinToken) return null;
    await removePlayer(ctx, player);
    return null;
  },
});

/** Phone: "still here". Sent every few seconds while the page is open. */
export const heartbeat = mutation({
  args: { playerId: v.id("players"), rejoinToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.playerId, args.rejoinToken);
    const now = Date.now();
    if (!player.connected) await ctx.db.patch("players", player._id, { connected: true });
    await markSeen(ctx, player._id, now);
    const room = await ctx.db.get("rooms", player.roomId);
    if (room) await touchRoom(ctx, room, now);
    return null;
  },
});

/**
 * Scheduled after a heartbeat: marks the player disconnected if no heartbeat came in
 * time, otherwise checks again when the latest heartbeat would expire. At most one
 * check is pending per player.
 */
export const checkPresence = internalMutation({
  args: { playerId: v.id("players") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const presence = await presenceOf(ctx, args.playerId);
    if (!presence) return null;
    const player = await ctx.db.get("players", args.playerId);
    if (!player) {
      await ctx.db.delete("presence", presence._id);
      return null;
    }
    const now = Date.now();
    const expiresAt = presence.lastSeenAt + PRESENCE_TIMEOUT_MS;
    if (now < expiresAt) {
      await ctx.scheduler.runAfter(expiresAt - now + 250, internal.players.checkPresence, {
        playerId: args.playerId,
      });
      return null;
    }
    await ctx.db.patch("presence", presence._id, { checkScheduled: false });
    if (player.connected) await ctx.db.patch("players", player._id, { connected: false });
    return null;
  },
});
