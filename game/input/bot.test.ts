import { describe, expect, it } from "vitest";
import { gameConfig } from "../config";
import { hash01, inputToWorld } from "../math";
import { GameRuntime } from "../runtime";
import type { InputSource, PlayerInput, PlayerSlot, WrestlerRuntime } from "../types";
import { botArenaRadius, createBotSource, worldToInput } from "./bot";

const DT = 1 / gameConfig.sim.hz;
const BODY = gameConfig.wrestler.radius;

function input(): PlayerInput {
  return { x: 9, y: 9, dash: true, brace: true };
}

/** A runtime mid-match with `count` wrestlers standing on the island at their spawn-ish spots. */
function arena(count: number): GameRuntime {
  const runtime = new GameRuntime();
  const slots: PlayerSlot[] = [0, 1, 2, 3];
  runtime.setPlayers(slots.slice(0, count).map((slot) => ({ slot, name: `P${slot}`, control: "bot" as const })));
  runtime.phase = "playing";
  runtime.simTime = 10;
  runtime.secondsLeft = 120;
  for (const w of runtime.wrestlers) {
    w.status = "alive";
    w.y = BODY;
    w.grounded = true;
  }
  return runtime;
}

function place(w: WrestlerRuntime, x: number, z: number, vx = 0, vz = 0): void {
  w.x = x;
  w.z = z;
  w.y = BODY;
  w.vx = vx;
  w.vz = vz;
}

/** The world-space direction a stick sample asks for. */
function toWorld(out: PlayerInput, yaw: number): { x: number; z: number } {
  return inputToWorld(out.x, out.y, yaw, { x: 0, z: 0 });
}

type Body = { prevDash: boolean };

/**
 * A deliberately tiny stand-in for the physics layer: discs with the config's
 * acceleration, speed cap, damping, dash and brace, and (unless `ghosts` is set) plain
 * equal-mass bounces between bodies. No falling. Wrestlers without an input source are
 * scripted by the test and are never pushed. Enough to check that the bot's steering
 * converges and keeps it on the island.
 */
class MiniSim {
  readonly bodies = new Map<number, Body>();
  private readonly scratch: PlayerInput = { x: 0, y: 0, dash: false, brace: false };
  private readonly dir = { x: 0, z: 0 };
  dashes = 0;

  constructor(
    readonly runtime: GameRuntime,
    readonly sources: Map<number, InputSource>,
    /** Bodies pass through each other (every dash is a miss). */
    readonly ghosts = false,
  ) {}

  /** Keep `w` out of every other body and take the bounce of an equal-mass impact. */
  private collide(w: WrestlerRuntime): void {
    const bounce = (1 + gameConfig.wrestler.restitution) / 2;
    for (const o of this.runtime.wrestlers) {
      if (o === w || o.status !== "alive") continue;
      const dx = w.x - o.x;
      const dz = w.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d >= BODY * 2 || d < 1e-6) continue;
      const nx = dx / d;
      const nz = dz / d;
      w.x = o.x + nx * BODY * 2;
      w.z = o.z + nz * BODY * 2;
      const approach = (w.vx - o.vx) * nx + (w.vz - o.vz) * nz;
      if (approach < 0) {
        w.vx -= approach * bounce * nx;
        w.vz -= approach * bounce * nz;
      }
    }
  }

  step(dt: number): void {
    const cfg = gameConfig.wrestler;
    for (const w of this.runtime.wrestlers) {
      const source = this.sources.get(w.slot);
      if (!source || w.status !== "alive") continue;
      let body = this.bodies.get(w.slot);
      if (!body) {
        body = { prevDash: false };
        this.bodies.set(w.slot, body);
      }
      const inp = this.scratch;
      source.sample(inp, w.slot, this.runtime, dt);
      inputToWorld(inp.x, inp.y, this.runtime.cameraYaw, this.dir);
      let mag = Math.hypot(this.dir.x, this.dir.z);
      if (mag < cfg.deadzone) mag = 0;
      if (mag > 0) w.facing = Math.atan2(this.dir.x, this.dir.z);

      // Brace: hold to root, limited hold, then a cooldown.
      if (w.bracing) {
        w.braceTimeLeft -= dt;
        if (!inp.brace || w.braceTimeLeft <= 0) {
          w.bracing = false;
          w.braceCooldownLeft = cfg.brace.cooldownSeconds;
        }
      } else {
        w.braceCooldownLeft = Math.max(0, w.braceCooldownLeft - dt);
        if (inp.brace && w.braceCooldownLeft <= 0 && !w.dashing) {
          w.bracing = true;
          w.braceTimeLeft = cfg.brace.maxHoldSeconds;
        }
      }

      // Dash: press edge launches along the stick (or the facing).
      w.dashCooldownLeft = Math.max(0, w.dashCooldownLeft - dt);
      if (w.dashing) {
        w.dashTimeLeft -= dt;
        if (w.dashTimeLeft <= 0) w.dashing = false;
      }
      if (inp.dash && !body.prevDash && !w.dashing && !w.bracing && w.dashCooldownLeft <= 0) {
        const dx = mag > 0 ? this.dir.x / mag : Math.sin(w.facing);
        const dz = mag > 0 ? this.dir.z / mag : Math.cos(w.facing);
        const speed = cfg.maxSpeed * cfg.dash.speedMultiplier;
        w.vx = dx * speed;
        w.vz = dz * speed;
        w.dashing = true;
        w.dashTimeLeft = cfg.dash.durationSeconds;
        w.dashCooldownLeft = cfg.dash.cooldownSeconds;
        this.dashes++;
      }
      body.prevDash = inp.dash;

      if (mag > 0 && !w.dashing && !w.bracing) {
        const before = Math.hypot(w.vx, w.vz);
        w.vx += this.dir.x * cfg.moveAcceleration * dt;
        w.vz += this.dir.z * cfg.moveAcceleration * dt;
        const after = Math.hypot(w.vx, w.vz);
        const cap = Math.max(before, cfg.maxSpeed);
        if (after > cap) {
          w.vx *= cap / after;
          w.vz *= cap / after;
        }
      }
      const damping = w.bracing ? cfg.brace.linearDamping : cfg.linearDamping;
      const keep = Math.exp(-damping * dt);
      w.vx *= keep;
      w.vz *= keep;
      w.x += w.vx * dt;
      w.z += w.vz * dt;
      if (!this.ghosts) this.collide(w);
    }
    this.runtime.simTime += dt;
  }
}

describe("worldToInput", () => {
  it("is the exact inverse of inputToWorld for any yaw", () => {
    const yaws = [0, 0.3, Math.PI / 2, 2.2, Math.PI, -1.1, -Math.PI / 2, 5.9, 12.7];
    const stick = { x: 0, y: 0 };
    const world = { x: 0, z: 0 };
    for (const yaw of yaws) {
      for (let i = 0; i < 12; i++) {
        const wx = hash01(i * 2 + 1) * 4 - 2;
        const wz = hash01(i * 2 + 2) * 4 - 2;
        worldToInput(wx, wz, yaw, stick);
        inputToWorld(stick.x, stick.y, yaw, world);
        expect(world.x).toBeCloseTo(wx, 10);
        expect(world.z).toBeCloseTo(wz, 10);
        // …and the other way round.
        inputToWorld(wx, wz, yaw, world);
        worldToInput(world.x, world.z, yaw, stick);
        expect(stick.x).toBeCloseTo(wx, 10);
        expect(stick.y).toBeCloseTo(wz, 10);
      }
    }
  });

  it("matches the camera convention: away from a +Z camera is stick-up", () => {
    const stick = worldToInput(0, -1, 0, { x: 0, y: 0 });
    expect(stick.x).toBeCloseTo(0);
    expect(stick.y).toBeCloseTo(1);
    const right = worldToInput(1, 0, 0, { x: 0, y: 0 });
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });

  it("preserves magnitude", () => {
    const stick = worldToInput(0.3, -0.4, 1.234, { x: 0, y: 0 });
    expect(Math.hypot(stick.x, stick.y)).toBeCloseTo(0.5, 10);
  });
});

describe("bot: when it must stay neutral", () => {
  it("returns neutral input when its wrestler is not alive", () => {
    for (const status of ["idle", "out"] as const) {
      const runtime = arena(2);
      const bot = createBotSource({ seed: 1 });
      place(runtime.wrestlers[0], 5.6, 0);
      place(runtime.wrestlers[1], 4, 0);
      runtime.wrestlers[0].status = status;
      for (let i = 0; i < 60; i++) {
        const out = input();
        bot.sample(out, 0, runtime, DT);
        expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false });
      }
    }
  });

  it("returns neutral input for a slot with no wrestler", () => {
    const runtime = arena(2);
    const out = input();
    createBotSource().sample(out, 3, runtime, DT);
    expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false });
  });

  it("waits outside the playing phases", () => {
    for (const phase of ["lobby", "intro", "countdown", "results"] as const) {
      const runtime = arena(2);
      runtime.phase = phase;
      place(runtime.wrestlers[0], 0, 0);
      place(runtime.wrestlers[1], 0, 2);
      const bot = createBotSource({ seed: 2 });
      for (let i = 0; i < 60; i++) {
        const out = input();
        bot.sample(out, 0, runtime, DT);
        expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false });
      }
    }
  });

  it("gives no input while in the air or falling", () => {
    const runtime = arena(2);
    const me = runtime.wrestlers[0];
    place(runtime.wrestlers[1], 0, 2);
    const bot = createBotSource({ seed: 3 });
    const cases: Array<(w: WrestlerRuntime) => void> = [
      (w) => {
        place(w, 1, 0);
        w.y = 2.5; // dropping in
        w.grounded = false;
      },
      (w) => {
        place(w, 6.4, 0, 3, 0);
        w.y = BODY - 0.05; // over the edge
        w.grounded = false;
      },
      (w) => {
        place(w, 6.6, 0, 3, 0);
        w.y = -1; // well below the surface, whatever `grounded` says
        w.grounded = true;
      },
    ];
    for (const setup of cases) {
      setup(me);
      for (let i = 0; i < 40; i++) {
        const out = input();
        bot.sample(out, 0, runtime, DT);
        expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false });
      }
    }
  });
});

describe("bot: survival", () => {
  it("steers toward the centre when near the edge, whatever the camera yaw", () => {
    for (const yaw of [0, 1.1, -2.4, Math.PI]) {
      for (const angle of [0, 1.9, 4.2]) {
        const runtime = arena(2);
        runtime.cameraYaw = yaw;
        const me = runtime.wrestlers[0];
        place(me, Math.sin(angle) * 5.6, Math.cos(angle) * 5.6);
        place(runtime.wrestlers[1], Math.sin(angle) * 3, Math.cos(angle) * 3);
        const bot = createBotSource({ seed: 4 });
        const out = input();
        bot.sample(out, 0, runtime, DT);
        const world = toWorld(out, yaw);
        const inward = -(world.x * Math.sin(angle) + world.z * Math.cos(angle));
        expect(Math.hypot(world.x, world.z)).toBeGreaterThan(0.9);
        expect(inward).toBeGreaterThan(0.85);
        expect(out.dash).toBe(false);
      }
    }
  });

  it("brakes when its velocity is about to carry it off", () => {
    const runtime = arena(1);
    const me = runtime.wrestlers[0];
    place(me, 3.6, 0, 5.4, 0); // well inside, but sliding fast toward +X
    const out = input();
    createBotSource({ seed: 5 }).sample(out, 0, runtime, DT);
    expect(toWorld(out, 0).x).toBeLessThan(-0.85);
  });

  it("uses the shrunken radius, and anticipates the crumble", () => {
    const runtime = arena(1);
    expect(botArenaRadius(runtime)).toBe(6);
    runtime.secondsLeft = 29; // outer ring is cracking
    expect(botArenaRadius(runtime)).toBe(5);
    runtime.arenaRadius = 5;
    runtime.secondsLeft = 14;
    expect(botArenaRadius(runtime)).toBe(4);
    runtime.arenaRadius = 4;
    runtime.secondsLeft = 5;
    expect(botArenaRadius(runtime)).toBe(4);

    // Standing at 3.6 is fine on the full island and an emergency on the smallest one.
    const me = runtime.wrestlers[0];
    place(me, 0, 3.6);
    const out = input();
    createBotSource({ seed: 6 }).sample(out, 0, runtime, DT);
    expect(toWorld(out, 0).z).toBeLessThan(-0.85);
  });

  it("walks off the cracking ring before it falls", () => {
    const runtime = arena(1);
    runtime.secondsLeft = 30;
    const me = runtime.wrestlers[0];
    place(me, 4.9, 0);
    const sim = new MiniSim(runtime, new Map([[0, createBotSource({ seed: 7 })]]));
    for (let i = 0; i < 1.5 / DT; i++) sim.step(DT);
    expect(Math.hypot(me.x, me.z)).toBeLessThan(4.4);
  });

  it("alone on the island it wanders near the centre and never leaves, at any size", () => {
    for (const radius of [6, 5, 4]) {
      for (const skill of [0, 0.6, 1]) {
        const runtime = arena(1);
        runtime.arenaRadius = radius;
        const me = runtime.wrestlers[0];
        place(me, 0, radius - 1.2, 0, 3);
        const sim = new MiniSim(runtime, new Map([[0, createBotSource({ seed: 8, skill })]]));
        let farthest = 0;
        let travelled = 0;
        for (let i = 0; i < 20 / DT; i++) {
          sim.step(DT);
          farthest = Math.max(farthest, Math.hypot(me.x, me.z));
          if (i > 5 / DT) travelled += Math.hypot(me.vx, me.vz) * DT;
        }
        expect(farthest).toBeLessThan(radius - 0.3);
        expect(Math.hypot(me.x, me.z)).toBeLessThan(2.2);
        expect(travelled).toBeGreaterThan(2); // wandering, not parked
        expect(sim.dashes).toBe(0);
      }
    }
  });

  it("stays on the island while chasing, including missed dashes", () => {
    for (const radius of [6, 5, 4]) {
      for (const seed of [1, 2, 3, 4]) {
        const runtime = arena(2);
        runtime.arenaRadius = radius;
        const [me, dummy] = runtime.wrestlers;
        place(me, -2, 0);
        const sim = new MiniSim(runtime, new Map([[0, createBotSource({ seed, skill: 0.6 })]]));
        let farthest = 0;
        for (let i = 0; i < 40 / DT; i++) {
          // A scripted dummy gliding around the island well inside the edge.
          const t = runtime.simTime;
          const r = (radius - 1.6) * (0.55 + 0.45 * Math.sin(t * 0.37));
          const nx = Math.sin(t * 0.8) * r;
          const nz = Math.cos(t * 0.8) * r;
          dummy.vx = (nx - dummy.x) / DT;
          dummy.vz = (nz - dummy.z) / DT;
          dummy.x = nx;
          dummy.z = nz;
          sim.step(DT);
          farthest = Math.max(farthest, Math.hypot(me.x, me.z));
        }
        expect(farthest).toBeLessThan(radius);
      }
    }
  });
});

describe("bot: attack", () => {
  it("heads for its target", () => {
    const runtime = arena(2);
    const [me, foe] = runtime.wrestlers;
    place(me, -3, 0);
    place(foe, 3, 0);
    const sim = new MiniSim(runtime, new Map([[0, createBotSource({ seed: 9, skill: 1 })]]));
    let closest = Infinity;
    for (let i = 0; i < 3 / DT; i++) {
      sim.step(DT);
      closest = Math.min(closest, Math.hypot(foe.x - me.x, foe.z - me.z));
      if (i === Math.round(0.6 / DT)) expect(me.vx).toBeGreaterThan(2);
    }
    expect(closest).toBeLessThan(BODY * 2);
  });

  it("gets on the island-centre side of the target before pushing", () => {
    for (const seed of [1, 2, 3]) {
      const runtime = arena(2);
      const [me, foe] = runtime.wrestlers;
      place(foe, 2.5, 0);
      place(me, 4.6, 0.4); // caught between the target and the edge
      const sim = new MiniSim(runtime, new Map([[0, createBotSource({ seed })]]));
      let linedUp = false;
      for (let i = 0; i < 5 / DT && !linedUp; i++) {
        sim.step(DT);
        // On the centre side (smaller x), close, and roughly on the push line.
        linedUp = me.x < foe.x - 0.8 && me.x > foe.x - 2.2 && Math.abs(me.z) < 0.7;
      }
      expect(linedUp).toBe(true);
    }
  });

  it("ignores invulnerable opponents and falls back to wandering", () => {
    const runtime = arena(2);
    const [me, foe] = runtime.wrestlers;
    place(me, 0, 0);
    place(foe, 0, 4);
    foe.invulnerableUntil = runtime.simTime + 1000;
    const sim = new MiniSim(runtime, new Map([[0, createBotSource({ seed: 10 })]]));
    let closest = Infinity;
    for (let i = 0; i < 6 / DT; i++) {
      sim.step(DT);
      closest = Math.min(closest, Math.hypot(foe.x - me.x, foe.z - me.z));
    }
    expect(closest).toBeGreaterThan(2);
    expect(sim.dashes).toBe(0);
  });

  it("keeps its target unless another opponent is clearly closer", () => {
    const runtime = arena(3);
    const [me, a, b] = runtime.wrestlers;
    place(me, 0, 0);
    place(a, 3, 0);
    place(b, -3.4, 0);
    const bot = createBotSource({ seed: 11, skill: 1 });
    const out = input();
    for (let i = 0; i < 30; i++) bot.sample(out, 0, runtime, DT);
    expect(toWorld(out, 0).x).toBeGreaterThan(0.5); // going for `a`, the nearer one
    place(b, -2.6, 0); // now slightly nearer than `a`, but not by enough to switch
    for (let i = 0; i < 30; i++) bot.sample(out, 0, runtime, DT);
    expect(toWorld(out, 0).x).toBeGreaterThan(0.5);
    place(b, -1.5, 0); // clearly nearer: switch
    for (let i = 0; i < 30; i++) bot.sample(out, 0, runtime, DT);
    expect(toWorld(out, 0).x).toBeLessThan(-0.5);
  });
});

/** Sample a motionless scene for `seconds`; returns per-sample dash / brace flags. */
function watch(bot: InputSource, runtime: GameRuntime, seconds: number, dt = DT) {
  const dash: boolean[] = [];
  const brace: boolean[] = [];
  const out = input();
  for (let t = 0; t < seconds; t += dt) {
    bot.sample(out, 0, runtime, dt);
    dash.push(out.dash);
    brace.push(out.brace);
    runtime.simTime += dt;
  }
  return { dash, brace, last: out };
}

describe("bot: dash", () => {
  function duel(): { runtime: GameRuntime; me: WrestlerRuntime; foe: WrestlerRuntime } {
    const runtime = arena(2);
    const [me, foe] = runtime.wrestlers;
    place(me, 0, 0);
    place(foe, 0, 2);
    me.facing = 0; // looking down +Z, straight at the target
    return { runtime, me, foe };
  }

  it("dashes at a close, lined-up target, aiming the stick at it", () => {
    for (const yaw of [0, 0.9, -2]) {
      const { runtime } = duel();
      runtime.cameraYaw = yaw;
      const bot = createBotSource({ seed: 12, skill: 1 });
      const out = input();
      let dashed = false;
      for (let i = 0; i < 0.5 / DT && !dashed; i++) {
        bot.sample(out, 0, runtime, DT);
        dashed = out.dash;
      }
      expect(dashed).toBe(true);
      const world = toWorld(out, yaw);
      expect(world.z).toBeGreaterThan(0.95);
      expect(Math.abs(world.x)).toBeLessThan(0.2);
    }
  });

  it("holds the button for a few steps, then releases it", () => {
    for (const dt of [DT, 0.005]) {
      const { runtime } = duel();
      const { dash } = watch(createBotSource({ seed: 13, skill: 1 }), runtime, 0.45, dt);
      const first = dash.indexOf(true);
      expect(first).toBeGreaterThanOrEqual(0);
      let held = 0;
      while (dash[first + held]) held++;
      expect(held).toBeGreaterThanOrEqual(3);
      expect(held * dt).toBeLessThan(0.2);
      expect(first + held).toBeLessThan(dash.length); // released again
    }
  });

  it("does not dash while its dash is on cooldown", () => {
    const { runtime, me } = duel();
    me.dashCooldownLeft = 1;
    expect(watch(createBotSource({ seed: 14, skill: 1 }), runtime, 1).dash).not.toContain(true);
  });

  it("does not dash when it is not facing the target", () => {
    const { runtime, me } = duel();
    me.facing = Math.PI / 2;
    expect(watch(createBotSource({ seed: 15, skill: 1 }), runtime, 1).dash).not.toContain(true);
  });

  it("does not dash from far away", () => {
    const { runtime, me, foe } = duel();
    place(me, 0, -2.5);
    place(foe, 0, 2.5);
    expect(watch(createBotSource({ seed: 16, skill: 1 }), runtime, 1).dash).not.toContain(true);
  });

  it("does not dash when the lunge would carry it off the island", () => {
    const { runtime, me, foe } = duel();
    place(me, 0, 4.4);
    place(foe, 0, 5.6); // teetering on the edge: just walk it off
    expect(watch(createBotSource({ seed: 17, skill: 1 }), runtime, 1).dash).not.toContain(true);

    // The same point-blank duel that dashes on the full island is too risky on the smallest one.
    for (const radius of [6, 4]) {
      const close = duel();
      close.runtime.arenaRadius = radius;
      place(close.me, 0, 2.3);
      place(close.foe, 0, 3.6);
      const { dash } = watch(createBotSource({ seed: 17, skill: 1 }), close.runtime, 1);
      expect(dash.includes(true)).toBe(radius === 6);
    }
  });

  it("only gambles on a dash that could carry it off when the hit is certain", () => {
    // A miss from any of these ends well past the edge.
    const far = duel();
    place(far.me, 0, 1);
    place(far.foe, 0, 3.8); // lined up and within the safe-dash range, but not point-blank
    expect(watch(createBotSource({ seed: 24, skill: 1 }), far.runtime, 1).dash).not.toContain(true);

    const dodgy = duel();
    place(dodgy.me, 0, 2);
    place(dodgy.foe, 0, 3.5);
    dodgy.foe.dashing = true; // point-blank, but it is mid-lunge itself
    expect(watch(createBotSource({ seed: 24, skill: 1 }), dodgy.runtime, 1).dash).not.toContain(true);

    const sure = duel();
    place(sure.me, 0, 2);
    place(sure.foe, 0, 3.5);
    expect(watch(createBotSource({ seed: 24, skill: 1 }), sure.runtime, 1).dash).toContain(true);
  });

  it("a dash that misses does not carry it off the island", () => {
    for (const radius of [6, 5]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const runtime = arena(2);
        runtime.arenaRadius = radius;
        const [me, foe] = runtime.wrestlers;
        // Lined up across the middle of the island, too far for a point-blank lunge;
        // the "target" is a ghost, so the dash sails straight through it.
        place(me, 0, -1.5);
        place(foe, 0, 1.2);
        me.facing = 0;
        const sim = new MiniSim(runtime, new Map([[0, createBotSource({ seed, skill: 1 })]]), true);
        for (let i = 0; i < 1 / DT && sim.dashes === 0; i++) sim.step(DT);
        expect(sim.dashes).toBe(1);
        // Follow the lunge and the braking after it (the next dash is still on cooldown).
        let farthest = 0;
        for (let i = 0; i < 1 / DT; i++) {
          sim.step(DT);
          farthest = Math.max(farthest, Math.hypot(me.x, me.z));
        }
        expect(sim.dashes).toBe(1);
        expect(farthest).toBeLessThan(radius - 0.3);
      }
    }
  });

  it("does not waste a dash on a braced or invulnerable target, or while invulnerable itself", () => {
    const braced = duel();
    braced.foe.bracing = true;
    expect(watch(createBotSource({ seed: 18, skill: 1 }), braced.runtime, 1).dash).not.toContain(true);

    const ghost = duel();
    ghost.foe.invulnerableUntil = ghost.runtime.simTime + 100;
    expect(watch(createBotSource({ seed: 18, skill: 1 }), ghost.runtime, 1).dash).not.toContain(true);

    const fresh = duel();
    fresh.me.invulnerableUntil = fresh.runtime.simTime + 100;
    expect(watch(createBotSource({ seed: 18, skill: 1 }), fresh.runtime, 1).dash).not.toContain(true);
  });
});

describe("bot: brace", () => {
  function charge(): { runtime: GameRuntime; me: WrestlerRuntime; foe: WrestlerRuntime } {
    const runtime = arena(2);
    const [me, foe] = runtime.wrestlers;
    place(me, 0, 0);
    place(foe, 2.4, 0, -16, 0); // lunging straight at the bot
    foe.dashing = true;
    foe.dashTimeLeft = 0.25;
    return { runtime, me, foe };
  }

  it("braces when an opponent dashes at it from close by", () => {
    const { runtime } = charge();
    const { brace, last } = watch(createBotSource({ seed: 19, skill: 1 }), runtime, 0.2);
    expect(brace).toContain(true);
    expect(last.x).toBe(0);
    expect(last.y).toBe(0);
    expect(last.dash).toBe(false);
  });

  it("never holds the brace longer than the allowed hold", () => {
    const { runtime } = charge();
    const { brace } = watch(createBotSource({ seed: 20, skill: 1 }), runtime, 4);
    const held = brace.filter(Boolean).length * DT;
    expect(held).toBeGreaterThan(0.1);
    expect(held).toBeLessThanOrEqual(gameConfig.wrestler.brace.maxHoldSeconds);
    expect(brace[brace.length - 1]).toBe(false);
  });

  it("respects the brace cooldown", () => {
    const { runtime, me } = charge();
    me.braceCooldownLeft = 1.5;
    expect(watch(createBotSource({ seed: 21, skill: 1 }), runtime, 1).brace).not.toContain(true);
  });

  it("ignores dashes that are far away or aimed elsewhere", () => {
    const far = charge();
    place(far.foe, 5, 0, -16, 0);
    expect(watch(createBotSource({ seed: 22, skill: 1 }), far.runtime, 0.5).brace).not.toContain(true);

    const wide = charge();
    place(wide.foe, 2.4, 0, 0, 16);
    expect(watch(createBotSource({ seed: 22, skill: 1 }), wide.runtime, 0.5).brace).not.toContain(true);
  });

  it("reacts more slowly at low skill", () => {
    const firstBrace = (skill: number): number => {
      let total = 0;
      for (let seed = 0; seed < 20; seed++) {
        const { runtime } = charge();
        const { brace } = watch(createBotSource({ seed, skill }), runtime, 0.6);
        const index = brace.indexOf(true);
        total += index < 0 ? brace.length : index;
      }
      return total;
    };
    expect(firstBrace(1)).toBeLessThan(firstBrace(0.2));
  });
});

describe("bot: output contract", () => {
  it("is always finite and inside [-1, 1], whatever the scene", () => {
    const statuses = ["alive", "alive", "alive", "out", "idle"] as const;
    for (let scene = 0; scene < 40; scene++) {
      const runtime = arena(4);
      const bots = runtime.wrestlers.map((w) => createBotSource({ seed: scene * 4 + w.slot, skill: hash01(scene) }));
      const out = input();
      for (let stepIndex = 0; stepIndex < 120; stepIndex++) {
        const n = scene * 1000 + stepIndex * 40;
        runtime.cameraYaw = hash01(n) * 20 - 10;
        runtime.arenaRadius = [6, 5, 4][Math.floor(hash01(n + 1) * 3)];
        runtime.secondsLeft = hash01(n + 2) * 180;
        runtime.simTime += DT;
        for (const w of runtime.wrestlers) {
          const k = n + 3 + w.slot * 9;
          w.status = statuses[Math.floor(hash01(k) * statuses.length)];
          w.x = hash01(k + 1) * 16 - 8;
          w.z = hash01(k + 2) * 16 - 8;
          w.y = hash01(k + 3) < 0.8 ? BODY : hash01(k + 4) * 6 - 3;
          w.vx = hash01(k + 5) * 40 - 20;
          w.vz = hash01(k + 6) * 40 - 20;
          w.grounded = hash01(k + 7) < 0.8;
          w.dashing = hash01(k + 8) < 0.3;
          w.bracing = hash01(k + 9) < 0.2;
          w.facing = hash01(k + 10) * 7 - 3.5;
          w.dashCooldownLeft = hash01(k + 11) < 0.5 ? 0 : 1;
          w.braceCooldownLeft = hash01(k + 12) < 0.5 ? 0 : 1;
          w.invulnerableUntil = hash01(k + 13) < 0.2 ? runtime.simTime + 1 : 0;
        }
        const dt = [DT, 0.005, 0.0123, 0][Math.floor(hash01(n + 60) * 4)];
        for (const w of runtime.wrestlers) {
          bots[w.slot].sample(out, w.slot, runtime, dt);
          expect(Number.isFinite(out.x)).toBe(true);
          expect(Number.isFinite(out.y)).toBe(true);
          expect(Math.abs(out.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(out.y)).toBeLessThanOrEqual(1);
          expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(1 + 1e-9);
          expect(typeof out.dash).toBe("boolean");
          expect(typeof out.brace).toBe("boolean");
          if (w.status !== "alive") expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false });
        }
      }
    }
  });

  it("copes with stacked wrestlers and degenerate numbers", () => {
    const runtime = arena(2);
    const [me, foe] = runtime.wrestlers;
    place(me, 0, 0);
    place(foe, 0, 0); // exactly on top of each other, at the exact centre
    const bot = createBotSource({ seed: 23, skill: Number.NaN });
    const out = input();
    for (const dt of [DT, 0, -1, Number.NaN, 5]) {
      for (let i = 0; i < 30; i++) {
        bot.sample(out, 0, runtime, dt);
        expect(Number.isFinite(out.x)).toBe(true);
        expect(Number.isFinite(out.y)).toBe(true);
      }
    }
  });
});

describe("bot: determinism", () => {
  function record(seed: number | undefined, slot: PlayerSlot = 0): string {
    const runtime = arena(2);
    const me = runtime.wrestlers[slot];
    const foe = runtime.wrestlers[slot === 0 ? 1 : 0];
    place(me, -2, 1);
    place(foe, 2, -1);
    const sim = new MiniSim(runtime, new Map([[slot, createBotSource({ seed, skill: 0.4 })]]));
    const trace: number[] = [];
    for (let i = 0; i < 6 / DT; i++) {
      foe.x = 2 * Math.cos(i * 0.01);
      foe.z = -1 + 2 * Math.sin(i * 0.013);
      sim.step(DT);
      trace.push(me.x, me.z);
    }
    return trace.map((v) => v.toFixed(6)).join(",");
  }

  it("replays exactly for a given seed", () => {
    expect(record(42)).toBe(record(42));
    expect(record(7)).toBe(record(7));
  });

  it("plays differently with a different seed", () => {
    expect(record(42)).not.toBe(record(43));
  });

  it("seeds from the slot when no seed is given", () => {
    expect(record(undefined, 1)).toBe(record(1, 1));
    expect(record(undefined, 1)).not.toBe(record(0, 1));
  });
});
