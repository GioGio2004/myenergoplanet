"use client";

// Shared input singleton — the bridge between input devices and the Player.
// Desktop (keyboard/mouse in Player) and mobile (TouchControls) both WRITE
// here; the Player's frame loop READS it. Plain mutable object, never React
// state: input changes every frame and must not re-render anything.

export interface SimInput {
  // Movement from the virtual joystick, character-local: x right(+)/left(−),
  // z forward(+)/back(−), both in [−1, 1]. Keyboard is merged in by Player.
  moveX: number;
  moveZ: number;
  // Touch-look deltas (pixels), accumulated by TouchControls, consumed
  // (read + reset) once per frame by Player.
  lookDX: number;
  lookDY: number;
  // Held controls
  firing: boolean;
  ads: boolean;
  // One-shot requests, consumed by Player.
  jumpQueued: boolean;
  reloadQueued: boolean;
}

export const simInput: SimInput = {
  moveX: 0,
  moveZ: 0,
  lookDX: 0,
  lookDY: 0,
  firing: false,
  ads: false,
  jumpQueued: false,
  reloadQueued: false,
};

export function resetInput(): void {
  simInput.moveX = 0;
  simInput.moveZ = 0;
  simInput.lookDX = 0;
  simInput.lookDY = 0;
  simInput.firing = false;
  simInput.ads = false;
  simInput.jumpQueued = false;
  simInput.reloadQueued = false;
}
