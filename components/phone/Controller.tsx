"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import type { PlayerStyle } from "@/game/config";
import type { PhoneTransport } from "@/lib/net/phoneTransport";
import type { HostMessage } from "@/lib/net/protocol";

const STICK_RADIUS = 64;
const STICK_DEADZONE = 0.08;

type Cooldowns = { dash: number; brace: number; bracing: boolean; braceLeft: number };
type Flash = { id: number; text: string; tone: "good" | "bad" };

/**
 * The in-match phone controller: a floating joystick on the left half, DASH and BRACE on
 * the right. Renders no 3D — just DOM, pointer events and a few CSS transitions.
 */
export function Controller({
  transport,
  style,
  name,
  pointsToWin,
}: {
  transport: PhoneTransport;
  style: PlayerStyle;
  name: string;
  pointsToWin: number;
}) {
  const link = useSyncExternalStore(transport.subscribe, transport.getState, () => "connecting" as const);
  const mode = useSyncExternalStore(transport.subscribe, transport.getMode, () => null);
  const [score, setScore] = useState(0);
  const [cooldowns, setCooldowns] = useState<Cooldowns>({ dash: 0, brace: 0, bracing: false, braceLeft: 0 });
  const [flash, setFlash] = useState<Flash | null>(null);

  // Current controller state; every change is pushed straight to the transport.
  const input = useRef({ x: 0, y: 0, dash: false, brace: false });
  const push = () => {
    const i = input.current;
    transport.setInput(i.x, i.y, i.dash, i.brace);
  };

  // ── host → phone events ──────────────────────────────────────────────────
  useEffect(() => {
    let flashId = 0;
    return transport.onMessage((msg: HostMessage) => {
      switch (msg.t) {
        case "score":
          setScore(msg.score);
          break;
        case "scored":
          setFlash({ id: ++flashId, text: `You knocked out ${msg.victim}!`, tone: "good" });
          vibrate(60);
          break;
        case "ko":
          setFlash({ id: ++flashId, text: msg.by ? `${msg.by} got you!` : "You fell off!", tone: "bad" });
          vibrate([120, 60, 220]);
          break;
        case "cd":
          setCooldowns({ dash: msg.d, brace: msg.b, bracing: msg.br, braceLeft: msg.bl });
          break;
        case "vibrate":
          vibrate(msg.ms);
          break;
        case "phase":
          if (msg.phase === "intro") setScore(0);
          break;
      }
    });
  }, [transport]);

  // Clear the flash a moment after it appears.
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(id);
  }, [flash]);

  // ── keep the phone awake, stop page scrolling/zooming while playing ──────
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Not available (insecure origin, iOS < 16.4, battery saver): fine.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      root.style.overscrollBehavior = prev;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  // ── keyboard fallback (testing from a desktop browser) ───────────────────
  useEffect(() => {
    const keys = new Set<string>();
    const apply = () => {
      const x = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      const y = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      const len = Math.hypot(x, y) || 1;
      const i = input.current;
      i.x = x / len;
      i.y = y / len;
      i.dash = keys.has("Space") || keys.has("Enter");
      i.brace = keys.has("KeyE") || keys.has("Period");
      transport.setInput(i.x, i.y, i.dash, i.brace);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      keys.add(e.code);
      apply();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      apply();
    };
    const clear = () => {
      keys.clear();
      apply();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [transport]);

  // ── joystick ─────────────────────────────────────────────────────────────
  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const stick = useRef<{ pointer: number | null; ox: number; oy: number }>({ pointer: null, ox: 0, oy: 0 });

  function stickDown(e: PointerEvent<HTMLDivElement>) {
    if (stick.current.pointer !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = zone.current!.getBoundingClientRect();
    stick.current = { pointer: e.pointerId, ox: e.clientX, oy: e.clientY };
    const b = base.current!;
    b.style.left = `${e.clientX - rect.left}px`;
    b.style.top = `${e.clientY - rect.top}px`;
    b.style.opacity = "1";
    knob.current!.style.transform = "translate(-50%, -50%)";
  }

  function stickMove(e: PointerEvent<HTMLDivElement>) {
    const s = stick.current;
    if (s.pointer !== e.pointerId) return;
    let dx = e.clientX - s.ox;
    let dy = e.clientY - s.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    knob.current!.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const mag = Math.min(len, STICK_RADIUS) / STICK_RADIUS;
    const i = input.current;
    if (mag < STICK_DEADZONE) {
      i.x = 0;
      i.y = 0;
    } else {
      i.x = dx / STICK_RADIUS;
      i.y = -dy / STICK_RADIUS; // up the screen = forward
    }
    push();
  }

  function stickUp(e: PointerEvent<HTMLDivElement>) {
    if (stick.current.pointer !== e.pointerId) return;
    stick.current.pointer = null;
    base.current!.style.opacity = "0";
    input.current.x = 0;
    input.current.y = 0;
    push();
  }

  // ── buttons (held while the finger is down) ──────────────────────────────
  function press(e: PointerEvent<HTMLButtonElement>, button: "dash" | "brace", down: boolean) {
    if (down) e.currentTarget.setPointerCapture(e.pointerId);
    if (input.current[button] === down) return;
    input.current[button] = down;
    if (down && button === "dash") vibrate(15);
    push();
  }

  const dashReady = cooldowns.dash <= 0.001;
  const braceReady = cooldowns.brace <= 0.001 || cooldowns.bracing;

  return (
    <div
      className="fixed inset-0 flex touch-none flex-col overflow-hidden select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
      style={{
        background: `radial-gradient(120% 90% at 30% 20%, ${style.color} 0%, ${style.belt} 75%)`,
        color: style.ink,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* top bar */}
      <div className="flex items-center justify-between gap-4 px-5 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-label={link === "open" ? "Connected" : "Connecting"}
            className={`size-2.5 shrink-0 rounded-full ${link === "open" ? "bg-[#7BE0A0]" : "animate-pulse bg-rice-paper/60"}`}
          />
          <span className="truncate font-serif text-xl">{name}</span>
          {mode && (
            <span className="shrink-0 text-[0.65rem] tracking-[0.2em] uppercase opacity-60">
              {mode === "direct" ? "direct" : "Wi-Fi relay"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5" aria-label={`Score ${score} of ${pointsToWin}`}>
          {Array.from({ length: pointsToWin }, (_, i) => (
            <span
              key={i}
              className="size-3 rounded-full border transition-colors duration-300"
              style={{ borderColor: style.ink, background: i < score ? style.ink : "transparent" }}
            />
          ))}
        </div>
      </div>

      {link !== "open" && (
        <p className="mx-auto rounded-full bg-ink/40 px-4 py-1 text-sm text-rice-paper">
          {link === "reconnecting" ? "Reconnecting…" : "Connecting to the big screen…"}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* left half: floating joystick */}
        <div
          ref={zone}
          className="relative h-full w-1/2"
          onPointerDown={stickDown}
          onPointerMove={stickMove}
          onPointerUp={stickUp}
          onPointerCancel={stickUp}
        >
          <span className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs tracking-[0.3em] uppercase opacity-50">
            Move
          </span>
          <div
            ref={base}
            className="pointer-events-none absolute size-36 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 opacity-0 transition-opacity duration-150"
            style={{ borderColor: style.ink, background: "rgba(1,16,31,0.18)" }}
          >
            <div
              ref={knob}
              className="absolute top-1/2 left-1/2 size-16 rounded-full shadow-lg"
              style={{ background: style.ink, transform: "translate(-50%, -50%)" }}
            />
          </div>
        </div>

        {/* right half: DASH and BRACE */}
        <div className="flex h-full w-1/2 items-center justify-center gap-5 pr-[max(env(safe-area-inset-right),16px)]">
          <CooldownButton
            label="Brace"
            hint="hold"
            fraction={cooldowns.bracing ? 1 - cooldowns.braceLeft : cooldowns.brace}
            ready={braceReady}
            active={cooldowns.bracing}
            className="size-24 self-end mb-[18%] text-sm"
            fill="#629CC5"
            text="#01101F"
            onDown={(e) => press(e, "brace", true)}
            onUp={(e) => press(e, "brace", false)}
          />
          <CooldownButton
            label="Dash"
            fraction={cooldowns.dash}
            ready={dashReady}
            active={false}
            className="size-36 text-xl"
            fill="#EC2F36"
            text="#F2EAD8"
            onDown={(e) => press(e, "dash", true)}
            onUp={(e) => press(e, "dash", false)}
          />
        </div>
      </div>

      {flash && (
        <div
          key={flash.id}
          className="pointer-events-none absolute inset-0 flex animate-[flash_1.6s_ease-out_forwards] items-center justify-center p-8 text-center"
          style={{ background: flash.tone === "good" ? "rgba(242,234,216,0.35)" : "rgba(1,16,31,0.55)" }}
        >
          <p className="font-serif text-4xl leading-tight" style={{ color: flash.tone === "good" ? "#01101F" : "#F2EAD8" }}>
            {flash.text}
          </p>
        </div>
      )}
    </div>
  );
}

function CooldownButton({
  label,
  hint,
  fraction,
  ready,
  active,
  className,
  fill,
  text,
  onDown,
  onUp,
}: {
  label: string;
  hint?: string;
  /** 0 = ready, 1 = just used. Shown as an ink sweep over the button. */
  fraction: number;
  ready: boolean;
  active: boolean;
  className: string;
  fill: string;
  text: string;
  onDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onUp: (e: PointerEvent<HTMLButtonElement>) => void;
}) {
  const sweep = Math.max(0, Math.min(1, fraction)) * 360;
  return (
    <button
      type="button"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      className={`relative grid shrink-0 touch-none place-items-center overflow-hidden rounded-full border-2 font-medium tracking-[0.18em] uppercase shadow-[0_10px_30px_-10px_rgba(1,16,31,0.7)] transition-transform duration-100 active:scale-95 ${className}`}
      style={{
        background: fill,
        color: text,
        borderColor: "rgba(242,234,216,0.85)",
        boxShadow: active ? `0 0 0 6px rgba(242,234,216,0.45)` : undefined,
      }}
    >
      {!ready && (
        <span
          aria-hidden
          className="absolute inset-0"
          style={{ background: `conic-gradient(rgba(1,16,31,0.55) ${sweep}deg, transparent 0deg)` }}
        />
      )}
      <span className="relative flex flex-col items-center leading-tight">
        {label}
        {hint && <span className="text-[0.6rem] tracking-[0.2em] opacity-70">{hint}</span>}
      </span>
    </button>
  );
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iOS has no vibration API.
  }
}
