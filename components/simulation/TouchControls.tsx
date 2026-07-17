"use client";

import { useRef, useState } from "react";
import { simInput } from "@/components/simulation/input";

// PUBG-mobile-style touch layout:
//   left side  — virtual joystick (move)
//   right side — drag anywhere to look
//   buttons    — FIRE (big), AIM toggle, JUMP, RELOAD
// Every control tracks its own pointerId so multi-touch works (move + look +
// fire simultaneously). All writes go into the simInput singleton.

const JOY_SIZE = 132;
const KNOB = 56;

function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const apply = (clientX: number, clientY: number) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const max = r.width / 2 - KNOB / 2 + 8;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    setKnob({ x: dx, y: dy });
    simInput.moveX = -(dx / max); // screen-right drag → strafe right (local −X)
    simInput.moveZ = -(dy / max); // up on the stick → forward (+Z local)
  };

  return (
    <div
      ref={base}
      style={{
        width: JOY_SIZE,
        height: JOY_SIZE,
        borderRadius: "50%",
        background: "rgba(15, 22, 35, 0.55)",
        border: "2px solid var(--color-border)",
        position: "relative",
        touchAction: "none",
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => {
        pid.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pid.current !== e.pointerId) return;
        apply(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (pid.current !== e.pointerId) return;
        pid.current = null;
        setKnob({ x: 0, y: 0 });
        simInput.moveX = 0;
        simInput.moveZ = 0;
      }}
      onPointerCancel={(e) => {
        if (pid.current !== e.pointerId) return;
        pid.current = null;
        setKnob({ x: 0, y: 0 });
        simInput.moveX = 0;
        simInput.moveZ = 0;
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: KNOB,
          height: KNOB,
          borderRadius: "50%",
          background: "var(--color-accent)",
          boxShadow: "var(--glow-sm)",
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          pointerEvents: "none",
          opacity: 0.9,
        }}
      />
    </div>
  );
}

function ActionButton({
  label,
  size = 58,
  active = false,
  onDown,
  onUp,
}: {
  label: string;
  size?: number;
  active?: boolean;
  onDown: () => void;
  onUp?: () => void;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "rgba(249,115,22,0.85)" : "rgba(15, 22, 35, 0.65)",
        border: `2px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
        color: active ? "#000" : "var(--color-accent)",
        fontFamily: "var(--font-hud)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        touchAction: "none",
        pointerEvents: "auto",
        userSelect: "none",
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        onUp?.();
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        onUp?.();
      }}
    >
      {label}
    </div>
  );
}

export function TouchControls() {
  const lookPid = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });
  const [adsOn, setAdsOn] = useState(false);
  const [firingOn, setFiringOn] = useState(false);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Right-half look surface (buttons sit above it and stopPropagation) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "55%",
          touchAction: "none",
          pointerEvents: "auto",
        }}
        onPointerDown={(e) => {
          if (lookPid.current !== null) return;
          lookPid.current = e.pointerId;
          lastLook.current = { x: e.clientX, y: e.clientY };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (lookPid.current !== e.pointerId) return;
          simInput.lookDX += e.clientX - lastLook.current.x;
          simInput.lookDY += e.clientY - lastLook.current.y;
          lastLook.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (lookPid.current === e.pointerId) lookPid.current = null;
        }}
        onPointerCancel={(e) => {
          if (lookPid.current === e.pointerId) lookPid.current = null;
        }}
      />

      {/* Joystick — bottom left */}
      <div
        style={{
          position: "absolute",
          left: "max(20px, env(safe-area-inset-left, 0px))",
          bottom: "max(24px, calc(20px + env(safe-area-inset-bottom, 0px)))",
        }}
      >
        <Joystick />
      </div>

      {/* Action cluster — bottom right */}
      <div
        style={{
          position: "absolute",
          right: "max(18px, env(safe-area-inset-right, 0px))",
          bottom: "max(24px, calc(20px + env(safe-area-inset-bottom, 0px)))",
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ActionButton
            label="AIM"
            active={adsOn}
            onDown={() => {
              const next = !adsOn;
              setAdsOn(next);
              simInput.ads = next;
            }}
          />
          <ActionButton
            label="JUMP"
            onDown={() => {
              simInput.jumpQueued = true;
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ActionButton
            label="RELOAD"
            onDown={() => {
              simInput.reloadQueued = true;
            }}
          />
          <ActionButton
            label="FIRE"
            size={84}
            active={firingOn}
            onDown={() => {
              setFiringOn(true);
              simInput.firing = true;
            }}
            onUp={() => {
              setFiringOn(false);
              simInput.firing = false;
            }}
          />
        </div>
      </div>
    </div>
  );
}
