"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useConvex, type ConvexReactClient } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { PhoneTransport, type PhoneLinkState } from "./phoneTransport";
import type { LinkMode } from "./protocol";

// One connection per seat, kept at module level so re-renders and StrictMode's double
// mount never open a second one. Closed explicitly when the seat goes away.
let current: { key: string; transport: PhoneTransport } | null = null;

function transportFor(
  client: ConvexReactClient,
  code: string,
  playerId: Id<"players">,
  rejoinToken: string,
): PhoneTransport {
  const key = `${code}:${playerId}:${rejoinToken}`;
  if (current?.key === key) return current.transport;
  current?.transport.dispose();
  current = { key, transport: new PhoneTransport(client, code, { playerId, rejoinToken }) };
  return current.transport;
}

/** The live connection to the host screen for this seat (null on the server / without a seat). */
export function usePhoneTransport(
  code: string,
  playerId: Id<"players"> | null,
  rejoinToken: string | null,
): PhoneTransport | null {
  const client = useConvex();
  return useMemo(() => {
    if (typeof window === "undefined" || !playerId || !rejoinToken) return null;
    return transportFor(client, code, playerId, rejoinToken);
  }, [client, code, playerId, rejoinToken]);
}

export function closePhoneTransport(): void {
  current?.transport.dispose();
  current = null;
}

const noSubscribe = () => () => {};
const connecting = (): PhoneLinkState => "connecting";

/** The transport's connection state, re-rendering when it changes. */
export function usePhoneLink(transport: PhoneTransport | null): PhoneLinkState {
  return useSyncExternalStore(
    transport?.subscribe ?? noSubscribe,
    transport?.getState ?? connecting,
    connecting,
  );
}

const noMode = (): LinkMode | null => null;

/** Which path carries the controller right now ("direct" WebRTC or the Wi-Fi "relay"). */
export function usePhoneMode(transport: PhoneTransport | null): LinkMode | null {
  return useSyncExternalStore(transport?.subscribe ?? noSubscribe, transport?.getMode ?? noMode, noMode);
}
