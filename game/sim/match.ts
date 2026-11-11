// ─────────────────────────────────────────────────────────────────────────────
// Liquid Sumo — match rules.
//
// Pure logic: no React, no three.js, no Rapier. The physics layer feeds it contacts
// and ring-outs during a fixed step and then calls `step(dt)` exactly once; this
// module owns the phase machine, the clock, scores, respawns, the final-stretch
// crumble, and everything the HUD store shows.
//
// Conventions used throughout:
// - State is mutated first, the HUD is flushed second, events are emitted last, so a
//   listener always sees a consistent runtime + HUD.
// - `runtime.setHud` is only ever called when a HUD value really changed.
// - `step()` allocates nothing unless something actually happens (an event, a HUD change).
// ─────────────────────────────────────────────────────────────────────────────

import { spawnPoint } from "../config";
import type { GameRuntime } from "../runtime";
import type {
  GameEvent,
  HudPlayer,
  HudState,
  MatchController,
  Phase,
  PlayerSlot,
  WrestlerRuntime,
} from "../types";

/**
 * Tolerance for timer comparisons. Fixed steps of 1/60 s do not sum to exact decimals,
 * so "after 3 s" is tested as "after 3 s minus a hair": timers then fire on the same
 * step every run instead of flickering one step early/late with rounding noise.
 */
const EPS = 1e-6;

/** The countdown shows 3, 2, 1 (then 0 = FIGHT once play has begun). */
const COUNTDOWN_BEATS = 3;

/** Extra intro drop height per wrestler index, so they land one after another. */
const INTRO_DROP_STAGGER = 1.5;

/** Respawn points keep at least this distance from the (possibly shrunken) island edge. */
const RESPAWN_EDGE_MARGIN = 1.2;

export function createMatch(runtime: GameRuntime): MatchController {
  const { rules, arena, minPlayers } = runtime.config;
  const crumble = arena.crumble;
  const crumbleSteps: readonly { readonly at: number; readonly radius: number }[] = crumble.steps;

  // ── private match state ───────────────────────────────────────────────────
  /** Countdown number currently on screen (3, 2, 1), or -1 outside the countdown. */
  let countdownShown = -1;
  /** Sim time at which the "FIGHT" banner (hud.countdown = 0) is cleared. */
  let fightBannerClearAt = Infinity;
  /** Sim time at which the current knockout callout is cleared. */
  let calloutClearAt = Infinity;
  /** Monotonic across matches so the HUD can key animations on it. */
  let calloutId = 0;
  /** Index of the next crumble step that has not been warned about yet. */
  let crumbleWarned = 0;
  /** Index of the next warned crumble step whose tiles have not fallen yet. */
  let crumbleDone = 0;
  /** Sim time at which each warned crumble step completes (index = step index). */
  const crumbleDueAt: number[] = crumbleSteps.map(() => Infinity);

  // Scratch output of `chooseRespawnPoint` (avoids returning a fresh object).
  let pickX = 0;
  let pickZ = 0;

  // ── HUD batching ──────────────────────────────────────────────────────────
  // Changes are collected into one patch and pushed with a single `setHud` call,
  // either right before the next event is emitted or when the public method returns.
  let hudPatch: Partial<HudState> | null = null;

  function queueHud<K extends keyof HudState>(key: K, value: HudState[K]): void {
    if (runtime.getHud()[key] === value) {
      // Back to what the HUD already shows: drop any pending change for this key.
      if (hudPatch !== null) delete hudPatch[key];
      return;
    }
    const patch: Partial<HudState> = hudPatch ?? (hudPatch = {});
    patch[key] = value;
  }

  function flushHud(): void {
    if (hudPatch === null) return;
    const patch = hudPatch;
    hudPatch = null;
    if (Object.keys(patch).length > 0) runtime.setHud(patch);
  }

  function emit(event: GameEvent): void {
    flushHud();
    runtime.emit(event);
  }

  /** Rebuild `hud.players` only if a score / inPlay / name / control actually differs. */
  function syncHudPlayers(): void {
    const ws = runtime.wrestlers;
    const shown = hudPatch?.players ?? runtime.getHud().players;
    let same = shown.length === ws.length;
    for (let i = 0; same && i < ws.length; i++) {
      const w = ws[i];
      const p = shown[i];
      same =
        p.slot === w.slot &&
        p.score === w.score &&
        p.inPlay === (w.status === "alive") &&
        p.name === w.name &&
        p.control === w.control;
    }
    if (same) return;
    const players: HudPlayer[] = [];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      players.push({
        slot: w.slot,
        name: w.name,
        control: w.control,
        score: w.score,
        inPlay: w.status === "alive",
      });
    }
    queueHud("players", players);
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function setPhase(next: Phase): void {
    const prev = runtime.phase;
    runtime.phase = next;
    runtime.phaseTime = 0;
    queueHud("phase", next);
    emit({ type: "phase", phase: next, prev });
  }

  function indexOfWrestler(w: WrestlerRuntime): number {
    const ws = runtime.wrestlers;
    for (let i = 0; i < ws.length; i++) if (ws[i] === w) return i;
    return 0;
  }

  /** Radius of the spawn circle that is guaranteed to be on the current island. */
  function safeSpawnRadius(): number {
    // If outer rings are already cracking, treat them as gone.
    const radius =
      crumbleWarned > crumbleDone
        ? Math.min(runtime.arenaRadius, crumbleSteps[crumbleWarned - 1].radius)
        : runtime.arenaRadius;
    return Math.max(0, Math.min(arena.spawnRadius, radius - RESPAWN_EDGE_MARGIN));
  }

  /** `spawnPoint()` coordinates are scaled by this to land on the safe spawn circle. */
  function spawnScale(): number {
    return arena.spawnRadius > 0 ? safeSpawnRadius() / arena.spawnRadius : 0;
  }

  function requestTeleport(w: WrestlerRuntime, x: number, y: number, z: number): void {
    w.teleport = true;
    w.spawnX = x;
    w.spawnY = y;
    w.spawnZ = z;
  }

  /** Drop a wrestler back onto its own spawn point without any scoring. */
  function putBack(w: WrestlerRuntime): void {
    const p = spawnPoint(indexOfWrestler(w), runtime.wrestlers.length);
    const scale = spawnScale();
    w.lastTouchedBy = -1;
    w.lastTouchedAt = -Infinity;
    requestTeleport(w, p.x * scale, arena.respawnDropHeight, p.z * scale);
  }

  /**
   * Pick the spawn point farthest from every wrestler currently in play
   * (maximise the minimum distance). Ties go to the wrestler's own corner.
   * Writes the result to `pickX` / `pickZ`.
   */
  function chooseRespawnPoint(self: WrestlerRuntime, selfIndex: number): void {
    const ws = runtime.wrestlers;
    const count = ws.length;
    const scale = spawnScale();
    let best = -Infinity;
    for (let k = 0; k < count; k++) {
      const candidate = (selfIndex + k) % count;
      const p = spawnPoint(candidate, count);
      const px = p.x * scale;
      const pz = p.z * scale;
      let nearest = Infinity;
      for (let i = 0; i < count; i++) {
        const o = ws[i];
        if (o === self || o.status !== "alive") continue;
        // A wrestler waiting for its teleport is (about to be) at its spawn target;
        // its x/z are stale until the physics layer has moved the body.
        const dx = (o.teleport ? o.spawnX : o.x) - px;
        const dz = (o.teleport ? o.spawnZ : o.z) - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < nearest) nearest = d2;
      }
      // The small margin keeps symmetric candidates from being decided by rounding noise.
      if (k === 0 || nearest > best + 1e-9) {
        best = nearest;
        pickX = px;
        pickZ = pz;
      }
    }
  }

  /** The wrestler with a strictly highest score, or null when the top score is shared. */
  function uniqueLeader(): WrestlerRuntime | null {
    const ws = runtime.wrestlers;
    let leader: WrestlerRuntime | null = null;
    let shared = false;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (leader === null || w.score > leader.score) {
        leader = w;
        shared = false;
      } else if (w.score === leader.score) {
        shared = true;
      }
    }
    return shared ? null : leader;
  }

  function endMatch(winner: PlayerSlot | null): void {
    runtime.winner = winner;
    fightBannerClearAt = Infinity;
    countdownShown = -1;
    queueHud("winner", winner);
    queueHud("countdown", null);
    setPhase("results");
    emit({ type: "matchEnd", winner });
  }

  /** Clock, crumble state, callout and banner back to "fresh match". */
  function resetMatchState(): void {
    runtime.secondsLeft = rules.matchSeconds;
    runtime.arenaRadius = arena.radius;
    runtime.winner = null;
    countdownShown = -1;
    fightBannerClearAt = Infinity;
    calloutClearAt = Infinity;
    crumbleWarned = 0;
    crumbleDone = 0;
    for (let i = 0; i < crumbleDueAt.length; i++) crumbleDueAt[i] = Infinity;

    queueHud("secondsLeft", Math.ceil(rules.matchSeconds));
    queueHud("countdown", null);
    queueHud("callout", null);
    queueHud("winner", null);
    queueHud("finalStretch", false);
  }

  // ── phase steps ───────────────────────────────────────────────────────────
  function stepCountdown(): void {
    const beatsElapsed = Math.floor((runtime.phaseTime + EPS) / rules.countdownBeatSeconds);
    if (beatsElapsed >= COUNTDOWN_BEATS) {
      // Play begins; "FIGHT" (0) stays up for a moment on top of live play.
      countdownShown = -1;
      fightBannerClearAt = runtime.simTime + rules.fightBannerSeconds;
      queueHud("countdown", 0);
      setPhase("playing");
      emit({ type: "countdown", n: 0 });
      return;
    }
    const n = COUNTDOWN_BEATS - beatsElapsed;
    if (n !== countdownShown) {
      countdownShown = n;
      queueHud("countdown", n);
      emit({ type: "countdown", n });
    }
  }

  function stepClock(dt: number): void {
    const left = runtime.secondsLeft - dt;
    runtime.secondsLeft = left > EPS ? left : 0;
    // The epsilon keeps 179.0000000001 from still reading as 180.
    queueHud("secondsLeft", Math.max(0, Math.ceil(runtime.secondsLeft - EPS)));

    // Final stretch: warn about each shrink the first time the clock reaches it.
    while (
      crumbleWarned < crumbleSteps.length &&
      runtime.secondsLeft <= crumbleSteps[crumbleWarned].at + EPS
    ) {
      const radius = crumbleSteps[crumbleWarned].radius;
      crumbleDueAt[crumbleWarned] = runtime.simTime + crumble.warnSeconds;
      crumbleWarned++;
      queueHud("finalStretch", true);
      emit({ type: "crumbleWarn", radius, seconds: crumble.warnSeconds });
    }
  }

  /** Warned rings fall once their warning time is up (also during sudden death). */
  function stepCrumble(): void {
    while (crumbleDone < crumbleWarned && runtime.simTime >= crumbleDueAt[crumbleDone] - EPS) {
      const radius = Math.min(runtime.arenaRadius, crumbleSteps[crumbleDone].radius);
      crumbleDone++;
      runtime.arenaRadius = radius;
      emit({ type: "crumble", radius });
    }
  }

  function stepRespawns(): void {
    const ws = runtime.wrestlers;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (w.status !== "out" || runtime.simTime < w.respawnAt - EPS) continue;
      chooseRespawnPoint(w, i);
      w.status = "alive";
      w.invulnerableUntil = runtime.simTime + rules.invulnerableSeconds;
      w.lastTouchedBy = -1;
      w.lastTouchedAt = -Infinity;
      requestTeleport(w, pickX, arena.respawnDropHeight, pickZ);
      syncHudPlayers();
      emit({ type: "respawn", slot: w.slot, x: pickX, z: pickZ });
    }
  }

  function knockOut(victim: WrestlerRuntime): void {
    const touchedBy = victim.lastTouchedBy;
    const candidate =
      touchedBy >= 0 && touchedBy !== victim.slot ? runtime.wrestler(touchedBy) : undefined;
    const attacker =
      candidate !== undefined &&
      runtime.simTime - victim.lastTouchedAt <= rules.attributionSeconds + EPS
        ? candidate
        : null;

    // Where they went out, captured before anything else can move them.
    const x = victim.x;
    const y = victim.y;
    const z = victim.z;

    const scorer = attacker ?? victim;
    const before = scorer.score;
    scorer.score = attacker
      ? before + 1
      : Math.max(0, before - rules.selfKnockoutPenalty);
    const delta = scorer.score - before;

    victim.status = "out";
    victim.respawnAt = runtime.simTime + rules.respawnSeconds;
    victim.lastTouchedBy = -1;
    victim.lastTouchedAt = -Infinity;

    calloutId++;
    calloutClearAt = runtime.simTime + rules.calloutSeconds;
    queueHud("callout", {
      id: calloutId,
      victim: victim.slot,
      by: attacker ? attacker.slot : null,
      text: attacker
        ? `${attacker.name} knocked out ${victim.name}!`
        : `${victim.name} fell off!`,
    });
    syncHudPlayers();

    emit({ type: "knockout", victim: victim.slot, by: attacker ? attacker.slot : null, x, y, z });
    if (delta !== 0) emit({ type: "score", slot: scorer.slot, score: scorer.score, delta });

    // A listener may have changed the phase (e.g. back to the lobby): re-check before deciding.
    if (runtime.phase === "playing") {
      const ws = runtime.wrestlers;
      let winner: WrestlerRuntime | null = null;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        if (w.score >= rules.pointsToWin && (winner === null || w.score > winner.score)) winner = w;
      }
      if (winner !== null) endMatch(winner.slot);
    } else if (runtime.phase === "suddenDeath") {
      // Next decisive knockout wins: as soon as someone leads alone, it is over.
      const leader = uniqueLeader();
      if (leader !== null) endMatch(leader.slot);
    }
  }

  // ── public API ────────────────────────────────────────────────────────────
  function start(): boolean {
    if (runtime.phase !== "lobby" && runtime.phase !== "results") return false;
    const ws = runtime.wrestlers;
    const count = ws.length;
    if (count < minPlayers) return false;

    resetMatchState();
    for (let i = 0; i < count; i++) {
      const w = ws[i];
      const p = spawnPoint(i, count);
      w.status = "alive";
      w.score = 0;
      w.invulnerableUntil = 0;
      w.lastTouchedBy = -1;
      w.lastTouchedAt = -Infinity;
      w.respawnAt = 0;
      requestTeleport(w, p.x, arena.introDropHeight + i * INTRO_DROP_STAGGER, p.z);
    }
    syncHudPlayers();
    setPhase("intro");
    flushHud();
    return true;
  }

  function rematch(): void {
    if (runtime.phase !== "results") return;
    start();
  }

  function toLobby(): void {
    resetMatchState();
    const ws = runtime.wrestlers;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      w.status = "idle";
      w.score = 0;
      w.invulnerableUntil = 0;
      w.lastTouchedBy = -1;
      w.lastTouchedAt = -Infinity;
      w.respawnAt = 0;
      // Parking idle bodies is the physics layer's job; drop any stale spawn request.
      w.teleport = false;
    }
    syncHudPlayers();
    if (runtime.phase === "lobby") {
      // Already there: nothing to announce, just restart the phase timer.
      runtime.phaseTime = 0;
    } else {
      setPhase("lobby");
    }
    flushHud();
  }

  function step(dt: number): void {
    runtime.simTime += dt;
    runtime.phaseTime += dt;

    switch (runtime.phase) {
      case "intro":
        if (runtime.phaseTime >= rules.introSeconds - EPS) {
          // Beat 3 starts the moment the countdown does.
          countdownShown = COUNTDOWN_BEATS;
          queueHud("countdown", COUNTDOWN_BEATS);
          setPhase("countdown");
          emit({ type: "countdown", n: COUNTDOWN_BEATS });
        }
        break;

      case "countdown":
        stepCountdown();
        break;

      case "playing":
        stepClock(dt);
        stepCrumble();
        if (runtime.phase === "playing" && runtime.secondsLeft <= 0) {
          const leader = uniqueLeader();
          if (leader !== null) {
            endMatch(leader.slot);
          } else {
            setPhase("suddenDeath");
            emit({ type: "suddenDeath" });
          }
        }
        break;

      case "suddenDeath":
        stepCrumble();
        break;

      default:
        break;
    }

    // Re-read the phase: the block above may have ended the match.
    if (runtime.phase === "playing" || runtime.phase === "suddenDeath") {
      if (runtime.simTime >= fightBannerClearAt - EPS) {
        fightBannerClearAt = Infinity;
        queueHud("countdown", null);
      }
      stepRespawns();
    }

    if (runtime.simTime >= calloutClearAt - EPS) {
      calloutClearAt = Infinity;
      queueHud("callout", null);
    }

    flushHud();
  }

  function reportContact(a: PlayerSlot, b: PlayerSlot): void {
    if (a === b) return;
    const wa = runtime.wrestler(a);
    const wb = runtime.wrestler(b);
    if (wa === undefined || wb === undefined) return;
    if (wa.status !== "alive" || wb.status !== "alive") return;
    // A body that has not been moved to its spawn point yet is not really "there".
    if (wa.teleport || wb.teleport) return;
    if (runtime.isInvulnerable(wa) || runtime.isInvulnerable(wb)) return;
    wa.lastTouchedBy = b;
    wa.lastTouchedAt = runtime.simTime;
    wb.lastTouchedBy = a;
    wb.lastTouchedAt = runtime.simTime;
  }

  function reportRingOut(slot: PlayerSlot): void {
    const w = runtime.wrestler(slot);
    if (w === undefined || w.status !== "alive") return;
    // A pending teleport means the reported position is stale (the body is still parked
    // or still below the kill plane); it is about to be placed, so there is nothing to do.
    if (w.teleport) return;

    if (runtime.phase === "playing" || runtime.phase === "suddenDeath") {
      knockOut(w);
    } else {
      // Bounced off during the drop-in, or wandered off on the results screen: no scoring.
      putBack(w);
    }
    flushHud();
  }

  function canControl(slot: PlayerSlot): boolean {
    if (runtime.phase !== "playing" && runtime.phase !== "suddenDeath") return false;
    const w = runtime.wrestler(slot);
    return w !== undefined && w.status === "alive";
  }

  return { start, rematch, toLobby, step, reportContact, reportRingOut, canControl };
}
