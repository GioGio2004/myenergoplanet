// Asset manifest for the training-ground character.
// All files live in /public/energosimulation/. The character.fbx is the body
// (mesh + skeleton + skin); every other file is motion-only ("Without Skin"),
// downloaded In-Place so the CODE moves the character, not the animation.
export const CHARACTER_URL = "/energosimulation/character.fbx";

// Mixamo exports in centimetres → three.js works in metres. 0.01 is the classic fix.
export const CHARACTER_SCALE = 0.01;

export const CLIP_URLS = {
  // rifle-idle replaces the old empty-hands idle so the gun never "pops"
  // between states — every clip in the set holds the rifle.
  idle: "/energosimulation/rifle-idle.fbx",
  "run-forward": "/energosimulation/run-forward.fbx",
  "run-back": "/energosimulation/run-back.fbx",
  "strafe-left": "/energosimulation/strafe-left.fbx",
  "strafe-right": "/energosimulation/strafe-right.fbx",
  fire: "/energosimulation/fire.fbx",
  "fire-move": "/energosimulation/fire-move.fbx",
  reload: "/energosimulation/reload.fbx",
  jump: "/energosimulation/jump.fbx",
  "run-jump": "/energosimulation/run-jump.fbx",
} as const;

export type ClipName = keyof typeof CLIP_URLS;

// ── Weapon (Phase B) ─────────────────────────────────────────────────────────
// The rifle is a plain mesh (no skeleton) parented to the character's right
// hand BONE — every animation then carries it automatically. The offsets below
// are in the hand bone's local space, which for a Mixamo rig is in CENTIMETRES
// (the 0.01 root scale is applied above the bones).
export const GUN_URL = "/energosimulation/guns/Scar-H.glb";
// Scar-H.glb is ~9.8 units long; ×9 in bone space ≈ 0.88 m in world — real size.
// POS/ROT below were SOLVED numerically (not eyeballed): grip point pinned to the
// right palm, barrel aligned through the left support hand, measured live in the
// firing pose, then rolled 180° about the barrel (the aligner leaves roll free,
// which had the gun upside down). Re-solve if character/animations change.
export const GUN_SCALE = 9;
export const GUN_POS: [number, number, number] = [9.31, 5.48, -0.94];
export const GUN_ROT: [number, number, number] = [-3.1036, -0.1224, -1.3696];
// Muzzle tip in the gun's own local space (barrel runs along +X, tip ≈ +4.9).
export const MUZZLE_LOCAL: [number, number, number] = [4.9, 0.35, 0];

// ── Combat tuning ────────────────────────────────────────────────────────────
export const MAG_SIZE = 30;
export const FIRE_INTERVAL = 0.12; // s between shots (~500 rpm full-auto)
export const RECOIL_PITCH = 0.0075; // camera kick per shot (radians)
export const RANGE = 120; // hitscan max distance (m)
export const TARGET_HP = 3;
export const TARGET_RESPAWN = 3.0; // s
// ADS (right mouse button — aim down sights)
export const ADS_DIST = 2.1; // camera pulls in
export const ADS_FOV = 42; // from the default 55
export const ADS_SPEED_MULT = 0.55; // move slower while aiming

export const SOUND_URLS = {
  shot: "/energosimulation/guns/shot.mp3",
  reload: "/energosimulation/guns/reload.mp3",
  hit: "/energosimulation/guns/hit.mp3",
} as const;

// ── Jump ─────────────────────────────────────────────────────────────────────
export const JUMP_VELOCITY = 4.6; // m/s upward on take-off
export const GRAVITY = 13.0; // m/s² (gamey, snappier than 9.8)

// ── Movement tuning ──────────────────────────────────────────────────────────
export const RUN_SPEED = 5.0; // m/s
export const SPRINT_MULT = 1.5; // Shift
export const STRAFE_SPEED = 4.2; // sideways slightly slower, feels right
export const BACK_SPEED = 3.6; // backpedal slower, standard TPS
export const TURN_LERP = 14; // how fast the body aligns to the camera
export const FADE = 0.2; // animation crossfade seconds
export const ARENA_HALF = 27; // movement clamp (arena is 60×60)

// ── Camera tuning ────────────────────────────────────────────────────────────
export const CAM_DIST = 3.4; // metres behind the character
export const CAM_HEIGHT = 1.7; // pivot height (roughly her head)
export const CAM_SHOULDER = 0.55; // sideways offset → over-the-RIGHT-shoulder
export const MOUSE_SENS = 0.0024;
export const PITCH_MIN = -0.55; // look down limit (radians)
export const PITCH_MAX = 0.5; // look up limit
