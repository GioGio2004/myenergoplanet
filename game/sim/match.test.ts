import { describe, expect, it, vi } from "vitest";
import { gameConfig, spawnPoint, type GameConfig } from "../config";
import { GameRuntime } from "../runtime";
import type {
  GameEvent,
  GameEventOf,
  GameEventType,
  PlayerSetup,
  PlayerSlot,
  WrestlerRuntime,
} from "../types";
import { createMatch } from "./match";

const { rules, arena } = gameConfig;
const HZ = gameConfig.sim.hz;
const DT = 1 / HZ;

/** Whole fixed steps in `seconds`. */
const stepsFor = (seconds: number): number => Math.round(seconds * HZ);

const PLAYERS: PlayerSetup[] = [
  { slot: 0, name: "Aka", control: "keyboardA" },
  { slot: 1, name: "Ao", control: "keyboardB" },
  { slot: 2, name: "Shiro", control: "bot" },
  { slot: 3, name: "Kin", control: "bot" },
];

type ConfigOverrides = {
  rules?: Partial<Record<keyof GameConfig["rules"], number>>;
  crumble?: { warnSeconds: number; steps: { at: number; radius: number }[] };
};

/**
 * A runtime + match + recorded events, plus a `tick` that plays the part of the physics
 * layer: one fixed step of rules, then perform (and clear) any teleport requests.
 */
function setup(count = 2, overrides?: ConfigOverrides) {
  const runtime = new GameRuntime();
  if (overrides) {
    const config = {
      ...gameConfig,
      rules: { ...gameConfig.rules, ...overrides.rules },
      arena: { ...gameConfig.arena, crumble: overrides.crumble ?? gameConfig.arena.crumble },
    } as unknown as GameConfig;
    Object.defineProperty(runtime, "config", { value: config });
  }
  runtime.setPlayers(PLAYERS.slice(0, count));
  const match = createMatch(runtime);

  const events: GameEvent[] = [];
  runtime.onAny((e) => events.push(e));

  const tick = (): void => {
    match.step(DT);
    for (const w of runtime.wrestlers) {
      if (!w.teleport) continue;
      w.x = w.spawnX;
      w.y = w.spawnY;
      w.z = w.spawnZ;
      w.teleport = false;
    }
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) tick();
  };
  const seconds = (s: number): void => steps(stepsFor(s));

  /** Step until `done()` holds; returns how many steps that took. */
  const stepsUntil = (done: () => boolean, limit = 100_000): number => {
    let n = 0;
    while (!done()) {
      tick();
      if (++n > limit) throw new Error("stepsUntil: limit reached");
    }
    return n;
  };

  /** start() and run the intro + countdown; returns right after the step that began play. */
  const toPlaying = (): void => {
    expect(match.start()).toBe(true);
    stepsUntil(() => runtime.phase === "playing");
  };

  const w = (slot: number): WrestlerRuntime => {
    const found = runtime.wrestler(slot);
    if (!found) throw new Error(`no wrestler in slot ${slot}`);
    return found;
  };

  const ofType = <T extends GameEventType>(type: T): GameEventOf<T>[] =>
    events.filter((e): e is GameEventOf<T> => e.type === type);

  /** `by` touches `victim`, who then drops below the kill plane. Omit `by` for a self knockout. */
  const knockOut = (victim: PlayerSlot, by?: PlayerSlot): void => {
    if (by !== undefined) match.reportContact(by, victim);
    match.reportRingOut(victim);
  };

  /** Long enough for a knocked-out wrestler to be back and vulnerable again. */
  const waitForRecovery = (): void => {
    seconds(runtime.config.rules.respawnSeconds + runtime.config.rules.invulnerableSeconds + 0.1);
  };

  return {
    runtime,
    match,
    events,
    tick,
    steps,
    seconds,
    stepsUntil,
    toPlaying,
    w,
    ofType,
    knockOut,
    waitForRecovery,
    hud: () => runtime.getHud(),
  };
}

describe("start", () => {
  it("refuses to start with fewer than minPlayers wrestlers", () => {
    for (const count of [0, 1]) {
      const g = setup(count);
      const setHud = vi.spyOn(g.runtime, "setHud");
      expect(count).toBeLessThan(gameConfig.minPlayers);
      expect(g.match.start()).toBe(false);
      expect(g.runtime.phase).toBe("lobby");
      expect(g.events).toEqual([]);
      expect(setHud).not.toHaveBeenCalled();
    }
  });

  it("starts with minPlayers and only from lobby or results", () => {
    const g = setup(gameConfig.minPlayers);
    expect(g.match.start()).toBe(true);
    expect(g.runtime.phase).toBe("intro");
    // Already running: a second start is rejected and changes nothing.
    g.steps(10);
    const before = g.events.length;
    expect(g.match.start()).toBe(false);
    expect(g.runtime.phase).toBe("intro");
    expect(g.events.length).toBe(before);
  });

  it("resets the match state and requests a staggered drop-in for everyone", () => {
    const g = setup(4);
    // Dirty state that start() must clean up.
    g.runtime.arenaRadius = 3;
    g.runtime.secondsLeft = 12;
    g.runtime.winner = 2;
    for (const w of g.runtime.wrestlers) {
      w.score = 3;
      w.lastTouchedBy = 1;
      w.invulnerableUntil = 99;
    }
    const setHud = vi.spyOn(g.runtime, "setHud");

    expect(g.match.start()).toBe(true);

    expect(g.runtime.phase).toBe("intro");
    expect(g.runtime.phaseTime).toBe(0);
    expect(g.runtime.secondsLeft).toBe(rules.matchSeconds);
    expect(g.runtime.arenaRadius).toBe(arena.radius);
    expect(g.runtime.winner).toBeNull();
    g.runtime.wrestlers.forEach((w, index) => {
      const p = spawnPoint(index, 4);
      expect(w.status).toBe("alive");
      expect(w.score).toBe(0);
      expect(w.lastTouchedBy).toBe(-1);
      expect(w.invulnerableUntil).toBe(0);
      expect(w.teleport).toBe(true);
      expect(w.spawnX).toBeCloseTo(p.x);
      expect(w.spawnZ).toBeCloseTo(p.z);
      expect(w.spawnY).toBeCloseTo(arena.introDropHeight + index * 1.5);
    });

    // One HUD update for the whole reset, and the phase event after it.
    expect(setHud).toHaveBeenCalledTimes(1);
    expect(g.hud()).toMatchObject({
      phase: "intro",
      secondsLeft: rules.matchSeconds,
      countdown: null,
      callout: null,
      winner: null,
      finalStretch: false,
    });
    expect(g.hud().players.map((p) => [p.slot, p.name, p.score, p.inPlay])).toEqual([
      [0, "Aka", 0, true],
      [1, "Ao", 0, true],
      [2, "Shiro", 0, true],
      [3, "Kin", 0, true],
    ]);
    expect(g.events).toEqual([{ type: "phase", phase: "intro", prev: "lobby" }]);
  });
});

describe("phase flow", () => {
  it("runs intro → countdown 3, 2, 1 → playing with exact timings", () => {
    const g = setup(2);
    const introSteps = stepsFor(rules.introSeconds);
    const beatSteps = stepsFor(rules.countdownBeatSeconds);
    const bannerSteps = stepsFor(rules.fightBannerSeconds);
    g.match.start();

    g.steps(introSteps - 1);
    expect(g.runtime.phase).toBe("intro");
    expect(g.hud().countdown).toBeNull();
    g.steps(1);
    expect(g.runtime.phase).toBe("countdown");
    expect(g.runtime.phaseTime).toBe(0);
    expect(g.hud().phase).toBe("countdown");
    expect(g.hud().countdown).toBe(3);

    g.steps(beatSteps - 1);
    expect(g.hud().countdown).toBe(3);
    g.steps(1);
    expect(g.hud().countdown).toBe(2);

    g.steps(beatSteps - 1);
    expect(g.hud().countdown).toBe(2);
    g.steps(1);
    expect(g.hud().countdown).toBe(1);

    g.steps(beatSteps - 1);
    expect(g.runtime.phase).toBe("countdown");
    expect(g.hud().countdown).toBe(1);
    g.steps(1);
    expect(g.runtime.phase).toBe("playing");
    expect(g.hud().phase).toBe("playing");
    expect(g.hud().countdown).toBe(0); // FIGHT
    // The clock has not started ticking before play.
    expect(g.runtime.secondsLeft).toBe(rules.matchSeconds);

    g.steps(bannerSteps - 1);
    expect(g.hud().countdown).toBe(0);
    g.steps(1);
    expect(g.hud().countdown).toBeNull();
    expect(g.runtime.phase).toBe("playing");
  });

  it("emits phase and countdown events in order", () => {
    const g = setup(2);
    g.toPlaying();
    expect(g.events).toEqual([
      { type: "phase", phase: "intro", prev: "lobby" },
      { type: "phase", phase: "countdown", prev: "intro" },
      { type: "countdown", n: 3 },
      { type: "countdown", n: 2 },
      { type: "countdown", n: 1 },
      { type: "phase", phase: "playing", prev: "countdown" },
      { type: "countdown", n: 0 },
    ]);
  });

  it("shows the HUD the new state by the time an event fires", () => {
    const g = setup(2);
    const seen: (number | null)[] = [];
    g.runtime.on("countdown", () => seen.push(g.hud().countdown));
    g.toPlaying();
    expect(seen).toEqual([3, 2, 1, 0]);
  });

  it("advances simTime and phaseTime every step, in every phase", () => {
    const g = setup(2);
    g.steps(30); // lobby
    expect(g.runtime.simTime).toBeCloseTo(0.5);
    expect(g.runtime.phaseTime).toBeCloseTo(0.5);
    g.match.start();
    expect(g.runtime.phaseTime).toBe(0);
    g.steps(60);
    expect(g.runtime.simTime).toBeCloseTo(1.5);
    expect(g.runtime.phaseTime).toBeCloseTo(1);
  });

  it("counts the clock down in whole HUD seconds while playing", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(HZ - 1);
    expect(g.hud().secondsLeft).toBe(rules.matchSeconds);
    g.steps(1);
    expect(g.hud().secondsLeft).toBe(rules.matchSeconds - 1);
    expect(g.runtime.secondsLeft).toBeCloseTo(rules.matchSeconds - 1);
    g.steps(HZ * 9);
    expect(g.hud().secondsLeft).toBe(rules.matchSeconds - 10);
  });
});

describe("HUD updates", () => {
  it("does not call setHud on steps where nothing changed", () => {
    const g = setup(2);
    const setHud = vi.spyOn(g.runtime, "setHud");

    g.steps(120); // lobby: nothing ever changes
    expect(setHud).not.toHaveBeenCalled();

    g.match.start();
    setHud.mockClear();
    g.steps(stepsFor(rules.introSeconds) - 1); // intro: silent until the countdown
    expect(setHud).not.toHaveBeenCalled();

    g.stepsUntil(() => g.runtime.phase === "playing");
    // Get past the FIGHT banner and onto a whole-second boundary.
    g.steps(2 * HZ);
    setHud.mockClear();

    g.steps(HZ - 1);
    expect(setHud).not.toHaveBeenCalled();
    g.steps(1);
    expect(setHud).toHaveBeenCalledTimes(1);
    expect(setHud).toHaveBeenLastCalledWith({ secondsLeft: rules.matchSeconds - 3 });

    // Ten more seconds: exactly one update per second.
    setHud.mockClear();
    g.steps(10 * HZ);
    expect(setHud).toHaveBeenCalledTimes(10);
  });

  it("replaces HUD objects instead of mutating them", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    const before = g.hud();
    const playersBefore = before.players;
    g.knockOut(1, 0);
    expect(g.hud()).not.toBe(before);
    expect(g.hud().players).not.toBe(playersBefore);
    expect(playersBefore[0].score).toBe(0);
    expect(playersBefore[1].inPlay).toBe(true);
    expect(g.hud().players[0].score).toBe(1);
    expect(g.hud().players[1].inPlay).toBe(false);
  });

  it("clears the knockout callout after calloutSeconds and numbers callouts", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    const first = g.hud().callout;
    expect(first).toMatchObject({ victim: 1, by: 0, text: "Aka knocked out Ao!" });

    g.steps(stepsFor(rules.calloutSeconds) - 1);
    expect(g.hud().callout).toBe(first);
    g.steps(1);
    expect(g.hud().callout).toBeNull();

    g.waitForRecovery();
    g.knockOut(0);
    const second = g.hud().callout;
    expect(second).toMatchObject({ victim: 0, by: null, text: "Aka fell off!" });
    expect(second?.id).toBe((first?.id ?? 0) + 1);
  });
});

describe("knockouts", () => {
  it("credits the last toucher inside the attribution window", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.match.reportContact(0, 1);
    expect(g.w(1).lastTouchedBy).toBe(0);
    expect(g.w(0).lastTouchedBy).toBe(1);
    expect(g.w(1).lastTouchedAt).toBe(g.runtime.simTime);
    expect(g.w(0).lastTouchedAt).toBe(g.runtime.simTime);

    g.seconds(1);
    const victim = g.w(1);
    victim.x = 7;
    victim.y = -2.1;
    victim.z = -1;
    g.events.length = 0;
    const koTime = g.runtime.simTime;
    g.match.reportRingOut(1);

    expect(g.w(0).score).toBe(1);
    expect(victim.score).toBe(0);
    expect(victim.status).toBe("out");
    expect(victim.lastTouchedBy).toBe(-1);
    expect(victim.respawnAt).toBeCloseTo(koTime + rules.respawnSeconds);
    expect(g.events).toEqual([
      { type: "knockout", victim: 1, by: 0, x: 7, y: -2.1, z: -1 },
      { type: "score", slot: 0, score: 1, delta: 1 },
    ]);
    expect(g.hud().players.map((p) => [p.score, p.inPlay])).toEqual([
      [1, true],
      [0, false],
    ]);
    expect(g.hud().callout).toMatchObject({ victim: 1, by: 0, text: "Aka knocked out Ao!" });
  });

  it("still credits a touch exactly attributionSeconds old, but not an older one", () => {
    const window = stepsFor(rules.attributionSeconds);

    const inside = setup(2);
    inside.toPlaying();
    inside.steps(10);
    inside.match.reportContact(1, 0);
    inside.steps(window);
    inside.match.reportRingOut(0);
    expect(inside.w(1).score).toBe(1);
    expect(inside.ofType("knockout")).toEqual([expect.objectContaining({ victim: 0, by: 1 })]);

    const outside = setup(2);
    outside.toPlaying();
    outside.steps(10);
    outside.match.reportContact(1, 0);
    outside.steps(window + 1);
    outside.match.reportRingOut(0);
    expect(outside.w(1).score).toBe(0);
    expect(outside.ofType("knockout")).toEqual([expect.objectContaining({ victim: 0, by: null })]);
    expect(outside.hud().callout?.text).toBe("Aka fell off!");
  });

  it("never drops a score below zero on a self knockout", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.events.length = 0;
    g.knockOut(0);
    expect(g.w(0).score).toBe(0);
    expect(g.w(0).status).toBe("out");
    expect(g.ofType("knockout")).toEqual([expect.objectContaining({ victim: 0, by: null })]);
    // The score did not change, so there is no score event.
    expect(g.ofType("score")).toEqual([]);
  });

  it("takes selfKnockoutPenalty off a positive score and reports the real delta", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    g.waitForRecovery();
    g.knockOut(1, 0);
    g.waitForRecovery();
    expect(g.w(0).score).toBe(2);

    // Well past the attribution window of the last touch.
    g.seconds(rules.attributionSeconds + 0.5);
    g.events.length = 0;
    g.knockOut(0);
    expect(g.w(0).score).toBe(2 - rules.selfKnockoutPenalty);
    expect(g.w(1).score).toBe(0);
    expect(g.events).toEqual([
      expect.objectContaining({ type: "knockout", victim: 0, by: null }),
      {
        type: "score",
        slot: 0,
        score: 2 - rules.selfKnockoutPenalty,
        delta: -rules.selfKnockoutPenalty,
      },
    ]);
    expect(g.hud().players[0].score).toBe(2 - rules.selfKnockoutPenalty);
  });

  it("treats a toucher that no longer exists as a self knockout", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.w(0).lastTouchedBy = 3; // nobody sits in slot 3
    g.w(0).lastTouchedAt = g.runtime.simTime;
    g.knockOut(0);
    expect(g.ofType("knockout")).toEqual([expect.objectContaining({ victim: 0, by: null })]);
    expect(g.w(1).score).toBe(0);
  });

  it("still credits an attacker who has been knocked out in the meantime", () => {
    const g = setup(3);
    g.toPlaying();
    g.steps(10);
    g.match.reportContact(0, 1);
    g.knockOut(0, 2); // slot 0 goes out first, credited to slot 2
    g.steps(5);
    g.match.reportRingOut(1); // slot 1 follows, last touched by slot 0
    expect(g.w(0).score).toBe(1);
    expect(g.w(2).score).toBe(1);
  });

  it("ignores ring-outs for wrestlers that are not alive or do not exist", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    g.events.length = 0;
    const setHud = vi.spyOn(g.runtime, "setHud");
    g.match.reportRingOut(1); // already out
    g.match.reportRingOut(3); // no such wrestler
    expect(g.events).toEqual([]);
    expect(setHud).not.toHaveBeenCalled();
    expect(g.w(0).score).toBe(1);
  });

  it("ignores a ring-out while the wrestler is still waiting for its teleport", () => {
    const g = setup(2);
    g.match.start();
    // Physics has not placed the bodies yet: they are still parked below the kill plane.
    expect(g.w(0).teleport).toBe(true);
    const spawnY = g.w(0).spawnY;
    g.match.reportRingOut(0);
    expect(g.w(0).spawnY).toBe(spawnY); // the intro drop was not replaced by a put-back
    expect(g.w(0).status).toBe("alive");
  });
});

describe("contacts", () => {
  it("are ignored while either wrestler is invulnerable", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1);
    g.stepsUntil(() => g.w(1).status === "alive");
    expect(g.runtime.isInvulnerable(g.w(1))).toBe(true);

    g.match.reportContact(0, 1);
    g.match.reportContact(1, 0);
    expect(g.w(0).lastTouchedBy).toBe(-1);
    expect(g.w(1).lastTouchedBy).toBe(-1);

    // A ring-out now cannot be credited to the one who "touched" them.
    g.seconds(rules.invulnerableSeconds + 0.1);
    expect(g.runtime.isInvulnerable(g.w(1))).toBe(false);
    g.match.reportContact(0, 1);
    expect(g.w(0).lastTouchedBy).toBe(1);
    expect(g.w(1).lastTouchedBy).toBe(0);
  });

  it("are ignored for knocked-out, missing or identical wrestlers", () => {
    const g = setup(3);
    g.toPlaying();
    g.steps(10);
    g.knockOut(2);
    g.match.reportContact(0, 2); // slot 2 is out
    g.match.reportContact(0, 3); // slot 3 does not exist
    g.match.reportContact(1, 1);
    expect(g.w(0).lastTouchedBy).toBe(-1);
    expect(g.w(1).lastTouchedBy).toBe(-1);
    expect(g.w(2).lastTouchedBy).toBe(-1);
  });

  it("keep only the most recent toucher", () => {
    const g = setup(3);
    g.toPlaying();
    g.steps(10);
    g.match.reportContact(0, 1);
    g.steps(5);
    g.match.reportContact(2, 1);
    g.match.reportRingOut(1);
    expect(g.w(2).score).toBe(1);
    expect(g.w(0).score).toBe(0);
  });
});

describe("respawn", () => {
  it("brings a wrestler back after respawnSeconds, briefly invulnerable", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    g.events.length = 0;

    g.steps(stepsFor(rules.respawnSeconds) - 1);
    expect(g.w(1).status).toBe("out");
    expect(g.match.canControl(1)).toBe(false);
    expect(g.ofType("respawn")).toEqual([]);

    // Step by hand so the teleport request can be inspected before "physics" clears it.
    g.match.step(DT);
    const back = g.w(1);
    expect(back.status).toBe("alive");
    expect(back.teleport).toBe(true);
    expect(back.spawnY).toBe(arena.respawnDropHeight);
    expect(back.lastTouchedBy).toBe(-1);
    expect(back.invulnerableUntil).toBeCloseTo(g.runtime.simTime + rules.invulnerableSeconds);
    expect(g.ofType("respawn")).toEqual([
      { type: "respawn", slot: 1, x: back.spawnX, z: back.spawnZ },
    ]);
    expect(g.hud().players[1].inPlay).toBe(true);
    expect(g.match.canControl(1)).toBe(true);
    back.teleport = false;

    const invulnerableSteps = stepsFor(rules.invulnerableSeconds);
    g.steps(invulnerableSteps - 2);
    expect(g.runtime.isInvulnerable(back)).toBe(true);
    g.steps(4);
    expect(g.runtime.isInvulnerable(back)).toBe(false);
  });

  it("picks the spawn point farthest from every wrestler in play", () => {
    const g = setup(4);
    g.toPlaying();
    g.steps(10);
    g.knockOut(0);
    // Everyone else crowds slot 0's own corner at (0, spawnRadius).
    Object.assign(g.w(1), { x: 0.5, z: 3 });
    Object.assign(g.w(2), { x: -0.5, z: 3 });
    Object.assign(g.w(3), { x: 0, z: 2.5 });
    g.stepsUntil(() => g.w(0).status === "alive");
    const opposite = spawnPoint(2, 4);
    expect(g.w(0).spawnX).toBeCloseTo(opposite.x);
    expect(g.w(0).spawnZ).toBeCloseTo(opposite.z);
    expect(g.ofType("respawn")).toEqual([
      expect.objectContaining({ slot: 0, x: g.w(0).spawnX, z: g.w(0).spawnZ }),
    ]);
  });

  it("prefers the wrestler's own corner when every spawn point is equally good", () => {
    const g = setup(4);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1);
    for (const slot of [0, 2, 3]) Object.assign(g.w(slot), { x: 0, z: 0 });
    g.stepsUntil(() => g.w(1).status === "alive");
    const own = spawnPoint(1, 4);
    expect(g.w(1).spawnX).toBeCloseTo(own.x);
    expect(g.w(1).spawnZ).toBeCloseTo(own.z);
  });

  it("keeps two wrestlers who respawn on the same step apart", () => {
    const g = setup(4);
    g.toPlaying();
    g.steps(10);
    // Slot 0 falls off right next to slot 1's corner; its stale position must not count
    // once it has been given a new spawn point.
    Object.assign(g.w(0), { x: arena.spawnRadius, z: 0 });
    g.knockOut(0);
    g.knockOut(1);
    g.stepsUntil(() => g.w(0).status === "alive");
    expect(g.w(1).status).toBe("alive");
    const p0 = spawnPoint(0, 4);
    const p1 = spawnPoint(1, 4);
    expect(g.w(0).spawnX).toBeCloseTo(p0.x);
    expect(g.w(0).spawnZ).toBeCloseTo(p0.z);
    expect(g.w(1).spawnX).toBeCloseTo(p1.x);
    expect(g.w(1).spawnZ).toBeCloseTo(p1.z);
  });

  it("spawns inside the island after it has shrunk", () => {
    const g = setup(2);
    g.toPlaying();
    const lastStep = arena.crumble.steps[arena.crumble.steps.length - 1];
    g.stepsUntil(() => g.runtime.arenaRadius === lastStep.radius);
    g.knockOut(1);
    g.stepsUntil(() => g.w(1).status === "alive");
    const distance = Math.hypot(g.w(1).spawnX, g.w(1).spawnZ);
    const expected = Math.min(arena.spawnRadius, lastStep.radius - 1.2);
    expect(distance).toBeCloseTo(expected);
    expect(distance).toBeLessThan(arena.spawnRadius);
    expect(distance).toBeLessThanOrEqual(g.runtime.arenaRadius - 1.2 + 1e-9);
  });
});

describe("winning", () => {
  it("ends the match as soon as someone reaches pointsToWin", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    for (let i = 0; i < rules.pointsToWin - 1; i++) {
      g.knockOut(1, 0);
      expect(g.runtime.phase).toBe("playing");
      g.waitForRecovery();
    }
    expect(g.w(0).score).toBe(rules.pointsToWin - 1);

    g.events.length = 0;
    g.knockOut(1, 0);
    expect(g.runtime.phase).toBe("results");
    expect(g.runtime.winner).toBe(0);
    expect(g.hud()).toMatchObject({ phase: "results", winner: 0, countdown: null });
    expect(g.hud().players[0].score).toBe(rules.pointsToWin);
    expect(g.events.map((e) => e.type)).toEqual(["knockout", "score", "phase", "matchEnd"]);
    expect(g.events[2]).toEqual({ type: "phase", phase: "results", prev: "playing" });
    expect(g.events[3]).toEqual({ type: "matchEnd", winner: 0 });

    // Wrestlers stay as they are: no respawn, no control, clock frozen.
    const secondsLeft = g.runtime.secondsLeft;
    g.seconds(rules.respawnSeconds + 1);
    expect(g.w(1).status).toBe("out");
    expect(g.w(0).status).toBe("alive");
    expect(g.match.canControl(0)).toBe(false);
    expect(g.runtime.secondsLeft).toBe(secondsLeft);
    expect(g.ofType("respawn")).toEqual([]);
  });

  it("gives the match to the unique leader when the clock runs out", () => {
    const g = setup(3);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 2);
    const playSteps = stepsFor(rules.matchSeconds);
    g.steps(playSteps - 10 - 1);
    expect(g.runtime.phase).toBe("playing");
    expect(g.hud().secondsLeft).toBe(1);

    g.events.length = 0;
    g.steps(1);
    expect(g.runtime.secondsLeft).toBe(0);
    expect(g.hud().secondsLeft).toBe(0);
    expect(g.runtime.phase).toBe("results");
    expect(g.runtime.winner).toBe(2);
    expect(g.hud().winner).toBe(2);
    expect(g.events).toEqual([
      { type: "phase", phase: "results", prev: "playing" },
      { type: "matchEnd", winner: 2 },
    ]);
    expect(g.ofType("suddenDeath")).toEqual([]);
  });

  it("goes to sudden death on a tie and the next decisive knockout wins", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(stepsFor(rules.matchSeconds) - 1);
    expect(g.runtime.phase).toBe("playing");
    g.events.length = 0;
    g.steps(1);
    expect(g.runtime.phase).toBe("suddenDeath");
    expect(g.hud().phase).toBe("suddenDeath");
    expect(g.hud().secondsLeft).toBe(0);
    expect(g.runtime.winner).toBeNull();
    expect(g.events).toEqual([
      { type: "phase", phase: "suddenDeath", prev: "playing" },
      { type: "suddenDeath" },
    ]);
    expect(g.match.canControl(0)).toBe(true);

    // A self knockout at 0–0 decides nothing: still tied, play (and respawns) go on.
    g.knockOut(1);
    expect(g.runtime.phase).toBe("suddenDeath");
    expect(g.match.canControl(1)).toBe(false);
    g.waitForRecovery();
    expect(g.w(1).status).toBe("alive");
    expect(g.match.canControl(1)).toBe(true);
    expect(g.runtime.secondsLeft).toBe(0);

    g.events.length = 0;
    g.knockOut(0, 1);
    expect(g.runtime.phase).toBe("results");
    expect(g.runtime.winner).toBe(1);
    expect(g.events.map((e) => e.type)).toEqual(["knockout", "score", "phase", "matchEnd"]);
    expect(g.events[3]).toEqual({ type: "matchEnd", winner: 1 });
  });

  it("only ends sudden death once somebody leads alone", () => {
    const g = setup(3);
    g.toPlaying();
    g.steps(10);
    g.knockOut(2, 0);
    g.waitForRecovery();
    g.knockOut(2, 1);
    g.waitForRecovery();
    // 1 – 1 – 0 when the clock runs out.
    g.stepsUntil(() => g.runtime.phase !== "playing");
    expect(g.runtime.phase).toBe("suddenDeath");

    // The trailing wrestler scores: 1 – 1 – 1, still no unique leader.
    g.knockOut(0, 2);
    expect(g.runtime.phase).toBe("suddenDeath");
    g.waitForRecovery();

    // A leader slips off on their own: 1 – 0 – 1 … still shared.
    g.seconds(rules.attributionSeconds + 0.5);
    g.knockOut(1);
    expect(g.w(1).score).toBe(0);
    expect(g.runtime.phase).toBe("suddenDeath");
    g.waitForRecovery();

    // And another: 0 – 0 – 1 leaves slot 2 alone at the top.
    g.knockOut(0);
    expect(g.runtime.phase).toBe("results");
    expect(g.runtime.winner).toBe(2);
  });
});

describe("crumble", () => {
  it("warns, then shrinks the island, for each step in order", () => {
    const g = setup(2);
    g.toPlaying();
    const warnSteps = stepsFor(arena.crumble.warnSeconds);
    let played = 0;
    let radius: number = arena.radius;

    arena.crumble.steps.forEach((step, index) => {
      const warnAt = stepsFor(rules.matchSeconds - step.at);

      g.steps(warnAt - played - 1);
      expect(g.ofType("crumbleWarn").length).toBe(index);
      if (index === 0) expect(g.hud().finalStretch).toBe(false);

      g.steps(1);
      expect(g.ofType("crumbleWarn")[index]).toEqual({
        type: "crumbleWarn",
        radius: step.radius,
        seconds: arena.crumble.warnSeconds,
      });
      expect(g.hud().finalStretch).toBe(true);
      expect(g.hud().secondsLeft).toBe(step.at);
      // Cracking, but still walkable.
      expect(g.runtime.arenaRadius).toBe(radius);

      g.steps(warnSteps - 1);
      expect(g.runtime.arenaRadius).toBe(radius);
      expect(g.ofType("crumble").length).toBe(index);

      g.steps(1);
      radius = step.radius;
      expect(g.runtime.arenaRadius).toBe(radius);
      expect(g.ofType("crumble")[index]).toEqual({ type: "crumble", radius });
      played = warnAt + warnSteps;
    });

    expect(g.ofType("crumbleWarn").length).toBe(arena.crumble.steps.length);
    g.stepsUntil(() => g.runtime.phase !== "playing");
    expect(g.ofType("crumble").length).toBe(arena.crumble.steps.length);
    expect(g.runtime.arenaRadius).toBe(radius);
  });

  it("lets a pending warning complete during sudden death", () => {
    const g = setup(2, {
      rules: { matchSeconds: 3 },
      crumble: { warnSeconds: 2, steps: [{ at: 1, radius: 5 }] },
    });
    g.toPlaying();
    g.steps(stepsFor(2)); // 1 s left: warning
    expect(g.ofType("crumbleWarn")).toEqual([{ type: "crumbleWarn", radius: 5, seconds: 2 }]);
    g.steps(stepsFor(1)); // clock out at 0–0
    expect(g.runtime.phase).toBe("suddenDeath");
    expect(g.runtime.arenaRadius).toBe(arena.radius);

    g.steps(stepsFor(1) - 1);
    expect(g.runtime.arenaRadius).toBe(arena.radius);
    g.steps(1);
    expect(g.runtime.arenaRadius).toBe(5);
    expect(g.ofType("crumble")).toEqual([{ type: "crumble", radius: 5 }]);
    expect(g.runtime.phase).toBe("suddenDeath");
  });

  it("drops a pending warning when the match ends first", () => {
    const g = setup(2, {
      rules: { matchSeconds: 3 },
      crumble: { warnSeconds: 2, steps: [{ at: 1, radius: 5 }] },
    });
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    g.stepsUntil(() => g.runtime.phase === "results");
    expect(g.runtime.winner).toBe(0);
    g.seconds(5);
    expect(g.ofType("crumble")).toEqual([]);
    expect(g.runtime.arenaRadius).toBe(arena.radius);
  });
});

describe("ring-outs outside play", () => {
  it("puts a wrestler back without scoring during the intro and the countdown", () => {
    const g = setup(3);
    g.match.start();
    g.steps(20);
    expect(g.runtime.phase).toBe("intro");

    const check = (slot: PlayerSlot): void => {
      const w = g.w(slot);
      const eventsBefore = g.events.length;
      const hudBefore = g.hud();
      g.match.reportContact(slot === 0 ? 1 : 0, slot);
      Object.assign(w, { x: 9, y: -3, z: 0 });
      g.match.reportRingOut(slot);

      const own = spawnPoint(slot, 3);
      expect(w.status).toBe("alive");
      expect(w.teleport).toBe(true);
      expect(w.spawnX).toBeCloseTo(own.x);
      expect(w.spawnZ).toBeCloseTo(own.z);
      expect(w.spawnY).toBe(arena.respawnDropHeight);
      expect(g.events.length).toBe(eventsBefore);
      expect(g.hud()).toBe(hudBefore);
      expect(g.runtime.wrestlers.every((x) => x.score === 0)).toBe(true);
      g.tick(); // "physics" performs the teleport
      expect(w.teleport).toBe(false);
    };

    check(1);
    g.stepsUntil(() => g.runtime.phase === "countdown");
    g.steps(5);
    check(2);

    g.stepsUntil(() => g.runtime.phase === "playing");
    expect(g.ofType("knockout")).toEqual([]);
    expect(g.ofType("score")).toEqual([]);
  });

  it("puts a wrestler back without scoring on the results screen", () => {
    const g = setup(2, { rules: { pointsToWin: 1 } });
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    expect(g.runtime.phase).toBe("results");
    g.steps(5);

    g.events.length = 0;
    g.match.reportRingOut(0);
    expect(g.w(0).status).toBe("alive");
    expect(g.w(0).teleport).toBe(true);
    expect(g.w(0).spawnY).toBe(arena.respawnDropHeight);
    expect(g.w(0).score).toBe(1);
    expect(g.events).toEqual([]);
  });

  it("ignores ring-outs of idle wrestlers in the lobby", () => {
    const g = setup(2);
    g.match.reportRingOut(0);
    expect(g.w(0).status).toBe("idle");
    expect(g.w(0).teleport).toBe(false);
    expect(g.events).toEqual([]);
  });
});

describe("rematch", () => {
  it("does nothing outside the results phase", () => {
    const g = setup(2);
    g.match.rematch();
    expect(g.runtime.phase).toBe("lobby");
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    g.match.rematch();
    expect(g.runtime.phase).toBe("playing");
    expect(g.w(0).score).toBe(1);
  });

  it("resets everything and plays a full second match", () => {
    const g = setup(2);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    // Run the clock out: both crumble steps happen, slot 0 wins on points.
    g.stepsUntil(() => g.runtime.phase === "results");
    expect(g.runtime.winner).toBe(0);
    expect(g.runtime.arenaRadius).toBeLessThan(arena.radius);
    expect(g.hud().finalStretch).toBe(true);
    g.knockOut(0); // no effect on the results screen beyond a put-back
    g.steps(3);

    g.events.length = 0;
    g.match.rematch();

    expect(g.runtime.phase).toBe("intro");
    expect(g.runtime.winner).toBeNull();
    expect(g.runtime.secondsLeft).toBe(rules.matchSeconds);
    expect(g.runtime.arenaRadius).toBe(arena.radius);
    expect(g.events).toEqual([{ type: "phase", phase: "intro", prev: "results" }]);
    expect(g.hud()).toMatchObject({
      phase: "intro",
      secondsLeft: rules.matchSeconds,
      countdown: null,
      callout: null,
      winner: null,
      finalStretch: false,
    });
    expect(g.hud().players.map((p) => [p.score, p.inPlay])).toEqual([
      [0, true],
      [0, true],
    ]);
    g.runtime.wrestlers.forEach((w, index) => {
      expect(w.status).toBe("alive");
      expect(w.score).toBe(0);
      expect(w.lastTouchedBy).toBe(-1);
      expect(w.invulnerableUntil).toBe(0);
      expect(w.teleport).toBe(true);
      expect(w.spawnY).toBeCloseTo(arena.introDropHeight + index * 1.5);
    });

    // The second match behaves exactly like the first, crumble included.
    g.stepsUntil(() => g.runtime.phase === "playing");
    expect(g.ofType("countdown").map((e) => e.n)).toEqual([3, 2, 1, 0]);
    g.stepsUntil(() => g.runtime.phase !== "playing");
    expect(g.ofType("crumbleWarn").map((e) => e.radius)).toEqual(
      arena.crumble.steps.map((s) => s.radius),
    );
    expect(g.ofType("crumble").length).toBe(arena.crumble.steps.length);
    expect(g.runtime.phase).toBe("suddenDeath"); // 0–0 this time
  });
});

describe("toLobby", () => {
  it("parks everyone and resets the match from the middle of play", () => {
    const g = setup(3);
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    g.runtime.arenaRadius = 4;
    g.events.length = 0;

    g.match.toLobby();

    expect(g.runtime.phase).toBe("lobby");
    expect(g.runtime.phaseTime).toBe(0);
    expect(g.runtime.winner).toBeNull();
    expect(g.runtime.arenaRadius).toBe(arena.radius);
    expect(g.runtime.secondsLeft).toBe(rules.matchSeconds);
    for (const w of g.runtime.wrestlers) {
      expect(w.status).toBe("idle");
      expect(w.score).toBe(0);
      expect(w.lastTouchedBy).toBe(-1);
      expect(w.teleport).toBe(false);
    }
    expect(g.events).toEqual([{ type: "phase", phase: "lobby", prev: "playing" }]);
    expect(g.hud()).toMatchObject({
      phase: "lobby",
      secondsLeft: rules.matchSeconds,
      countdown: null,
      callout: null,
      winner: null,
      finalStretch: false,
    });
    expect(g.hud().players.map((p) => [p.slot, p.name, p.score, p.inPlay])).toEqual([
      [0, "Aka", 0, false],
      [1, "Ao", 0, false],
      [2, "Shiro", 0, false],
    ]);

    // Nothing keeps running in the lobby: no respawns, no clock.
    g.seconds(rules.respawnSeconds + 1);
    expect(g.events.length).toBe(1);
    expect(g.w(1).status).toBe("idle");

    // And a new match can start from there.
    expect(g.match.start()).toBe(true);
    expect(g.runtime.phase).toBe("intro");
  });

  it("works from results and clears the winner", () => {
    const g = setup(2, { rules: { pointsToWin: 1 } });
    g.toPlaying();
    g.steps(10);
    g.knockOut(1, 0);
    expect(g.hud().winner).toBe(0);
    g.match.toLobby();
    expect(g.runtime.phase).toBe("lobby");
    expect(g.hud().winner).toBeNull();
    expect(g.hud().callout).toBeNull();
    expect(g.hud().players.every((p) => p.score === 0 && !p.inPlay)).toBe(true);
  });

  it("is silent when already in the lobby", () => {
    const g = setup(2);
    const setHud = vi.spyOn(g.runtime, "setHud");
    g.match.toLobby();
    expect(g.runtime.phase).toBe("lobby");
    expect(g.events).toEqual([]);
    expect(setHud).not.toHaveBeenCalled();
  });
});

describe("canControl", () => {
  it("is true only for alive wrestlers while playing or in sudden death", () => {
    const g = setup(2);
    expect(g.match.canControl(0)).toBe(false); // lobby

    g.match.start();
    g.steps(5);
    expect(g.runtime.phase).toBe("intro");
    expect(g.match.canControl(0)).toBe(false);

    g.stepsUntil(() => g.runtime.phase === "countdown");
    expect(g.match.canControl(0)).toBe(false);

    g.stepsUntil(() => g.runtime.phase === "playing");
    expect(g.match.canControl(0)).toBe(true);
    expect(g.match.canControl(1)).toBe(true);
    expect(g.match.canControl(2)).toBe(false); // nobody in that slot

    g.steps(10);
    g.knockOut(1);
    expect(g.match.canControl(1)).toBe(false);
    g.stepsUntil(() => g.w(1).status === "alive");
    expect(g.match.canControl(1)).toBe(true);

    g.stepsUntil(() => g.runtime.phase === "suddenDeath");
    expect(g.match.canControl(0)).toBe(true);

    g.waitForRecovery();
    g.knockOut(1, 0);
    expect(g.runtime.phase).toBe("results");
    expect(g.match.canControl(0)).toBe(false);
    expect(g.match.canControl(1)).toBe(false);
  });
});
