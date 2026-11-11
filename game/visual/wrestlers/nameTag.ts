// ─────────────────────────────────────────────────────────────────────────────
// Name tag: the player's name on a pill in the player colour, floating above the
// head and always facing the camera (a sprite). Drawn with the 2D canvas and the
// page's own fonts, so nothing is fetched from the network.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { PALETTE, type PlayerStyle } from "../../config";

/** Canvas pixels. The tag is ~45 px tall on a 1080p screen, so this is ample. */
const PILL_HEIGHT = 92;
const POINTER_HEIGHT = 20;
const POINTER_HALF_WIDTH = 17;
const PAD_X = 36;
const OUTLINE = 7;
const MARGIN = 6;
const FONT_SIZE = 54;
const MAX_TEXT_WIDTH = 520;
/** Same stack as the app's `font-sans`: self-hosted Inter, else the system UI font. */
const FONT = `700 ${FONT_SIZE}px "Inter Variable", ui-sans-serif, system-ui, sans-serif`;

/** World-space height of the whole tag (pill + pointer) at the reference distance. */
const WORLD_HEIGHT = 0.58;

/** Shorten `text` with an ellipsis until it fits `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join("") + "…").width > maxWidth) chars.pop();
  return chars.join("") + "…";
}

/** Pill with a small pointer at the bottom centre, as one closed path. */
function tracePill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const r = height / 2;
  const cx = x + width / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arc(x + width - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(cx + POINTER_HALF_WIDTH, y + height);
  ctx.lineTo(cx, y + height + POINTER_HEIGHT);
  ctx.lineTo(cx - POINTER_HALF_WIDTH, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
}

export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private texture: THREE.CanvasTexture | null = null;
  private name: string | null = null;
  /** Width / height of the current canvas. */
  private aspect = 2;

  constructor(private readonly style: PlayerStyle) {
    this.material = new THREE.SpriteMaterial({
      transparent: true,
      // Always readable: never hidden behind another wrestler or the scenery.
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = "wrestler-name-tag";
    this.sprite.center.set(0.5, 0); // anchored at the tip of the pointer
    this.sprite.renderOrder = 10;
    this.sprite.frustumCulled = false;
    this.sprite.visible = false;
  }

  /** True once a name has been drawn. */
  get ready(): boolean {
    return this.texture !== null;
  }

  /** (Re)draw the tag. The texture is recreated only when the name actually changes. */
  setName(name: string): void {
    if (name === this.name && this.texture) return;
    this.name = name;
    this.redraw();
    // If the web font is still loading the canvas used a fallback: redraw once it is in.
    if (typeof document !== "undefined" && document.fonts && !document.fonts.check(FONT)) {
      document.fonts.load(FONT).then(
        () => {
          if (this.name === name && this.texture) this.redraw();
        },
        () => {
          // The fallback font is perfectly fine.
        },
      );
    }
  }

  private redraw(): void {
    if (this.name === null || typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.font = FONT;
    const label = fitText(ctx, this.name.trim() || this.style.label, MAX_TEXT_WIDTH);
    const textWidth = Math.ceil(ctx.measureText(label).width);
    const pillWidth = Math.max(textWidth + PAD_X * 2, PILL_HEIGHT * 1.5);
    const inset = MARGIN + OUTLINE / 2;
    canvas.width = Math.ceil(pillWidth + inset * 2);
    canvas.height = Math.ceil(PILL_HEIGHT + POINTER_HEIGHT + inset * 2);

    // Resizing the canvas resets the context state.
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    tracePill(ctx, inset, inset, pillWidth, PILL_HEIGHT);
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = PALETTE.ink;
    ctx.stroke();
    ctx.fillStyle = this.style.color;
    ctx.fill();
    // A hairline in the glow tint just inside the edge: a soft, lacquered look.
    tracePill(ctx, inset + 5, inset + 5, pillWidth - 10, PILL_HEIGHT - 10);
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = this.style.glow;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = this.style.ink;
    ctx.fillText(label, canvas.width / 2, inset + PILL_HEIGHT / 2 + FONT_SIZE * 0.04);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    this.texture?.dispose();
    this.texture = texture;
    this.aspect = canvas.width / canvas.height;
    // Going from no map to a map changes the sprite's shader variant.
    if (this.material.map === null) this.material.needsUpdate = true;
    this.material.map = texture;
  }

  /** Position the tip of the tag and size it; `zoom` compensates for camera distance. */
  place(x: number, y: number, z: number, zoom: number): void {
    const height = WORLD_HEIGHT * zoom;
    this.sprite.position.set(x, y, z);
    this.sprite.scale.set(height * this.aspect, height, 1);
    this.sprite.visible = this.texture !== null;
  }

  hide(): void {
    this.sprite.visible = false;
  }

  dispose(): void {
    // three's dispose only frees GPU memory: the tag keeps working if it is shown again.
    this.texture?.dispose();
    this.material.dispose();
  }
}
