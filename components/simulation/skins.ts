"use client";

// ── Skins ────────────────────────────────────────────────────────────────────
// Michelle's FBX uses ONE material atlas (Ch03_Body), so skins are full-body
// colour variants (team-colour style): the tint multiplies the diffuse texture.
// null tint = untouched original. The system is data-driven — to add REAL
// alternative characters later, give a skin its own `url` to a Mixamo T-pose
// FBX and the loaders pick it up.

export interface Skin {
  id: string;
  label: string;
  tint: string | null; // multiplied into the body material
  swatch: string; // UI colour
}

export const SKINS: Skin[] = [
  { id: "volt", label: "VOLT", tint: null, swatch: "#e9d24a" },
  { id: "ember", label: "EMBER", tint: "#ff9a76", swatch: "#ff6b4a" },
  { id: "ocean", label: "OCEAN", tint: "#7fb8ff", swatch: "#4a90ff" },
  { id: "acid", label: "ACID", tint: "#8dff9c", swatch: "#3ddb57" },
];

export function skinById(id: string | undefined | null): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

// ── Weapon finishes ──────────────────────────────────────────────────────────
// Tints multiplied into the SCAR-H materials (same technique as body skins).
export interface GunFinish {
  id: string;
  label: string;
  tint: string | null;
  swatch: string;
}

export const GUNS: GunFinish[] = [
  { id: "desert", label: "DESERT", tint: null, swatch: "#c8a06a" },
  { id: "night", label: "NIGHT", tint: "#5c6a7a", swatch: "#2c3a4a" },
  { id: "forest", label: "FOREST", tint: "#8fbf7f", swatch: "#3f7f3f" },
  { id: "gold", label: "GOLD", tint: "#ffd75e", swatch: "#e8b923" },
];

export function gunById(id: string | undefined | null): GunFinish {
  return GUNS.find((g) => g.id === id) ?? GUNS[0];
}
