import { describe, expect, it } from "vitest";
import type { HudCallout, HudPlayer } from "../types";
import { calloutSegments, formatClock, rankPlayers, scoreboard, tintNames } from "./hudLogic";

function player(slot: HudPlayer["slot"], name: string, score = 0): HudPlayer {
  return { slot, name, control: "bot", score, inPlay: true };
}

describe("formatClock", () => {
  it("formats whole seconds as m:ss", () => {
    expect(formatClock(180)).toBe("3:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(30)).toBe("0:30");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(0)).toBe("0:00");
  });

  it("clamps negatives, rounds fractions up and survives NaN", () => {
    expect(formatClock(-4)).toBe("0:00");
    expect(formatClock(59.2)).toBe("1:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});

describe("rankPlayers", () => {
  it("sorts by score, then by slot, without mutating the input", () => {
    const players = [player(0, "A", 2), player(1, "B", 5), player(2, "C", 2), player(3, "D", 0)];
    expect(rankPlayers(players).map((p) => p.slot)).toEqual([1, 0, 2, 3]);
    expect(players.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
  });
});

describe("scoreboard", () => {
  const summary = (entries: ReturnType<typeof scoreboard>) =>
    entries.map((e) => `${e.place}:${e.player.slot}`);

  it("puts the winner first and lets equal scores share a place", () => {
    const players = [player(0, "A", 2), player(1, "B", 5), player(2, "C", 2), player(3, "D", 0)];
    expect(summary(scoreboard(players, 1))).toEqual(["1:1", "2:0", "2:2", "4:3"]);
  });

  it("keeps a tie-break winner on top of players with the same score", () => {
    const players = [player(0, "A", 3), player(1, "B", 3), player(2, "C", 1)];
    expect(summary(scoreboard(players, 1))).toEqual(["1:1", "2:0", "3:2"]);
  });

  it("ranks a draw purely by score", () => {
    const players = [player(0, "A", 1), player(1, "B", 1), player(2, "C", 0)];
    expect(summary(scoreboard(players, null))).toEqual(["1:0", "1:1", "3:2"]);
  });

  it("ignores a winner slot that is not on the board", () => {
    const players = [player(0, "A", 1), player(1, "B", 2)];
    expect(summary(scoreboard(players, 3))).toEqual(["1:1", "2:0"]);
  });
});

describe("tintNames", () => {
  it("marks both names in order of appearance", () => {
    expect(
      tintNames("Scarlet knocked out Imperial Gold!", [
        { name: "Scarlet", slot: 0 },
        { name: "Imperial Gold", slot: 3 },
      ]),
    ).toEqual([
      { text: "Scarlet", slot: 0 },
      { text: " knocked out ", slot: null },
      { text: "Imperial Gold", slot: 3 },
      { text: "!", slot: null },
    ]);
  });

  it("does not let a short name claim the start of a longer one", () => {
    expect(
      tintNames("Bob was thrown out by Bo", [
        { name: "Bo", slot: 0 },
        { name: "Bob", slot: 1 },
      ]),
    ).toEqual([
      { text: "Bob", slot: 1 },
      { text: " was thrown out by ", slot: null },
      { text: "Bo", slot: 0 },
    ]);
  });

  it("handles two players with the same name", () => {
    expect(
      tintNames("Kai knocked out Kai!", [
        { name: "Kai", slot: 2 },
        { name: "Kai", slot: 1 },
      ]),
    ).toEqual([
      { text: "Kai", slot: 2 },
      { text: " knocked out ", slot: null },
      { text: "Kai", slot: 1 },
      { text: "!", slot: null },
    ]);
  });

  it("returns null when a name is missing", () => {
    expect(tintNames("Somebody fell off!", [{ name: "Kai", slot: 0 }])).toBeNull();
    expect(tintNames("Kai fell off!", [{ name: "", slot: 0 }])).toBeNull();
  });
});

describe("calloutSegments", () => {
  const players = [player(0, "Scarlet"), player(1, "  "), player(3, "Imperial Gold")];

  it("tints the wording that came from the rules", () => {
    const callout: HudCallout = {
      id: 1,
      victim: 3,
      by: 0,
      text: "Scarlet knocked out Imperial Gold!",
    };
    const segments = calloutSegments(callout, players);
    expect(segments.map((s) => s.text).join("")).toBe(callout.text);
    expect(segments.filter((s) => s.slot !== null).map((s) => s.slot)).toEqual([0, 3]);
  });

  it("tints a self knockout", () => {
    const segments = calloutSegments(
      { id: 2, victim: 0, by: null, text: "Scarlet fell off!" },
      players,
    );
    expect(segments).toEqual([
      { text: "Scarlet", slot: 0 },
      { text: " fell off!", slot: null },
    ]);
  });

  it("builds its own sentence when the names cannot be found", () => {
    // Slot 1 has a blank name, so the rules' text starts with whitespace.
    const segments = calloutSegments(
      { id: 3, victim: 0, by: 1, text: "   knocked out Scarlet!" },
      players,
    );
    expect(segments.map((s) => s.text).join("")).toBe("Stone Blue knocked out Scarlet!");
    expect(segments[0]).toEqual({ text: "Stone Blue", slot: 1 });

    expect(
      calloutSegments({ id: 4, victim: 3, by: null, text: "" }, players)
        .map((s) => s.text)
        .join(""),
    ).toBe("Imperial Gold fell off!");
  });
});
