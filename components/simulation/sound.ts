"use client";

import { SOUND_URLS } from "@/components/simulation/anims";

// ── WebAudio sound playback ──────────────────────────────────────────────────
// HTMLAudioElement.play() runs on the main thread with real per-call latency
// and janks badly on mobile when fired 8×/second. WebAudio decodes each clip
// once into an AudioBuffer; playing is then a near-free node hookup that the
// browser mixes off the main thread — overlapping shots come for free, no
// pooling or currentTime resets needed.

type SoundName = keyof typeof SOUND_URLS;

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let loading = false;

export function initSounds(): void {
  if (loading || typeof window === "undefined") return;
  loading = true;
  ctx = new AudioContext();
  (Object.keys(SOUND_URLS) as SoundName[]).forEach(async (name) => {
    try {
      const res = await fetch(SOUND_URLS[name]);
      const data = await res.arrayBuffer();
      const buf = await ctx!.decodeAudioData(data);
      buffers.set(name, buf);
    } catch {
      // missing/undecodable clip → that sound just stays silent
    }
  });
}

export function playSound(name: SoundName, volume: number): void {
  if (!ctx) return;
  // Browsers create the context suspended until a user gesture; every play
  // call is gesture-driven (fire/reload), so resuming here always succeeds.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const buf = buffers.get(name);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
