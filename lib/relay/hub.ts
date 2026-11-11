import "server-only";

// In-memory message hub for the Wi-Fi relay (the fallback when phone ↔ host WebRTC cannot
// connect). Lives in the Next.js server process, so it works for `next dev` / `next start`
// on the host machine; it is not shared between serverless instances.
//
// Channels are named `<key>.up` (phone → host) and `<key>.down` (host → phone), where the
// key is a random 128-bit value the phone shares with the host through Convex signalling.

type Listener = (channel: string, data: string) => void;
type Hub = { channels: Map<string, Set<Listener>> };

// Kept on globalThis so hot reloads in development reuse the same hub.
const holder = globalThis as typeof globalThis & { __liquidSumoRelay?: Hub };
const hub: Hub = (holder.__liquidSumoRelay ??= { channels: new Map() });

const CHANNEL = /^[a-f0-9]{32}\.(up|down)$/;
export const MAX_CHANNELS_PER_STREAM = 8;
export const MAX_MESSAGE_LENGTH = 4_000;

export function isChannel(value: string): boolean {
  return CHANNEL.test(value);
}

/** Deliver a message to everyone listening on the channel. Returns the number of listeners. */
export function publish(channel: string, data: string): number {
  const listeners = hub.channels.get(channel);
  if (!listeners) return 0;
  for (const listener of listeners) listener(channel, data);
  return listeners.size;
}

/** Listen on several channels. Returns the function that stops listening. */
export function subscribe(channels: string[], listener: Listener): () => void {
  for (const channel of channels) {
    let set = hub.channels.get(channel);
    if (!set) {
      set = new Set();
      hub.channels.set(channel, set);
    }
    set.add(listener);
  }
  return () => {
    for (const channel of channels) {
      const set = hub.channels.get(channel);
      if (!set) continue;
      set.delete(listener);
      if (set.size === 0) hub.channels.delete(channel);
    }
  };
}
