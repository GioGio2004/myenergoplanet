"use client";

// Browser side of the Wi-Fi relay (see lib/relay/hub.ts). Plain HTTP to the same server
// that served the page, so it works wherever the page itself loads.

export function randomRelayKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Listen on relay channels. Reconnects by itself (EventSource). Returns a close function. */
export function openRelayStream(
  channels: string[],
  onMessage: (channel: string, data: string) => void,
  onOpen?: () => void,
): () => void {
  const source = new EventSource(`/api/relay/stream?ch=${channels.join(",")}`);
  source.onmessage = (event) => {
    try {
      const { ch, d } = JSON.parse(event.data as string) as { ch: string; d: string };
      if (typeof ch === "string" && typeof d === "string") onMessage(ch, d);
    } catch {
      // Ignore malformed events.
    }
  };
  if (onOpen) source.onopen = onOpen;
  return () => source.close();
}

/**
 * Sends relay messages one at a time. While a request is in flight, newer messages wait;
 * messages sharing a `coalesceKey` replace each other, so only the latest input or cooldown
 * update goes out (they are snapshots, older ones are useless).
 */
export class RelaySender {
  private queue: { ch: string; d: string; key: string | null }[] = [];
  private busy = false;

  send(ch: string, d: string, coalesceKey: string | null = null): void {
    if (coalesceKey !== null) {
      const existing = this.queue.find((m) => m.key === coalesceKey && m.ch === ch);
      if (existing) {
        existing.d = d;
        return;
      }
    }
    if (this.queue.length > 64) this.queue.shift(); // never grow without bound
    this.queue.push({ ch, d, key: coalesceKey });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        try {
          await fetch("/api/relay/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ch: msg.ch, d: msg.d }),
            cache: "no-store",
          });
        } catch {
          // Network hiccup: drop this one, keep going.
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
