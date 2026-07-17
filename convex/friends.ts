import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// ── Friends system ───────────────────────────────────────────────────────────
// One `friendships` row per edge (requester → addressee).
//   "pending"  = request sent, not yet answered
//   "accepted" = friends
// Decline/remove simply deletes the row.

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();
  if (!user) throw new Error("Profile not ready yet — try again in a second");
  return user;
}

const ONLINE_WINDOW_MS = 90_000; // heartbeat is 30 s → <90 s = online

function presence(u: Doc<"users">) {
  return {
    id: u._id,
    name: u.name,
    username: u.username ?? null,
    friendId: u.friendId ?? null,
    skin: u.skin ?? "volt",
    online: (u.lastActiveTimestamp ?? 0) > Date.now() - ONLINE_WINDOW_MS,
  };
}

/** Send a friend request by 8-char friend ID. */
export const sendRequest = mutation({
  args: { friendId: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const code = args.friendId.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4) throw new Error("Type a friend ID");
    if (me.friendId === code) throw new Error("That's your own ID!");

    const target = await ctx.db
      .query("users")
      .withIndex("byFriendId", (q) => q.eq("friendId", code))
      .unique();
    if (!target) throw new Error(`No player with ID ${code}`);

    // Existing edge in either direction?
    const out = await ctx.db
      .query("friendships")
      .withIndex("byPair", (q) => q.eq("requesterId", me._id).eq("addresseeId", target._id))
      .unique();
    const inc = await ctx.db
      .query("friendships")
      .withIndex("byPair", (q) => q.eq("requesterId", target._id).eq("addresseeId", me._id))
      .unique();

    if (out?.status === "accepted" || inc?.status === "accepted")
      throw new Error("You're already friends");
    if (out?.status === "pending") throw new Error("Request already sent");
    if (inc?.status === "pending") {
      // They already asked US — auto-accept, that's clearly mutual
      await ctx.db.patch(inc._id, { status: "accepted" });
      return { autoAccepted: true };
    }

    await ctx.db.insert("friendships", {
      requesterId: me._id,
      addresseeId: target._id,
      status: "pending",
    });
    return { autoAccepted: false };
  },
});

/** Accept an incoming request. */
export const accept = mutation({
  args: { friendshipId: v.id("friendships") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const row = await ctx.db.get(args.friendshipId);
    if (!row || row.addresseeId !== me._id || row.status !== "pending")
      throw new Error("Request no longer exists");
    await ctx.db.patch(row._id, { status: "accepted" });
  },
});

/** Decline an incoming request OR cancel an outgoing one OR unfriend. */
export const remove = mutation({
  args: { friendshipId: v.id("friendships") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const row = await ctx.db.get(args.friendshipId);
    if (!row) return;
    if (row.requesterId !== me._id && row.addresseeId !== me._id)
      throw new Error("Not your friendship");
    await ctx.db.delete(row._id);
  },
});

/** Everything the lobby needs, one reactive query. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const me = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!me) return null;

    const outgoing = await ctx.db
      .query("friendships")
      .withIndex("byRequester", (q) => q.eq("requesterId", me._id))
      .collect();
    const incoming = await ctx.db
      .query("friendships")
      .withIndex("byAddressee", (q) => q.eq("addresseeId", me._id))
      .collect();

    const friends: Array<ReturnType<typeof presence> & { friendshipId: Id<"friendships"> }> = [];
    const pendingIncoming: Array<{ friendshipId: Id<"friendships">; from: ReturnType<typeof presence> }> = [];
    const pendingOutgoing: Array<{ friendshipId: Id<"friendships">; to: ReturnType<typeof presence> }> = [];

    for (const row of outgoing) {
      const other = await ctx.db.get(row.addresseeId);
      if (!other) continue;
      if (row.status === "accepted") friends.push({ ...presence(other), friendshipId: row._id });
      else pendingOutgoing.push({ friendshipId: row._id, to: presence(other) });
    }
    for (const row of incoming) {
      const other = await ctx.db.get(row.requesterId);
      if (!other) continue;
      if (row.status === "accepted") friends.push({ ...presence(other), friendshipId: row._id });
      else pendingIncoming.push({ friendshipId: row._id, from: presence(other) });
    }

    friends.sort((a, b) => Number(b.online) - Number(a.online));

    return {
      me: { ...presence(me), gun: me.gun ?? "desert", isOnboarded: me.isOnboarded ?? false },
      friends,
      pendingIncoming,
      pendingOutgoing,
    };
  },
});
