export {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  normalizeRoomCode,
} from "@/convex/shared";

/** The link a phone opens after scanning the QR. */
export function joinUrl(code: string): string {
  return `${appOrigin()}/play/${code}`;
}

/** Where phones reach this app: NEXT_PUBLIC_APP_URL, else the current origin. */
export function appOrigin(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return base.replace(/\/$/, "");
}
