// Constants and pure helpers shared by the Convex functions and the browser.
// No Convex server imports here, so client code can import this file freely.

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

/** 4-character room codes without look-alike characters (no O/0, I/1/L). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

export const NAME_MAX_LENGTH = 14;

/** Phones ping this often while the page is open. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** A phone silent for this long is shown as disconnected. */
export const PRESENCE_TIMEOUT_MS = 15_000;
/** A disconnected player's slot can be taken by a newcomer after this long (lobby only). */
export const SLOT_RESERVE_MS = 30_000;
/** The host screen pings this often while a room is open. */
export const HOST_TOUCH_INTERVAL_MS = 30_000;
/** `lastActiveAt` is written at most this often, to keep room writes rare. */
export const ROOM_TOUCH_MIN_GAP_MS = 60_000;
/** Rooms with no activity for this long are closed by the cleanup cron. */
export const ROOM_IDLE_CLOSE_MS = 2 * 60 * 60 * 1000;
/** Closed rooms are deleted this long after closing. */
export const CLOSED_ROOM_TTL_MS = 60 * 60 * 1000;

export const DEFAULT_ROOM_SETTINGS = { pointsToWin: 5, matchSeconds: 180 } as const;

export type RoomStatus = "lobby" | "playing" | "results" | "closed";

/** Machine-readable error codes thrown as `ConvexError({ code, message })`. */
export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_CLOSED"
  | "ROOM_FULL"
  | "GAME_RUNNING"
  | "PLAYER_GONE"
  | "NOT_ALLOWED"
  | "NOT_ENOUGH_PLAYERS"
  | "BAD_CODE";

export type RoomErrorData = { code: RoomErrorCode; message: string };

/** Uppercase, strip anything outside the alphabet. Returns null if it cannot be a room code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .split("")
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join("");
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

/** Trim, collapse whitespace, drop control characters, cap the length. Empty → fallback. */
export function sanitizeName(input: string, fallback: string): string {
  const cleaned = input
    // eslint-disable-next-line no-control-regex -- strip control characters on purpose
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}
