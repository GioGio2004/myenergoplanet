import { describe, expect, it } from "vitest";
import type { PlayerSetup } from "../types";
import {
  commitSlotName,
  controlOf,
  displayName,
  nextControl,
  playersNeeded,
  sanitizeName,
  setSlotControl,
  setSlotName,
} from "./lobbyLogic";

const TWO: PlayerSetup[] = [
  { slot: 0, name: "Scarlet", control: "keyboardA" },
  { slot: 1, name: "Stone Blue", control: "keyboardB" },
];

describe("nextControl", () => {
  it("cycles Off, Keyboard A, Keyboard B, Bot and wraps", () => {
    expect(nextControl("off")).toBe("keyboardA");
    expect(nextControl("keyboardA")).toBe("keyboardB");
    expect(nextControl("keyboardB")).toBe("bot");
    expect(nextControl("bot")).toBe("off");
  });

  it("steps a phone-controlled slot to off", () => {
    expect(nextControl("remote")).toBe("off");
  });
});

describe("setSlotControl", () => {
  it("adds a new slot with the colour name and keeps the list sorted", () => {
    const next = setSlotControl(TWO, 3, "bot");
    expect(next.map((s) => s.slot)).toEqual([0, 1, 3]);
    expect(next[2]).toEqual({ slot: 3, name: "Imperial Gold", control: "bot" });

    const again = setSlotControl(next, 2, "bot");
    expect(again.map((s) => s.slot)).toEqual([0, 1, 2, 3]);
    expect(again[2].name).toBe("Rice White");
  });

  it("removes a slot when switched off", () => {
    const next = setSlotControl(TWO, 0, "off");
    expect(next).toEqual([TWO[1]]);
    expect(controlOf(next, 0)).toBe("off");
  });

  it("moves a keyboard scheme and turns the previous holder into a bot", () => {
    const next = setSlotControl(TWO, 2, "keyboardA");
    expect(controlOf(next, 2)).toBe("keyboardA");
    expect(controlOf(next, 0)).toBe("bot");
    expect(controlOf(next, 1)).toBe("keyboardB");
    expect(next.filter((s) => s.control === "keyboardA")).toHaveLength(1);
  });

  it("swapping a scheme between two keyboard slots leaves one of each kind at most", () => {
    const next = setSlotControl(TWO, 1, "keyboardA");
    expect(controlOf(next, 1)).toBe("keyboardA");
    expect(controlOf(next, 0)).toBe("bot");
  });

  it("allows any number of bots", () => {
    const next = setSlotControl(setSlotControl(TWO, 2, "bot"), 3, "bot");
    expect(next.filter((s) => s.control === "bot")).toHaveLength(2);
    expect(controlOf(next, 0)).toBe("keyboardA");
  });

  it("keeps the existing name when only the control changes", () => {
    const named = setSlotName(TWO, 0, "Mochi");
    expect(setSlotControl(named, 0, "bot")[0]).toEqual({ slot: 0, name: "Mochi", control: "bot" });
  });

  it("restores a remembered name, falling back to the colour name when blank", () => {
    expect(setSlotControl(TWO, 2, "bot", "Mochi")[2].name).toBe("Mochi");
    expect(setSlotControl(TWO, 2, "bot", "   ")[2].name).toBe("Rice White");
  });

  it("never mutates its input", () => {
    const snapshot = JSON.stringify(TWO);
    setSlotControl(TWO, 1, "keyboardA");
    setSlotControl(TWO, 0, "off");
    setSlotName(TWO, 0, "x");
    expect(JSON.stringify(TWO)).toBe(snapshot);
  });
});

describe("names", () => {
  it("caps names at 14 characters and collapses whitespace", () => {
    expect(sanitizeName("abcdefghijklmnopqrstuvwxyz")).toBe("abcdefghijklmn");
    expect(sanitizeName("  Big    Wave ")).toBe("Big Wave ");
  });

  it("does not split a surrogate pair at the limit", () => {
    const name = sanitizeName("abcdefghijklm\u{1F30A}\u{1F30A}");
    expect(Array.from(name)).toHaveLength(14);
    expect(name.endsWith("\u{1F30A}")).toBe(true);
  });

  it("renames only the given slot", () => {
    const next = setSlotName(TWO, 1, "Kai");
    expect(next[0].name).toBe("Scarlet");
    expect(next[1].name).toBe("Kai");
  });

  it("allows a blank name while typing but commits the colour name", () => {
    const blank = setSlotName(TWO, 0, "");
    expect(blank[0].name).toBe("");
    expect(displayName(blank[0].name, 0)).toBe("Scarlet");
    expect(commitSlotName(blank, 0)[0].name).toBe("Scarlet");
    expect(commitSlotName(setSlotName(TWO, 0, "Kai "), 0)[0].name).toBe("Kai");
  });
});

describe("playersNeeded", () => {
  it("counts the missing players up to the minimum", () => {
    expect(playersNeeded([])).toBe(2);
    expect(playersNeeded([TWO[0]])).toBe(1);
    expect(playersNeeded(TWO)).toBe(0);
    expect(playersNeeded(setSlotControl(TWO, 2, "bot"))).toBe(0);
  });
});
