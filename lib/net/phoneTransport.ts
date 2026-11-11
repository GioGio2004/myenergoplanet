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
  encodeInput,
  iceServers,
  parseHostMessage,
  parseSignal,
  type ControllerInput,
  type HostMessage,
  type SignalPayload,
} from "./protocol";

export type PhoneLinkState = "connecting" | "open" | "reconnecting";

/** No answer from the host within this long → try again. */
const ANSWER_TIMEOUT_MS = 10_000;
/** "disconnected" can recover on its own; give it this long before reconnecting. */
const DISCONNECTED_GRACE_MS = 3_000;
const RETRY_DELAYS_MS = [800, 1_500, 3_000, 5_000];

type SignalRow = { id: Id<"signals">; from: string; kind: "offer" | "answer" | "ice"; payload: string };

/**
 * A phone's connection to the host screen: offers a WebRTC connection through Convex
 * signalling, streams controller input on the unreliable "input" channel and receives game
 * events on the reliable "events" channel. Reconnects by itself until disposed.
 */
export class PhoneTransport {
  state: PhoneLinkState = "connecting";

  private pc: RTCPeerConnection | null = null;
  private input: RTCDataChannel | null = null;
  private events: RTCDataChannel | null = null;
  private sid = "";
  private remoteSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private processed = new Set<string>();
  private unwatch: () => void;
  private sender: number;
  private retryTimer = 0;
  private graceTimer = 0;
  private answerTimer = 0;
  private attempts = 0;
  private disposed = false;

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
    this.sender = window.setInterval(() => this.flushInput(), INPUT_SEND_INTERVAL_MS);
    this.connect();
  }

  // ── public API ───────────────────────────────────────────────────────────

  /** Update the controller state; it is sent on the next tick. */
  setInput(x: number, y: number, dash: boolean, brace: boolean): void {
    const l = this.latest;
    if (l.x === x && l.y === y && l.dash === dash && l.brace === brace) return;
    l.x = x;
    l.y = y;
    l.dash = dash;
    l.brace = brace;
    this.dirty = true;
    this.flushInput(); // button presses go out immediately
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unwatch();
    window.clearInterval(this.sender);
    this.clearTimers();
    this.teardown();
    this.stateListeners.clear();
    this.messageListeners.clear();
  }

  // ── connection ───────────────────────────────────────────────────────────

  private connect(): void {
    if (this.disposed) return;
    this.teardown();
    this.clearTimers();
    this.sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.remoteSet = false;
    this.pendingIce = [];

    const pc = new RTCPeerConnection({ iceServers: iceServers() });
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
      this.setState("open");
    };
    events.onclose = () => {
      if (pc === this.pc) this.scheduleReconnect();
    };
    events.onmessage = (m) => this.onHostMessage(m.data);

    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc !== this.pc) return;
        this.signal("offer", { sid, sdp: pc.localDescription!.toJSON() });
        this.answerTimer = window.setTimeout(() => {
          if (pc === this.pc && this.state !== "open") this.scheduleReconnect();
        }, ANSWER_TIMEOUT_MS);
      } catch {
        this.scheduleReconnect();
      }
    })();
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.setState("reconnecting");
    this.teardown();
    window.clearTimeout(this.retryTimer);
    const delay = RETRY_DELAYS_MS[Math.min(this.attempts, RETRY_DELAYS_MS.length - 1)];
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

  private signal(kind: "offer" | "ice", payload: SignalPayload): void {
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

  // ── data ─────────────────────────────────────────────────────────────────

  private flushInput(): void {
    const input = this.input;
    if (!input || input.readyState !== "open") return;
    const now = performance.now();
    if (!this.dirty && now - this.lastSentAt < INPUT_KEEPALIVE_MS) return;
    // Cap the send rate, except for the first packet after a change of buttons.
    if (this.dirty && now - this.lastSentAt < INPUT_SEND_INTERVAL_MS * 0.5) return;
    this.seq = (this.seq + 1) & 0xffff;
    input.send(encodeInput(this.seq, this.latest));
    this.lastSentAt = now;
    this.dirty = false;
  }

  private onHostMessage(data: unknown): void {
    const msg = parseHostMessage(data);
    if (!msg) return;
    if (msg.t === "ping") {
      if (this.events?.readyState === "open") {
        this.events.send(JSON.stringify({ t: "pong", at: msg.at }));
      }
      return;
    }
    for (const l of this.messageListeners) l(msg);
  }

  private setState(state: PhoneLinkState): void {
    if (this.state === state) return;
    this.state = state;
    for (const l of this.stateListeners) l();
  }
}
