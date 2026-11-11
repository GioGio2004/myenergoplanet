import { NAME_MAX_LENGTH } from "@/convex/shared";

const ADJECTIVES = [
  "Swift", "Mighty", "Jolly", "Sleepy", "Brave", "Wobbly", "Golden", "Lucky",
  "Bouncy", "Gentle", "Sneaky", "Rolling", "Silent", "Fuzzy", "Royal", "Noble",
  "Steady", "Quick", "Plump", "Calm",
];

const NOUNS = [
  "Dumpling", "Bao", "Mochi", "Tofu", "Noodle", "Lotus", "Panda", "Lantern",
  "Pebble", "Crane", "Teapot", "Turnip", "Tiger", "Monk", "Bamboo", "Plum",
  "Ginger", "Kite", "Melon", "Rice Cake",
];

/** A random two-word name such as "Swift Dumpling", always within the name limit. */
export function randomFunName(random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const name = `${pick(ADJECTIVES, random)} ${pick(NOUNS, random)}`;
    if (name.length <= NAME_MAX_LENGTH) return name;
  }
  return pick(NOUNS, random);
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length) % list.length];
}
