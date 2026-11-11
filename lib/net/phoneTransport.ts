"use client";

import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { HOST_PEER } from "@/convex/shared";
import type { PlayerSeat } from "@/lib/sessions";
import {
  EVENTS_CHANNEL,
  INPUT_CHANNEL,
  INPUT_KEEPALIVE_MS,
  INPUT_SEND_INTERVAL_MS,
  RELAY_ALIVE_MS,
  encodeInput,
  encodeRelayInput,
  iceServers,
  parseHostMessage,
  parseSignal,
  type ControllerInput,
  type HostMessage,
  type LinkMode,
  type SignalPayload,
} from "./protocol";
import { RelaySender, openRelayStream, randomRelayKey } from "./relayClient";

export type PhoneLinkState = "connecting" | "open" | "reconnecting";

/** No answer from the host within this long → try again. */
const ANSWER_TIMEOUT_MS = 10_000;
/** "disconnected" can recover on its own; give it this long before reconnecting. */
const DISCONNECTED_GRACE_MS = 3_000;
/** Direct-link retries. Once the relay carries the controller, retry only occasionally. */
const RETRY_DELAYS_MS = [800, 1_500, 3_000, 5_000, 10_000];
const RETRY_WHILE_RELAYING_MS = 30_000;
/** Re-announce the relay key this often while the host is silent on the relay. */
const RELAY_ANNOUNCE_MS = 4_000;
const STATUS_CHECK_MS = 1_000;

type SignalRow = {
  id: Id<"signals">;
  from: string;
  kind: "offer" | "answer" | "ice" | "relay";
  payload: string;
};

/**
 * A phone's connection to the host screen.
 *
 * Two paths run side by side:
 * - a direct WebRTC link (signalled through Convex): lowest latency, preferred;
 * - the Wi-Fi relay (HTTP through this app's own server): works wherever the page loads,
 *   used when the network or a firewall blocks WebRTC.
 * Input goes out on the direct link when it is open, else on the relay. Reconnects by itself.
 */
export class PhoneTransport {
  state: PhoneLinkState = "connecting";
  mode: LinkMode | null = null;

  private pc: RTCPeerConnection | null = null;
  private input: RTCDataChannel | null = null;
  private events: RTCDataChannel | null = null;
  private sid = "";
  private remoteSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private processed = new Set<string>();
  private unwatch: () => void;
  private intervals: number[] = [];
  private retryTimer = 0;
  private graceTimer = 0;
  private answerTimer = 0;
  private attempts = 0;
  private everConnected = false;
  private disposed = false;

  // Wi-Fi relay
  private readonly relayKey = randomRelayKey();
  private closeRelayStream: (() => void) | null = null;
  private relaySender = new RelaySender();
  private lastRelayFromHost = 0;
  private lastAnnounce = 0;

  private latest: ControllerInput = { x: 0, y: 0, dash: false, brace: false };
  private dirty = true;
  private seq = 0;
  private lastSentAt = 0;

  private stateListeners = new Set<() => void>();
  private messageListeners = new Set<(msg: HostMessage) => void>();

  constructor(
    private client: ConvexReactClient,
    private code: string,
    private seat: PlayerSeat,
  ) {
    const watch = client.watchQuery(api.signals.listForPeer, { code, auth: seat });
    const onUpdate = () => this.onSignals(watch.localQueryResult() ?? []);
    this.unwatch = watch.onUpdate(onUpdate);
    onUpdate();

    this.closeRelayStream = openRelayStream([`${this.relayKey}.down`], (_ch, data) =>
      this.onRelayMessage(data),
    );
    this.announceRelay();

    this.intervals.push(
      window.setInterval(() => this.flushInput(), INPUT_SEND_INTERVAL_MS),
      window.setInterval(() => this.tick(), STATUS_CHECK_MS),
    );
    this.connect();
  }

  // ── public API ───────────────────────────────────────────────────────────

  /** Update the controller state; it is sent right away (rate-capped). */
  setInput(x: number, y: number, dash: boolean, brace: boolean): void {
    const l = this.latest;
    if (l.x === x && l.y === y && l.dash === dash && l.brace === brace) return;
    l.x = x;
    l.y = y;
    l.dash = dash;
    l.brace = brace;
    this.dirty = true;
    this.flushInput();
  }

  onMessage(listener: (msg: HostMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  };

  getState = (): PhoneLinkState => this.state;
  getMode = (): LinkMode | null => this.mode;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unwatch();
    for (const id of this.intervals) window.clearInterval(id);
    this.clearTimers();
    this.teardown();
    this.closeRelayStream?.();
    this.closeRelayStream = null;
    this.stateListeners.clear();
    this.messageListeners.clear();
  }

  // ── direct link (WebRTC) ─────────────────────────────────────────────────

  private connect(): void {
    if (this.disposed) return;
    this.teardown();
    this.clearTimers();
    this.sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.remoteSet = false;
    this.pendingIce = [];

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: iceServers() });
    } catch {
      // No WebRTC here (old browser, blocked): the relay carries everything.
      this.scheduleReconnect();
      return;
    }
    this.pc = pc;
    const input = pc.createDataChannel(INPUT_CHANNEL, { ordered: false, maxRetransmits: 0 });
    input.binaryType = "arraybuffer";
    const events = pc.createDataChannel(EVENTS_CHANNEL);
    this.input = input;
    this.events = events;

    const sid = this.sid;
    pc.onicecandidate = (e) => {
      if (e.candidate && sid === this.sid) {
        this.signal("ice", { sid, candidate: e.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") this.scheduleReconnect();
      else if (s === "disconnected") {
        window.clearTimeout(this.graceTimer);
        this.graceTimer = window.setTimeout(() => {
          if (pc === this.pc && pc.connectionState !== "connected") this.scheduleReconnect();
        }, DISCONNECTED_GRACE_MS);
      }
    };
    events.onopen = () => {
      if (pc !== this.pc) return;
      this.attempts = 0;
      window.clearTimeout(this.answerTimer);
      this.dirty = true;
      this.recompute();
    };
    events.onclose = () => {
      if (pc === this.pc) this.scheduleReconnect();
    };
    events.onmessage = (m) => this.onHostMessage(m.data, "direct");

    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc !== this.pc) return;
        this.signal("offer", { sid, sdp: pc.localDescription!.toJSON() });
        this.answerTimer = window.setTimeout(() => {
          if (pc === this.pc && this.events?.readyState !== "open") this.scheduleReconnect();
        }, ANSWER_TIMEOUT_MS);
      } catch {
        this.scheduleReconnect();
      }
    })();
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.teardown();
    this.recompute();
    window.clearTimeout(this.retryTimer);
    const delay = this.relayAlive()
      ? RETRY_WHILE_RELAYING_MS
      : RETRY_DELAYS_MS[Math.min(this.attempts, RETRY_DELAYS_MS.length - 1)];
    this.attempts++;
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private teardown(): void {
    const pc = this.pc;
    this.pc = null;
    this.input = null;
    this.events = null;
    if (!pc) return;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.close();
  }

  private clearTimers(): void {
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.graceTimer);
    window.clearTimeout(this.answerTimer);
  }

  private onSignals(rows: SignalRow[]): void {
    if (this.disposed) return;
    const fresh = rows.filter((r) => !this.processed.has(r.id));
    if (fresh.length === 0) return;
    for (const row of fresh) {
      this.processed.add(row.id);
      void this.handleSignal(row);
    }
    void this.client
      .mutation(api.signals.consume, { code: this.code, auth: this.seat, ids: fresh.map((r) => r.id) })
      .catch(() => {});
  }

  private async handleSignal(row: SignalRow): Promise<void> {
    const payload = parseSignal(row.payload);
    const pc = this.pc;
    if (!payload || !pc || payload.sid !== this.sid) return; // stale attempt
    try {
      if (row.kind === "answer" && payload.sdp && !this.remoteSet) {
        await pc.setRemoteDescription(payload.sdp);
        this.remoteSet = true;
        for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (row.kind === "ice" && payload.candidate) {
        if (this.remoteSet) await pc.addIceCandidate(payload.candidate).catch(() => {});
        else this.pendingIce.push(payload.candidate);
      }
    } catch {
      this.scheduleReconnect();
    }
  }

  private signal(kind: "offer" | "ice" | "relay", payload: SignalPayload): void {
    void this.client
      .mutation(api.signals.send, {
        code: this.code,
        auth: this.seat,
        to: HOST_PEER,
        kind,
        payload: JSON.stringify(payload),
      })
      .catch(() => {});
  }

  // ── Wi-Fi relay ──────────────────────────────────────────────────────────

  /** Tell the host (through Convex) which relay key this phone listens on. */
  private announceRelay(): void {
    this.lastAnnounce = performance.now();
    this.signal("relay", { sid: this.relayKey, key: this.relayKey });
  }

  private relayAlive(): boolean {
    return this.lastRelayFromHost > 0 && performance.now() - this.lastRelayFromHost < RELAY_ALIVE_MS;
  }

  private onRelayMessage(data: string): void {
    this.lastRelayFromHost = performance.now();
    this.onHostMessage(data, "relay");
    this.recompute();
  }

  // ── data ─────────────────────────────────────────────────────────────────

  private flushInput(): void {
    const direct = this.input?.readyState === "open" ? this.input : null;
    if (!direct && !this.relayAlive()) return;
    const now = performance.now();
    if (!this.dirty && now - this.lastSentAt < INPUT_KEEPALIVE_MS) return;
    // Cap the send rate (the interval picks up whatever is left).
    if (this.dirty && now - this.lastSentAt < INPUT_SEND_INTERVAL_MS * 0.5) return;
    this.seq = (this.seq + 1) & 0xffff;
    if (direct) direct.send(encodeInput(this.seq, this.latest));
    else this.relaySender.send(`${this.relayKey}.up`, encodeRelayInput(this.seq, this.latest), "in");
    this.lastSentAt = now;
    this.dirty = false;
  }

  private onHostMessage(data: unknown, via: LinkMode): void {
    const msg = parseHostMessage(data);
    if (!msg) return;
    if (msg.t === "ping") {
      const pong = JSON.stringify({ t: "pong", at: msg.at });
      if (via === "direct" && this.events?.readyState === "open") this.events.send(pong);
      else if (via === "relay") this.relaySender.send(`${this.relayKey}.up`, pong);
      return;
    }
    for (const l of this.messageListeners) l(msg);
  }

  /** Once a second: notice a silent relay, re-announce it, refresh the state. */
  private tick(): void {
    if (this.disposed) return;
    const direct = this.events?.readyState === "open";
    if (!direct && !this.relayAlive() && performance.now() - this.lastAnnounce > RELAY_ANNOUNCE_MS) {
      // The host may have reloaded and forgotten our key.
      this.announceRelay();
    }
    this.recompute();
  }

  private recompute(): void {
    const direct = this.events?.readyState === "open";
    const mode: LinkMode | null = direct ? "direct" : this.relayAlive() ? "relay" : null;
    if (mode) this.everConnected = true;
    const state: PhoneLinkState = mode ? "open" : this.everConnected ? "reconnecting" : "connecting";
    if (state === this.state && mode === this.mode) return;
    if (mode && !this.mode) this.dirty = true; // resend input on the newly opened path
    this.state = state;
    this.mode = mode;
    for (const l of this.stateListeners) l();
  }
}
