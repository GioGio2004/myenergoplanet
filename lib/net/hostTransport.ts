"use client";

import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  createRemoteInputState,
  createRemoteSource,
  type RemoteInputState,
} from "@/game/input/remote";
import type { InputSource } from "@/game/types";
import type { HostRoom } from "@/lib/sessions";
import {
  EVENTS_CHANNEL,
  INPUT_CHANNEL,
  decodeInput,
  iceServers,
  isNewerSeq,
  parsePhoneMessage,
  parseSignal,
  type ControllerInput,
  type HostMessage,
  type SignalPayload,
} from "./protocol";

const PING_INTERVAL_MS = 2_000;

/** What the host knows about one phone's live connection. */
export type LinkStatus = { state: "none" | "connecting" | "open"; rttMs: number | null };

type Peer = {
  sid: string;
  pc: RTCPeerConnection;
  events: RTCDataChannel | null;
  input: RTCDataChannel | null;
  remoteSet: boolean;
  pendingIce: RTCIceCandidateInit[];
  lastSeq: number;
};

type SignalRow = { id: Id<"signals">; from: string; kind: "offer" | "answer" | "ice"; payload: string };

/**
 * The host screen's side of the phone connections: answers each phone's WebRTC offer,
 * turns "input" packets into per-player input state, and sends game events back.
 *
 * One instance per open room, kept at module level so connections survive the client-side
 * navigation between the landing page and /arena.
 */
export class HostTransport {
  private static current: HostTransport | null = null;

  /** The transport for this room (created on first use, replacing one for another room). */
  static for(client: ConvexReactClient, room: HostRoom): HostTransport {
    const cur = HostTransport.current;
    if (cur && cur.room.code === room.code && cur.room.hostSecret === room.hostSecret) return cur;
    cur?.dispose();
    HostTransport.current = new HostTransport(client, room);
    return HostTransport.current;
  }

  /** Tear down the current transport (room closed). */
  static closeCurrent(): void {
    HostTransport.current?.dispose();
    HostTransport.current = null;
  }

  private peers = new Map<string, Peer>();
  private inputs = new Map<string, RemoteInputState>();
  private processed = new Set<string>();
  private chains = new Map<string, Promise<void>>();
  private statuses = new Map<string, LinkStatus>();
  private statusSnapshot: ReadonlyMap<string, LinkStatus> = new Map();
  private listeners = new Set<() => void>();
  private unwatch: () => void;
  private pinger: number;
  private disposed = false;
  private scratch: ControllerInput = { x: 0, y: 0, dash: false, brace: false };

  private constructor(
    private client: ConvexReactClient,
    readonly room: HostRoom,
  ) {
    const watch = client.watchQuery(api.signals.listForPeer, {
      code: room.code,
      auth: { hostSecret: room.hostSecret },
    });
    const onUpdate = () => this.onSignals(watch.localQueryResult() ?? []);
    this.unwatch = watch.onUpdate(onUpdate);
    onUpdate();
    this.pinger = window.setInterval(() => this.broadcast({ t: "ping", at: performance.now() }), PING_INTERVAL_MS);
  }

  // ── public API ───────────────────────────────────────────────────────────

  /** A game input source for this player's phone (neutral until packets arrive). */
  inputSource(playerId: string): InputSource {
    return createRemoteSource(this.inputState(playerId));
  }

  send(playerId: string, message: HostMessage): void {
    const events = this.peers.get(playerId)?.events;
    if (events && events.readyState === "open") events.send(JSON.stringify(message));
  }

  broadcast(message: HostMessage): void {
    const text = JSON.stringify(message);
    for (const peer of this.peers.values()) {
      if (peer.events?.readyState === "open") peer.events.send(text);
    }
  }

  /** Close connections of players no longer in the room. */
  prune(activePlayerIds: Iterable<string>): void {
    const keep = new Set(activePlayerIds);
    for (const id of [...this.peers.keys()]) {
      if (!keep.has(id)) this.closePeer(id);
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Connection state per player id (a new Map object whenever anything changes). */
  getStatuses = (): ReadonlyMap<string, LinkStatus> => this.statusSnapshot;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unwatch();
    window.clearInterval(this.pinger);
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.listeners.clear();
  }

  // ── signalling ───────────────────────────────────────────────────────────

  private onSignals(rows: SignalRow[]): void {
    if (this.disposed) return;
    const fresh = rows.filter((r) => !this.processed.has(r.id));
    if (fresh.length === 0) return;
    for (const row of fresh) {
      this.processed.add(row.id);
      // Handle each phone's signals strictly in order (offer before its ICE candidates).
      const prev = this.chains.get(row.from) ?? Promise.resolve();
      const next = prev.then(() => this.handleSignal(row)).catch(() => {});
      this.chains.set(row.from, next);
    }
    void this.client
      .mutation(api.signals.consume, {
        code: this.room.code,
        auth: { hostSecret: this.room.hostSecret },
        ids: fresh.map((r) => r.id),
      })
      .catch(() => {});
  }

  private async handleSignal(row: SignalRow): Promise<void> {
    if (this.disposed) return;
    const payload = parseSignal(row.payload);
    if (!payload) return;
    const playerId = row.from;

    if (row.kind === "offer" && payload.sdp) {
      await this.acceptOffer(playerId, payload);
      return;
    }
    if (row.kind === "ice" && payload.candidate) {
      const peer = this.peers.get(playerId);
      if (!peer || peer.sid !== payload.sid) return; // from an older attempt
      if (peer.remoteSet) await peer.pc.addIceCandidate(payload.candidate).catch(() => {});
      else peer.pendingIce.push(payload.candidate);
    }
  }

  private async acceptOffer(playerId: string, offer: SignalPayload): Promise<void> {
    // A new offer from the same phone replaces its old connection (reconnect).
    this.closePeer(playerId);
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const peer: Peer = {
      sid: offer.sid,
      pc,
      events: null,
      input: null,
      remoteSet: false,
      pendingIce: [],
      lastSeq: -1,
    };
    this.peers.set(playerId, peer);
    this.setStatus(playerId, { state: "connecting", rttMs: null });

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.signal(playerId, "ice", { sid: peer.sid, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(playerId) !== peer) return;
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.setStatus(playerId, { state: "none", rttMs: null });
      }
    };
    pc.ondatachannel = (e) => {
      const channel = e.channel;
      if (channel.label === INPUT_CHANNEL) {
        channel.binaryType = "arraybuffer";
        peer.input = channel;
        channel.onmessage = (m) => this.onInput(playerId, peer, m.data);
      } else if (channel.label === EVENTS_CHANNEL) {
        peer.events = channel;
        channel.onopen = () => this.setStatus(playerId, { state: "open", rttMs: null });
        channel.onclose = () => {
          if (this.peers.get(playerId) === peer) this.setStatus(playerId, { state: "none", rttMs: null });
        };
        channel.onmessage = (m) => this.onEvent(playerId, m.data);
        if (channel.readyState === "open") this.setStatus(playerId, { state: "open", rttMs: null });
      }
    };

    await pc.setRemoteDescription(offer.sdp!);
    peer.remoteSet = true;
    for (const candidate of peer.pendingIce.splice(0)) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signal(playerId, "answer", { sid: peer.sid, sdp: pc.localDescription!.toJSON() });
  }

  private signal(to: string, kind: "answer" | "ice", payload: SignalPayload): void {
    if (this.disposed) return;
    void this.client
      .mutation(api.signals.send, {
        code: this.room.code,
        auth: { hostSecret: this.room.hostSecret },
        to,
        kind,
        payload: JSON.stringify(payload),
      })
      .catch(() => {});
  }

  // ── data ─────────────────────────────────────────────────────────────────

  private onInput(playerId: string, peer: Peer, data: unknown): void {
    if (!(data instanceof ArrayBuffer)) return;
    const seq = decodeInput(data, this.scratch);
    // Unordered channel: drop packets older than one already applied.
    if (seq < 0 || !isNewerSeq(seq, peer.lastSeq)) return;
    peer.lastSeq = seq;
    const state = this.inputState(playerId);
    state.x = this.scratch.x;
    state.y = this.scratch.y;
    state.dash = this.scratch.dash;
    state.brace = this.scratch.brace;
    state.receivedAt = performance.now();
  }

  private onEvent(playerId: string, data: unknown): void {
    const msg = parsePhoneMessage(data);
    if (!msg) return;
    const rtt = Math.max(0, Math.round(performance.now() - msg.at));
    const prev = this.statuses.get(playerId);
    // Only notify when the bucket shown in the UI would change.
    if (!prev || prev.state !== "open" || bucket(prev.rttMs) !== bucket(rtt)) {
      this.setStatus(playerId, { state: "open", rttMs: rtt });
    } else {
      prev.rttMs = rtt;
    }
  }

  private inputState(playerId: string): RemoteInputState {
    let state = this.inputs.get(playerId);
    if (!state) {
      state = createRemoteInputState();
      this.inputs.set(playerId, state);
    }
    return state;
  }

  private closePeer(playerId: string): void {
    const peer = this.peers.get(playerId);
    if (!peer) return;
    this.peers.delete(playerId);
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.ondatachannel = null;
    peer.pc.close();
    const input = this.inputs.get(playerId);
    if (input) input.receivedAt = 0;
    this.setStatus(playerId, { state: "none", rttMs: null });
  }

  private setStatus(playerId: string, status: LinkStatus): void {
    this.statuses.set(playerId, status);
    this.statusSnapshot = new Map(
      [...this.statuses].map(([id, s]) => [id, { state: s.state, rttMs: s.rttMs }]),
    );
    for (const l of this.listeners) l();
  }
}

/** Latency buckets used for the coloured connection dot. */
export function bucket(rttMs: number | null): "good" | "ok" | "poor" | "unknown" {
  if (rttMs === null) return "unknown";
  if (rttMs < 80) return "good";
  if (rttMs < 200) return "ok";
  return "poor";
}
