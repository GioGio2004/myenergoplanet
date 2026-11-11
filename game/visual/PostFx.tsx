"use client";

import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

/**
 * Light post-processing for the High preset: subtle bloom on emissive accents,
 * filmic tone mapping (the composer disables the renderer's own) and a vignette.
 *
 * Mounted/unmounted rather than toggled with `enabled`: unmounting disposes the
 * buffers and restores the renderer's tone mapping and auto-clear.
 */
export function PostFx({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <EffectComposer multisampling={4}>
      <Bloom
        mipmapBlur
        levels={5}
        radius={0.7}
        luminanceThreshold={1}
        luminanceSmoothing={0.25}
        intensity={0.55}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.62} />
    </EffectComposer>
  );
}
