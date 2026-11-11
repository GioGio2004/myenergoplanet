// 4-character room codes without look-alike characters (no O/0, I/1/L).
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

export function randomRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** The link a phone opens after scanning the QR. */
export function joinUrl(code: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/$/, "")}/play/${code}`;
}
