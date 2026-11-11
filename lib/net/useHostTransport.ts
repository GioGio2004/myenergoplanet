"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useConvex } from "convex/react";
import type { HostRoom } from "@/lib/sessions";
import { HostTransport, type LinkStatus } from "./hostTransport";

/** The host's connections to the phones of this room (null on the server / without a room). */
export function useHostTransport(room: HostRoom | null): HostTransport | null {
  const client = useConvex();
  const code = room?.code ?? null;
  const hostSecret = room?.hostSecret ?? null;
  return useMemo(() => {
    if (typeof window === "undefined" || !code || !hostSecret) return null;
    return HostTransport.for(client, { code, hostSecret });
  }, [client, code, hostSecret]);
}

const EMPTY: ReadonlyMap<string, LinkStatus> = new Map();
const noSubscribe = () => () => {};
const empty = () => EMPTY;

/** Connection state per player id, re-rendering when a dot would change colour. */
export function useLinkStatuses(transport: HostTransport | null): ReadonlyMap<string, LinkStatus> {
  return useSyncExternalStore(
    transport?.subscribe ?? noSubscribe,
    transport?.getStatuses ?? empty,
    empty,
  );
}
