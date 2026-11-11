import { describe, expect, it } from "vitest";
import { gameConfig } from "../config";
import { NEUTRAL_INPUT, type PlayerInput } from "../types";
import type { GameRuntime } from "../runtime";
import { createRemoteInputState, createRemoteSource } from "./remote";

const runtime = {} as GameRuntime;

describe("remote input source", () => {
  it("is neutral before any packet", () => {
    const out: PlayerInput = { x: 1, y: 1, dash: true, brace: true };
    createRemoteSource(createRemoteInputState(), () => 1000).sample(out, 0, runtime, 1 / 60);
    expect(out).toEqual(NEUTRAL_INPUT);
  });

  it("passes the latest packet through", () => {
    const state = createRemoteInputState();
    Object.assign(state, { x: 0.3, y: -0.7, dash: true, brace: false, receivedAt: 1000 });
    const out: PlayerInput = { ...NEUTRAL_INPUT };
    createRemoteSource(state, () => 1100).sample(out, 0, runtime, 1 / 60);
    expect(out).toEqual({ x: 0.3, y: -0.7, dash: true, brace: false });
  });

  it("goes neutral when packets stop", () => {
    const state = createRemoteInputState();
    Object.assign(state, { x: 1, y: 0, dash: false, brace: true, receivedAt: 1000 });
    const out: PlayerInput = { ...NEUTRAL_INPUT };
    const later = 1000 + gameConfig.wrestler.inputTimeoutMs + 1;
    createRemoteSource(state, () => later).sample(out, 0, runtime, 1 / 60);
    expect(out).toEqual(NEUTRAL_INPUT);
  });
});
