import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";

const NEW_USER_DEFAULTS = {
  watts: 0,
  streak: 0,
  currentModuleId: "module_electricity_1",
  completedLessons: [] as string[],
};

/** Looks up the user record for the authenticated identity, or null. */
async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  return await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();
}

/**
 * Called by the Clerk webhook on user.created and user.updated events.
 * Creates a new user record or updates the existing one.
 */
export const upsertFromClerk = internalMutation({
  args: {
    data: v.any(), // Clerk UserJSON object — narrowed below
  },

  handler: async (ctx, { data }) => {
    // The webhook payload is external input: narrow before trusting it.
    if (typeof data !== "object" || data === null) {
      throw new Error("Invalid Clerk webhook payload");
    }
    const clerkUserId = (data as Record<string, unknown>).id;
    if (typeof clerkUserId !== "string" || clerkUserId.length === 0) {
      throw new Error("Clerk webhook payload missing user id");
    }
    const firstName = (data as Record<string, unknown>).first_name;
    const lastName = (data as Record<string, unknown>).last_name;
    const rawUsername = (data as Record<string, unknown>).username;
    const username =
      typeof rawUsername === "string" && rawUsername.length > 0
        ? rawUsername.toLowerCase()
        : undefined;
    const name =
      [firstName, lastName]
        .filter((part): part is string => typeof part === "string" && part !== "")
        .join(" ") || "Unknown";

    const existing = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", clerkUserId))
      .unique();

    if (existing === null) {
      await ctx.db.insert("users", {
        name,
        externalId: clerkUserId,
        ...(username ? { username } : {}),
        ...NEW_USER_DEFAULTS,
      });
    } else {
      await ctx.db.patch(existing._id, { name, ...(username ? { username } : {}) });
    }
  },
});

/**
 * Called by the Clerk webhook on user.deleted events.
 * Removes the user record from the database.
 */
export const deleteFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", clerkUserId))
      .unique();

    if (user !== null) {
      await ctx.db.delete(user._id);
    }
  },
});

/**
 * Saves onboarding data for the currently authenticated user.
 */
export const saveOnboardingData = mutation({
  args: {
    baseType: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated call to saveOnboardingData");
    }

    let user = await getCurrentUser(ctx);

    // If the Clerk webhook hasn't caught up yet, create the user on the fly
    if (!user) {
      const name = identity.name ?? "Unknown";
      const nickname =
        typeof identity.nickname === "string" && identity.nickname.length > 0
          ? identity.nickname.toLowerCase()
          : undefined;
      const newUserId = await ctx.db.insert("users", {
        name,
        externalId: identity.subject,
        ...(nickname ? { username: nickname } : {}),
        ...NEW_USER_DEFAULTS,
      });
      user = await ctx.db.get(newUserId);
    }

    if (!user) {
      throw new Error("Failed to create user record");
    }

    await ctx.db.patch(user._id, {
      onboarding: {
        baseType: args.baseType,
      },
      isOnboarded: true,
    });
  },
});

/**
 * Fetches the currently authenticated user's record from the database.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      // GUEST DEMO MODE: Return mock user record
      return {
        _id: "demo_guest",
        _creationTime: 0,
        name: "Guest Player",
        externalId: "demo_guest",
        isOnboarded: true,
        onboarding: { baseType: "apartment", monthlyBill: 50, tariff: "standard" },
        watts: 450,
        streak: 12,
        currentModuleId: "module_meter_1",
        completedLessons: ["module_electricity_1"],
      };
    }

    return await getCurrentUser(ctx);
  },
});


/**
 * Presence heartbeat — clients call this every ~30 s while the tab is open.
 * Friends are shown as "online" if their last beat is recent.
 */
export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    await ctx.db.patch(user._id, { lastActiveTimestamp: Date.now() });
  },
});

/**
 * Persists the player's chosen BLACKOUT loadout (skin colour + weapon finish).
 */
export const setLoadout = mutation({
  args: { skin: v.optional(v.string()), gun: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    await ctx.db.patch(user._id, {
      ...(args.skin ? { skin: args.skin } : {}),
      ...(args.gun ? { gun: args.gun } : {}),
    });
  },
});

/**
 * Ensures the signed-in user has a row even if the Clerk webhook is not
 * configured yet — called once on app load. Also refreshes the username.
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const existing = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (existing) return existing._id;
    // Bare row — username + friendId are set by completeOnboarding (the popup).
    return await ctx.db.insert("users", {
      name: identity.name ?? "Unknown",
      externalId: identity.subject,
      ...NEW_USER_DEFAULTS,
    });
  },
});

// 8-char code, no confusable characters (no 0/O/1/I/L).
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
async function generateUniqueFriendId(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = "";
    for (let i = 0; i < 8; i++)
      code += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    const clash = await ctx.db
      .query("users")
      .withIndex("byFriendId", (q) => q.eq("friendId", code))
      .unique();
    if (!clash) return code;
  }
  throw new Error("Could not allocate a friend ID — try again");
}

/**
 * The registration popup: set a display username and (if missing) mint a unique
 * 8-char friend ID. Marks the account onboarded so the popup never blocks again.
 */
export const completeOnboarding = mutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const username = args.username.trim();
    if (username.length < 3 || username.length > 16)
      throw new Error("Username must be 3–16 characters");
    if (!/^[A-Za-z0-9 _]+$/.test(username))
      throw new Error("Letters, numbers, spaces and _ only");

    let user = await getCurrentUser(ctx);
    if (!user) {
      const id = await ctx.db.insert("users", {
        name: identity.name ?? username,
        externalId: identity.subject,
        ...NEW_USER_DEFAULTS,
      });
      user = await ctx.db.get(id);
    }
    if (!user) throw new Error("Could not create profile");

    const friendId = user.friendId ?? (await generateUniqueFriendId(ctx));
    await ctx.db.patch(user._id, { username, friendId, isOnboarded: true });
    return { friendId };
  },
});
