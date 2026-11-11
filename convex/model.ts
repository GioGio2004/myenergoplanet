// Server-side helpers shared by rooms.ts and players.ts (no functions registered here).
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_TOUCH_MIN_GAP_MS,
  normalizeRoomCode,
  type RoomErrorCode,
} from "./shared";

export function fail(code: RoomErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

/** 128 bits of randomness as hex. */
export function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function randomRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return code;
}

export async function findRoomByCode(
  ctx: QueryCtx | MutationCtx,
  rawCode: string,
): Promise<Doc<"rooms"> | null> {
  const code = normalizeRoomCode(rawCode);
  if (!code) return null;
  return await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

/** The room, or a ROOM_NOT_FOUND / ROOM_CLOSED error. */
export async function requireOpenRoom(
  ctx: QueryCtx | MutationCtx,
  rawCode: string,
): Promise<Doc<"rooms">> {
  const room = await findRoomByCode(ctx, rawCode);
  if (!room) fail("ROOM_NOT_FOUND", "No room with that code.");
  if (room.status === "closed") fail("ROOM_CLOSED", "This room has been closed.");
  return room;
}

/** The host's room, checked against its secret. */
export async function requireHostRoom(
  ctx: MutationCtx,
  rawCode: string,
  hostSecret: string,
): Promise<Doc<"rooms">> {
  const room = await requireOpenRoom(ctx, rawCode);
  if (room.hostSecret !== hostSecret) fail("NOT_ALLOWED", "Only the host screen can do that.");
  return room;
}

/** The player, checked against its rejoin token. */
export async function requirePlayer(
  ctx: MutationCtx,
  playerId: Id<"players">,
  rejoinToken: string,
): Promise<Doc<"players">> {
  const player = await ctx.db.get("players", playerId);
  if (!player || player.rejoinToken !== rejoinToken) {
    fail("PLAYER_GONE", "That spot is no longer yours. Join again.");
  }
  return player;
}

export async function playersInRoom(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
): Promise<Doc<"players">[]> {
  // At most MAX_PLAYERS rows per room.
  return await ctx.db
    .query("players")
    .withIndex("by_roomId_and_slot", (q) => q.eq("roomId", roomId))
    .take(16);
}

export async function presenceOf(
  ctx: QueryCtx | MutationCtx,
  playerId: Id<"players">,
): Promise<Doc<"presence"> | null> {
  return await ctx.db
    .query("presence")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .unique();
}

/** Delete a player and their presence row; hand the leader badge on if needed. */
export async function removePlayer(ctx: MutationCtx, player: Doc<"players">): Promise<void> {
  const presence = await presenceOf(ctx, player._id);
  if (presence) await ctx.db.delete("presence", presence._id);
  await ctx.db.delete("players", player._id);
  if (player.isLeader) await assignLeader(ctx, player.roomId);
}

/** Make the earliest-joined remaining player the leader (if nobody is). */
export async function assignLeader(ctx: MutationCtx, roomId: Id<"rooms">): Promise<void> {
  const players = await playersInRoom(ctx, roomId);
  if (players.length === 0 || players.some((p) => p.isLeader)) return;
  const first = players.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b));
  await ctx.db.patch("players", first._id, { isLeader: true });
}

/** Bump `lastActiveAt`, but rarely, so lobby subscribers are not woken for nothing. */
export async function touchRoom(ctx: MutationCtx, room: Doc<"rooms">, now: number): Promise<void> {
  if (now - room.lastActiveAt >= ROOM_TOUCH_MIN_GAP_MS) {
    await ctx.db.patch("rooms", room._id, { lastActiveAt: now });
  }
}
