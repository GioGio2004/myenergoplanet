import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    // Clerk user ID, stored in the subject JWT field
    externalId: v.string(),
    // Display username (chosen in the in-app onboarding popup)
    username: v.optional(v.string()),
    // 8-char alphanumeric FRIEND ID — the shareable code others use to add you
    friendId: v.optional(v.string()),
    // Chosen BLACKOUT skin id ("volt" | "ember" | "ocean" | "acid")
    skin: v.optional(v.string()),
    // Chosen weapon finish id ("desert" | "night" | "forest" | "gold")
    gun: v.optional(v.string()),
    onboarding: v.optional(
      v.object({
        baseType: v.optional(v.string()),
        monthlyBill: v.optional(v.number()),
        tariff: v.optional(v.string()),
      })
    ),
    isOnboarded: v.optional(v.boolean()),
    // Game fields
    watts: v.optional(v.number()),
    streak: v.optional(v.number()),
    lastActiveTimestamp: v.optional(v.number()),
    currentModuleId: v.optional(v.string()),
    completedLessons: v.optional(v.array(v.string())),
  })
    .index("byExternalId", ["externalId"])
    .index("byUsername", ["username"])
    .index("byFriendId", ["friendId"]),

  // ── Friends (Step 3) ──────────────────────────────────────────────────────
  // One row per friendship EDGE, requester → addressee. status flows
  // "pending" → "accepted" (or the row is deleted on decline/remove).
  friendships: defineTable({
    requesterId: v.id("users"),
    addresseeId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
  })
    .index("byRequester", ["requesterId"])
    .index("byAddressee", ["addresseeId"])
    .index("byPair", ["requesterId", "addresseeId"]),

  // ── Matches (Step 4) ──────────────────────────────────────────────────────
  // A challenge between two friends. The roomCode bridges to the Playroom
  // fast-lane: both clients join that WebSocket room to actually fight.
  matches: defineTable({
    hostId: v.id("users"),
    guestId: v.id("users"),
    roomCode: v.string(),
    // Match length chosen by the host: 5 | 10 | 15 rounds ("best of").
    // First to ceil((bestOf+1)/2) kills wins. Missing = 5 (older rows).
    bestOf: v.optional(v.number()),
    status: v.union(
      v.literal("pending"), // challenge sent, waiting for guest
      v.literal("active"), // both accepted — fight on
      v.literal("declined"),
      v.literal("finished"),
    ),
    // Filled at match end (Step 6)
    hostKills: v.optional(v.number()),
    guestKills: v.optional(v.number()),
    winnerId: v.optional(v.id("users")),
  })
    .index("byGuestStatus", ["guestId", "status"])
    .index("byHostStatus", ["hostId", "status"]),
});
