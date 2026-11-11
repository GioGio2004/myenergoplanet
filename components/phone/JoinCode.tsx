"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode } from "@/convex/shared";
import { SealStamp } from "@/components/motifs/SealStamp";

/** Fallback for phones that cannot scan: type the 4-character code from the big screen. */
export function JoinCode() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const code = normalizeRoomCode(value);

  function onChange(raw: string) {
    const filtered = raw
      .toUpperCase()
      .split("")
      .filter((c) => ROOM_CODE_ALPHABET.includes(c))
      .join("")
      .slice(0, ROOM_CODE_LENGTH);
    setValue(filtered);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code) router.push(`/play/${code}`);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-egyptian-blue px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <SealStamp size={52} />
        <h1 className="font-serif text-4xl text-rice-paper">Enter the room code</h1>
        <p className="text-stone-blue">It&rsquo;s on the big screen, under the QR code.</p>
      </div>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Room code"
          placeholder="ABCD"
          enterKeyHint="go"
          className="h-20 rounded-2xl bg-rice-paper text-center font-serif text-5xl font-semibold tracking-[0.4em] text-ink uppercase outline-none placeholder:text-ink/20 focus-visible:ring-2 focus-visible:ring-scarlet"
        />
        <button
          type="submit"
          disabled={!code}
          className="h-14 rounded-full bg-scarlet text-lg font-medium tracking-[0.18em] text-rice-paper uppercase transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-rice-paper disabled:opacity-40"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
