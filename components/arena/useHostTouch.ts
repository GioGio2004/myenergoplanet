"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HOST_TOUCH_INTERVAL_MS } from "@/convex/shared";
import type { HostRoom } from "@/lib/sessions";

/** Keep an open room alive (so the cleanup cron leaves it) while this host screen shows it. */
export function useHostTouch(room: HostRoom | null): void {
  const touch = useMutation(api.rooms.touch);
  const code = room?.code ?? null;
  const hostSecret = room?.hostSecret ?? null;

  useEffect(() => {
    if (!code || !hostSecret) return;
    const ping = () => void touch({ code, hostSecret }).catch(() => {});
    ping();
    const id = window.setInterval(ping, HOST_TOUCH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [code, hostSecret, touch]);
}
