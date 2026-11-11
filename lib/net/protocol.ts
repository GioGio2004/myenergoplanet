// Wire format between a phone and the host screen.
//
// Two WebRTC data channels per phone:
//   "input"  — unordered, no retransmits: the latest stick + buttons, as 5 bytes.
//   "events" — reliable, ordered JSON: host → phone game events, plus ping/pong.

export const INPUT_CHANNEL = "input";
export const EVENTS_CHANNEL = "events";

/** Phones send input on change, at most this often… */
export const INPUT_SEND_INTERVAL_MS = 33;
/** …and at least this often, as a keep-alive. */
export const INPUT_KEEPALIVE_MS = 250;

export type ControllerInput = { x: number; y: number; dash: boolean; brace: boolean };

const FLAG_DASH = 1;
const FLAG_BRACE = 2;

/** [seq u16][x i8][y i8][flags u8] — x/y scaled to ±127. */
export function encodeInput(seq: number, input: ControllerInput): ArrayBuffer {
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint16(0, seq & 0xffff);
  view.setInt8(2, Math.round(clampUnit(input.x) * 127));
  view.setInt8(3, Math.round(clampUnit(input.y) * 127));
  view.setUint8(4, (input.dash ? FLAG_DASH : 0) | (input.brace ? FLAG_BRACE : 0));
  return buffer;
}

/** Decode into `out`. Returns the sequence number, or -1 for a malformed packet. */
export function decodeInput(data: ArrayBuffer, out: ControllerInput): number {
  if (data.byteLength < 5) return -1;
  const view = new DataView(data);
  out.x = view.getInt8(2) / 127;
  out.y = view.getInt8(3) / 127;
  const flags = view.getUint8(4);
  out.dash = (flags & FLAG_DASH) !== 0;
  out.brace = (flags & FLAG_BRACE) !== 0;
  return view.getUint16(0);
}

/** True when `seq` is newer than `last`, allowing for 16-bit wrap-around. */
export function isNewerSeq(seq: number, last: number): boolean {
  if (last < 0) return true;
  const diff = (seq - last) & 0xffff;
  return diff !== 0 && diff < 0x8000;
}

function clampUnit(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : Number.isFinite(v) ? v : 0;
}

/** Host → phone messages on the events channel. */
export type HostMessage =
  | { t: "phase"; phase: string }
  /** Your current score. */
  | { t: "score"; score: number }
  /** You knocked someone out. */
  | { t: "scored"; victim: string }
  /** You were knocked out (by `by`, or fell off when null). */
  | { t: "ko"; by: string | null }
  /** Cooldowns as fractions still to wait (0 = ready). `br` = currently bracing, `bl` = brace hold left. */
  | { t: "cd"; d: number; b: number; br: boolean; bl: number }
  | { t: "vibrate"; ms: number }
  | { t: "ping"; at: number };

/** Phone → host messages on the events channel (and over the relay). */
export type PhoneMessage = { t: "pong"; at: number };

/** How a phone's controller reaches the host right now. */
export type LinkMode = "direct" | "relay";

/** A host message counts as "relay alive" for this long. */
export const RELAY_ALIVE_MS = 6_000;

/** Input over the relay: JSON instead of the 5-byte packet (the relay speaks text). */
export type RelayInput = { t: "in"; s: number; x: number; y: number; f: number };

export function encodeRelayInput(seq: number, input: ControllerInput): string {
  const r = (v: number) => Math.round(clampUnit(v) * 127) / 127;
  const f = (input.dash ? FLAG_DASH : 0) | (input.brace ? FLAG_BRACE : 0);
  return JSON.stringify({ t: "in", s: seq & 0xffff, x: r(input.x), y: r(input.y), f } satisfies RelayInput);
}

/** Decode relay input into `out`; returns the sequence number or -1. */
export function decodeRelayInput(msg: { t?: unknown; s?: unknown; x?: unknown; y?: unknown; f?: unknown }, out: ControllerInput): number {
  if (msg.t !== "in" || typeof msg.s !== "number" || typeof msg.x !== "number" || typeof msg.y !== "number" || typeof msg.f !== "number") {
    return -1;
  }
  out.x = clampUnit(msg.x);
  out.y = clampUnit(msg.y);
  out.dash = (msg.f & FLAG_DASH) !== 0;
  out.brace = (msg.f & FLAG_BRACE) !== 0;
  return msg.s & 0xffff;
}

export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data) as { t?: unknown };
    return typeof msg?.t === "string" ? (msg as HostMessage) : null;
  } catch {
    return null;
  }
}

export function parsePhoneMessage(data: unknown): PhoneMessage | null {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data) as { t?: unknown; at?: unknown };
    return msg?.t === "pong" && typeof msg.at === "number" ? { t: "pong", at: msg.at } : null;
  } catch {
    return null;
  }
}

/** Payload of a signalling row: one connection attempt (`sid`) carries an SDP or an ICE candidate. */
export type SignalPayload = {
  sid: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** Kind "relay": the phone's Wi-Fi relay key (channels `<key>.up` / `<key>.down`). */
  key?: string;
};

export function parseSignal(payload: string): SignalPayload | null {
  try {
    const p = JSON.parse(payload) as SignalPayload;
    return typeof p?.sid === "string" ? p : null;
  } catch {
    return null;
  }
}

/** ICE servers: public STUN, plus TURN when configured (phones on mobile data / strict NATs). */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turn = process.env.NEXT_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}
