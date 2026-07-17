import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

// ── 1v1 challenge flow (the SLOW LANE half of matchmaking) ──────────────────
// A match row carries a roomCode: when Step 5 wires the gameplay, both clients
// join that Playroom WebSocket room and fight. Convex's reactivity is what
// makes the invite appear on the friend's screen instantly.

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();
  if (!user) throw new Error("Profile not ready yet");
  return user;
}

function makeRoomCode(): string {
  // Convex seeds Math.random deterministically per-execution — safe in mutations.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusable chars
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

const BEST_OF_OPTIONS = [5, 10, 15];
/** Kills needed to win a best-of-N duel. */
function killTarget(bestOf: number | undefined): number {
  const bo = BEST_OF_OPTIONS.includes(bestOf ?? 5) ? (bestOf ?? 5) : 5;
  return Math.ceil((bo + 1) / 2);
}

/** Challenge a friend to a 1v1. Replaces any of MY older open challenges. */
export const challenge = mutation({
  args: { friendUserId: v.id("users"), bestOf: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    if (args.friendUserId === me._id) throw new Error("You can't fight yourself");

    // Clean up my stale open matches (as host) so one challenge exists at a time
    const stale = await ctx.db
      .query("matches")
      .withIndex("byHostStatus", (q) => q.eq("hostId", me._id).eq("status", "pending"))
      .collect();
    for (const m of stale) await ctx.db.delete(m._id);

    const id = await ctx.db.insert("matches", {
      hostId: me._id,
      guestId: args.friendUserId,
      roomCode: makeRoomCode(),
      bestOf: BEST_OF_OPTIONS.includes(args.bestOf ?? 5) ? (args.bestOf ?? 5) : 5,
      status: "pending",
    });
    return id;
  },
});

/** Guest answers a challenge. */
export const respond = mutation({
  args: { matchId: v.id("matches"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const match = await ctx.db.get(args.matchId);
    if (!match || match.guestId !== me._id || match.status !== "pending")
      throw new Error("Challenge no longer exists");
    await ctx.db.patch(match._id, { status: args.accept ? "active" : "declined" });
  },
});

/** Either side can cancel/leave an open or active match. */
export const leave = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const match = await ctx.db.get(args.matchId);
    if (!match) return;
    if (match.hostId !== me._id && match.guestId !== me._id) throw new Error("Not your match");
    if (match.status === "pending" || match.status === "active") {
      await ctx.db.delete(match._id);
    }
  },
});

/**
 * Report my final kill count. Each side patches its own column; whoever's
 * report shows a player at the kill target flips the match to "finished" and
 * records the winner. Both clients call this when their local scoreboard sees
 * the target, so the match finishes even if only one report arrives.
 */
export const finish = mutation({
  args: {
    matchId: v.id("matches"),
    myKills: v.number(),
    // Set when the opponent left the room mid-match — the survivor claims the
    // win so the row doesn't linger as "active" forever.
    claimWin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const match = await ctx.db.get(args.matchId);
    if (!match) return;
    if (match.hostId !== me._id && match.guestId !== me._id) throw new Error("Not your match");
    if (match.status === "finished") return;
    if (match.status !== "active") return;

    const iAmHost = match.hostId === me._id;
    const hostKills = iAmHost ? args.myKills : (match.hostKills ?? 0);
    const guestKills = iAmHost ? (match.guestKills ?? 0) : args.myKills;

    const patch: Partial<Doc<"matches">> = iAmHost
      ? { hostKills: args.myKills }
      : { guestKills: args.myKills };
    const target = killTarget(match.bestOf);
    if (args.claimWin || hostKills >= target || guestKills >= target) {
      patch.status = "finished";
      patch.winnerId = args.claimWin
        ? me._id
        : hostKills >= guestKills
          ? match.hostId
          : match.guestId;
    }
    await ctx.db.patch(match._id, patch);
  },
});

/** My live match state, one reactive query: incoming invites + current match. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const me = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!me) return null;

    const label = async (id: Doc<"matches">["hostId"]) => {
      const u = await ctx.db.get(id);
      return u ? { id: u._id, name: u.name, username: u.username ?? null, skin: u.skin ?? "volt" } : null;
    };

    // Incoming challenges (I'm the guest, pending)
    const incoming = [];
    for (const m of await ctx.db
      .query("matches")
      .withIndex("byGuestStatus", (q) => q.eq("guestId", me._id).eq("status", "pending"))
      .collect()) {
      const host = await label(m.hostId);
      if (host)
        incoming.push({ matchId: m._id, roomCode: m.roomCode, bestOf: m.bestOf ?? 5, host });
    }

    // My open challenge as host (waiting on them)
    const hostedPending = await ctx.db
      .query("matches")
      .withIndex("byHostStatus", (q) => q.eq("hostId", me._id).eq("status", "pending"))
      .collect();
    let waiting = null;
    if (hostedPending[0]) {
      const guest = await label(hostedPending[0].guestId);
      if (guest)
        waiting = { matchId: hostedPending[0]._id, roomCode: hostedPending[0].roomCode, guest };
    }

    // Active match (either role)
    const activeHost = await ctx.db
      .query("matches")
      .withIndex("byHostStatus", (q) => q.eq("hostId", me._id).eq("status", "active"))
      .collect();
    const activeGuest = await ctx.db
      .query("matches")
      .withIndex("byGuestStatus", (q) => q.eq("guestId", me._id).eq("status", "active"))
      .collect();
    const act = activeHost[0] ?? activeGuest[0] ?? null;
    let active = null;
    if (act) {
      const opponentId = act.hostId === me._id ? act.guestId : act.hostId;
      const opponent = await label(opponentId);
      if (opponent)
        active = {
          matchId: act._id,
          roomCode: act.roomCode,
          bestOf: act.bestOf ?? 5,
          opponent,
          iAmHost: act.hostId === me._id,
        };
    }

    return { incoming, waiting, active };
  },
});
