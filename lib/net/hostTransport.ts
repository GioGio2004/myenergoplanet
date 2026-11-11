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
  RELAY_ALIVE_MS,
  decodeInput,
  decodeRelayInput,
  iceServers,
  isNewerSeq,
  parsePhoneMessage,
  parseSignal,
  type ControllerInput,
  type HostMessage,
  type LinkMode,
  type SignalPayload,
} from "./protocol";
import { RelaySender, openRelayStream } from "./relayClient";

const PING_INTERVAL_MS = 2_000;
const STATUS_CHECK_MS = 1_000;

/** What the host knows about one phone's live connection. */
export type LinkStatus = {
  state: "none" | "connecting" | "open";
  /** Which path is carrying the controller: a direct WebRTC link or the Wi-Fi relay. */
  mode: LinkMode | null;
  rttMs: number | null;
};

type Peer = {
  sid: string;
  pc: RTCPeerConnection;
  events: RTCDataChannel | null;
  input: RTCDataChannel | null;
  remoteSet: boolean;
  pendingIce: RTCIceCandidateInit[];
  lastSeq: number;
};

type SignalKind = "offer" | "answer" | "ice" | "relay";
type SignalRow = { id: Id<"signals">; from: string; kind: SignalKind; payload: string };

/**
 * The host screen's side of the phone connections. Each phone is reached over a direct
 * WebRTC link when possible, and over the Wi-Fi relay (HTTP through this app's own server)
 * when the network blocks WebRTC. Input from either path feeds the same per-player state;
 * events go out on the direct link when it is open, else on the relay.
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
  private unwatch: () => void;
  private timers: number[] = [];
  private disposed = false;
  private scratch: ControllerInput = { x: 0, y: 0, dash: false, brace: false };

  // Wi-Fi relay
  private relayKeys = new Map<string, string>(); // playerId → key
  private relayPlayers = new Map<string, string>(); // key → playerId
  private relaySeen = new Map<string, number>(); // playerId → last message time
  private relaySeq = new Map<string, number>();
  private closeRelayStream: (() => void) | null = null;
  private relaySender = new RelaySender();

  // Status for the UI
  private rtt = new Map<string, number | null>();
  private statusSnapshot: ReadonlyMap<string, LinkStatus> = new Map();
  private listeners = new Set<() => void>();

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
    this.timers.push(
      window.setInterval(() => this.pingAll(), PING_INTERVAL_MS),
      window.setInterval(() => this.refreshStatus(), STATUS_CHECK_MS),
    );
  }

  // ── public API ───────────────────────────────────────────────────────────

  /** A game input source for this player's phone (neutral until packets arrive). */
  inputSource(playerId: string): InputSource {
    return createRemoteSource(this.inputState(playerId));
  }

  send(playerId: string, message: HostMessage): void {
    const events = this.peers.get(playerId)?.events;
    if (events && events.readyState === "open") {
      events.send(JSON.stringify(message));
      return;
    }
    const key = this.relayKeys.get(playerId);
    if (!key) return;
    // Cooldown updates are snapshots: only the newest one needs to go out.
    const coalesce = message.t === "cd" ? "cd" : null;
    this.relaySender.send(`${key}.down`, JSON.stringify(message), coalesce);
  }

  broadcast(message: HostMessage): void {
    for (const playerId of this.knownPlayers()) this.send(playerId, message);
  }

  /** Close connections of players no longer in the room. */
  prune(activePlayerIds: Iterable<string>): void {
    const keep = new Set(activePlayerIds);
    for (const id of [...this.peers.keys()]) {
      if (!keep.has(id)) this.closePeer(id);
    }
    let relayChanged = false;
    for (const [id, key] of [...this.relayKeys]) {
      if (keep.has(id)) continue;
      this.relayKeys.delete(id);
      this.relayPlayers.delete(key);
      this.relaySeen.delete(id);
      relayChanged = true;
    }
    if (relayChanged) this.restartRelayStream();
    this.refreshStatus(true);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Connection state per player id (a new Map object whenever anything visible changes). */
  getStatuses = (): ReadonlyMap<string, LinkStatus> => this.statusSnapshot;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unwatch();
    for (const t of this.timers) window.clearInterval(t);
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.closeRelayStream?.();
    this.closeRelayStream = null;
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

    if (row.kind === "relay" && payload.key && /^[a-f0-9]{32}$/.test(payload.key)) {
      this.addRelayKey(playerId, payload.key);
      return;
    }
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
    this.refreshStatus(true);

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.signal(playerId, "ice", { sid: peer.sid, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(playerId) === peer) this.refreshStatus(true);
    };
    pc.ondatachannel = (e) => {
      const channel = e.channel;
      if (channel.label === INPUT_CHANNEL) {
        channel.binaryType = "arraybuffer";
        peer.input = channel;
        channel.onmessage = (m) => this.onDirectInput(playerId, peer, m.data);
      } else if (channel.label === EVENTS_CHANNEL) {
        peer.events = channel;
        channel.onopen = () => this.refreshStatus(true);
        channel.onclose = () => this.refreshStatus(true);
        channel.onmessage = (m) => this.onPhoneMessage(playerId, m.data);
        this.refreshStatus(true);
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

  // ── Wi-Fi relay ──────────────────────────────────────────────────────────

  private addRelayKey(playerId: string, key: string): void {
    if (this.relayKeys.get(playerId) === key) return;
    const old = this.relayKeys.get(playerId);
    if (old) this.relayPlayers.delete(old);
    this.relayKeys.set(playerId, key);
    this.relayPlayers.set(key, playerId);
    this.relaySeq.delete(playerId);
    this.restartRelayStream();
    // Say hello right away so the phone learns the relay works.
    this.relaySender.send(`${key}.down`, JSON.stringify({ t: "ping", at: performance.now() }));
  }

  private restartRelayStream(): void {
    this.closeRelayStream?.();
    this.closeRelayStream = null;
    const channels = [...this.relayKeys.values()].map((k) => `${k}.up`);
    if (channels.length === 0 || this.disposed) return;
    this.closeRelayStream = openRelayStream(channels, (channel, data) => {
      const playerId = this.relayPlayers.get(channel.slice(0, 32));
      if (playerId) this.onRelayMessage(playerId, data);
    });
  }

  private onRelayMessage(playerId: string, data: string): void {
    let msg: { t?: unknown };
    try {
      msg = JSON.parse(data) as { t?: unknown };
    } catch {
      return;
    }
    const firstSign = !this.isRelayAlive(playerId);
    this.relaySeen.set(playerId, performance.now());
    if (msg.t === "in") {
      const seq = decodeRelayInput(msg, this.scratch);
      if (seq >= 0 && isNewerSeq(seq, this.relaySeq.get(playerId) ?? -1)) {
        this.relaySeq.set(playerId, seq);
        this.applyInput(playerId);
      }
    } else {
      this.onPhoneMessage(playerId, data);
    }
    if (firstSign) this.refreshStatus(true);
  }

  private isRelayAlive(playerId: string): boolean {
    const seen = this.relaySeen.get(playerId);
    return seen !== undefined && performance.now() - seen < RELAY_ALIVE_MS;
  }

  // ── data ─────────────────────────────────────────────────────────────────

  private onDirectInput(playerId: string, peer: Peer, data: unknown): void {
    if (!(data instanceof ArrayBuffer)) return;
    const seq = decodeInput(data, this.scratch);
    // Unordered channel: drop packets older than one already applied.
    if (seq < 0 || !isNewerSeq(seq, peer.lastSeq)) return;
    peer.lastSeq = seq;
    this.applyInput(playerId);
  }

  private applyInput(playerId: string): void {
    const state = this.inputState(playerId);
    state.x = this.scratch.x;
    state.y = this.scratch.y;
    state.dash = this.scratch.dash;
    state.brace = this.scratch.brace;
    state.receivedAt = performance.now();
  }

  private onPhoneMessage(playerId: string, data: unknown): void {
    const msg = parsePhoneMessage(data);
    if (!msg) return;
    const rtt = Math.max(0, Math.round(performance.now() - msg.at));
    const prev = this.rtt.get(playerId) ?? null;
    this.rtt.set(playerId, rtt);
    if (bucket(prev) !== bucket(rtt)) this.refreshStatus(true);
  }

  private pingAll(): void {
    const at = performance.now();
    for (const playerId of this.knownPlayers()) this.send(playerId, { t: "ping", at });
  }

  private knownPlayers(): Set<string> {
    return new Set([...this.peers.keys(), ...this.relayKeys.keys()]);
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
    this.refreshStatus(true);
  }

  // ── status for the UI ────────────────────────────────────────────────────

  private statusOf(playerId: string): LinkStatus {
    const peer = this.peers.get(playerId);
    const direct = peer?.events?.readyState === "open";
    const relay = this.isRelayAlive(playerId);
    const mode: LinkMode | null = direct ? "direct" : relay ? "relay" : null;
    const connecting =
      !!peer && (peer.pc.connectionState === "new" || peer.pc.connectionState === "connecting");
    return {
      state: mode ? "open" : connecting || this.relayKeys.has(playerId) ? "connecting" : "none",
      mode,
      rttMs: mode ? (this.rtt.get(playerId) ?? null) : null,
    };
  }

  /** Rebuild the snapshot; notify React only when something it shows has changed. */
  private refreshStatus(force = false): void {
    if (this.disposed) return;
    const next = new Map<string, LinkStatus>();
    for (const id of this.knownPlayers()) next.set(id, this.statusOf(id));
    let changed = force || next.size !== this.statusSnapshot.size;
    if (!changed) {
      for (const [id, s] of next) {
        const p = this.statusSnapshot.get(id);
        if (!p || p.state !== s.state || p.mode !== s.mode || bucket(p.rttMs) !== bucket(s.rttMs)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    this.statusSnapshot = next;
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
