import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, findRoomByCode } from "./model";
import { HOST_PEER } from "./shared";

// WebRTC signalling through Convex. Only offers, answers and ICE candidates pass
// through here; live controller input goes over the peer-to-peer data channels.

/** Who is calling: the host screen (room secret) or a phone (player id + token). */
const peerAuth = v.union(
  v.object({ hostSecret: v.string() }),
  v.object({ playerId: v.id("players"), rejoinToken: v.string() }),
);

type PeerAuth =
  | { hostSecret: string }
  | { playerId: Id<"players">; rejoinToken: string };

/** Check the caller against the room and return its peer id, or null if not allowed. */
async function resolvePeer(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
  auth: PeerAuth,
): Promise<string | null> {
  if ("hostSecret" in auth) return auth.hostSecret === room.hostSecret ? HOST_PEER : null;
  const player = await ctx.db.get("players", auth.playerId);
  if (!player || player.roomId !== room._id || player.rejoinToken !== auth.rejoinToken) return null;
  return player._id;
}

/** Send one signalling message. Phones may only talk to the host and vice versa. */
export const send = mutation({
  args: {
    code: v.string(),
    auth: peerAuth,
    to: v.string(),
    kind: v.union(v.literal("offer"), v.literal("answer"), v.literal("ice"), v.literal("relay")),
    payload: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await findRoomByCode(ctx, args.code);
    if (!room || room.status === "closed") fail("ROOM_CLOSED", "This room has been closed.");
    const from = await resolvePeer(ctx, room, args.auth);
    if (!from) fail("NOT_ALLOWED", "Not part of this room.");
    if ((from === HOST_PEER) === (args.to === HOST_PEER)) {
      fail("NOT_ALLOWED", "Signals go between the host and a phone.");
    }
    if (args.payload.length > 20_000) fail("NOT_ALLOWED", "Signal too large.");
    await ctx.db.insert("signals", {
      roomId: room._id,
      fromPeer: from,
      toPeer: args.to,
      kind: args.kind,
      payload: args.payload,
    });
    return null;
  },
});

/** Unread signalling messages addressed to the caller, oldest first. */
export const listForPeer = query({
  args: { code: v.string(), auth: peerAuth },
  returns: v.array(
    v.object({
      id: v.id("signals"),
      from: v.string(),
      kind: v.union(v.literal("offer"), v.literal("answer"), v.literal("ice"), v.literal("relay")),
      payload: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const room = await findRoomByCode(ctx, args.code);
    if (!room || room.status === "closed") return [];
    const me = await resolvePeer(ctx, room, args.auth);
    if (!me) return [];
    const rows = await ctx.db
      .query("signals")
      .withIndex("by_roomId_and_toPeer", (q) => q.eq("roomId", room._id).eq("toPeer", me))
      .take(100);
    return rows.map((r) => ({ id: r._id, from: r.fromPeer, kind: r.kind, payload: r.payload }));
  },
});

/** Delete signalling messages the caller has handled. */
export const consume = mutation({
  args: { code: v.string(), auth: peerAuth, ids: v.array(v.id("signals")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const room = await findRoomByCode(ctx, args.code);
    if (!room) return null;
    const me = await resolvePeer(ctx, room, args.auth);
    if (!me) return null;
    for (const id of args.ids.slice(0, 200)) {
      const row = await ctx.db.get("signals", id);
      if (row && row.roomId === room._id && row.toPeer === me) await ctx.db.delete("signals", id);
    }
    return null;
  },
});
