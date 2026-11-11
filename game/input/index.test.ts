import { describe, expect, it } from "vitest";
import { GameRuntime } from "../runtime";
import type { ControlKind, PlayerInput } from "../types";
import { createInputSource } from "./index";

describe("createInputSource", () => {
  it("makes a source for every local control kind and none for remote", () => {
    const local: ControlKind[] = ["keyboardA", "keyboardB", "bot"];
    const runtime = new GameRuntime();
    for (const control of local) {
      const source = createInputSource(control);
      expect(source).not.toBeNull();
      // Nothing is pressed and there is no wrestler: every source reports neutral.
      const out: PlayerInput = { x: 9, y: 9, dash: true, brace: true };
      source?.sample(out, 0, runtime, 1 / 60);
      expect(out).toEqual({ x: 0, y: 0, dash: false, brace: false });
      source?.dispose?.();
      source?.dispose?.(); // idempotent
    }
    expect(createInputSource("remote")).toBeNull();
  });

  it("gives each player their own source", () => {
    const a = createInputSource("bot");
    const b = createInputSource("bot");
    expect(a).not.toBe(b);
  });
});
