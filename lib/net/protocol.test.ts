import { describe, expect, it } from "vitest";
import { decodeInput, encodeInput, isNewerSeq, parseHostMessage, parseSignal } from "./protocol";

describe("input packets", () => {
  it("round-trips stick and buttons", () => {
    const out = { x: 0, y: 0, dash: false, brace: false };
    const seq = decodeInput(encodeInput(42, { x: 0.5, y: -1, dash: true, brace: false }), out);
    expect(seq).toBe(42);
    expect(out.x).toBeCloseTo(0.5, 1);
    expect(out.y).toBe(-1);
    expect(out.dash).toBe(true);
    expect(out.brace).toBe(false);
  });

  it("clamps out-of-range and non-finite values", () => {
    const out = { x: 0, y: 0, dash: false, brace: true };
    decodeInput(encodeInput(1, { x: 9, y: Number.NaN, dash: false, brace: true }), out);
    expect(out.x).toBe(1);
    expect(out.y).toBe(0);
    expect(out.brace).toBe(true);
  });

  it("rejects short packets", () => {
    expect(decodeInput(new ArrayBuffer(2), { x: 0, y: 0, dash: false, brace: false })).toBe(-1);
  });

  it("orders sequence numbers across the 16-bit wrap", () => {
    expect(isNewerSeq(5, 4)).toBe(true);
    expect(isNewerSeq(4, 5)).toBe(false);
    expect(isNewerSeq(1, 65535)).toBe(true);
    expect(isNewerSeq(65535, 1)).toBe(false);
    expect(isNewerSeq(0, -1)).toBe(true);
  });
});

describe("messages", () => {
  it("parses host messages and ignores junk", () => {
    expect(parseHostMessage('{"t":"score","score":3}')).toEqual({ t: "score", score: 3 });
    expect(parseHostMessage("not json")).toBeNull();
    expect(parseHostMessage(new ArrayBuffer(1))).toBeNull();
  });

  it("parses signal payloads", () => {
    expect(parseSignal('{"sid":"a","candidate":{"candidate":"x"}}')?.sid).toBe("a");
    expect(parseSignal("{}")).toBeNull();
  });
});
