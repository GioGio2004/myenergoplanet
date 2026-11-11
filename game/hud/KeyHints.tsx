"use client";

import { KEYBOARD_SCHEMES } from "../input/schemes";

const ACTIONS = [
  { id: "move", label: "Move" },
  { id: "dash", label: "Dash" },
  { id: "brace", label: "Brace" },
] as const;

/**
 * Move / Dash / Brace keys of one keyboard scheme. Sized in `em`.
 * - `inline`: label and key side by side, for a single-line strip.
 * - `stacked`: label above key, for narrow cards.
 */
export function KeyHints({
  scheme,
  layout = "inline",
  className = "",
}: {
  scheme: "keyboardA" | "keyboardB";
  layout?: "inline" | "stacked";
  className?: string;
}) {
  const hint = KEYBOARD_SCHEMES[scheme].hint;
  const stacked = layout === "stacked";
  return (
    <dl className={`flex items-end ${stacked ? "gap-[0.9em]" : "gap-[1.1em]"} ${className}`}>
      {ACTIONS.map((action) => (
        <div
          key={action.id}
          className={stacked ? "flex flex-col items-start gap-[0.3em]" : "flex items-center gap-[0.5em]"}
        >
          <dt className="text-[0.72em] leading-none tracking-[0.16em] text-stone-blue uppercase">
            {action.label}
          </dt>
          <dd>
            <kbd className="block rounded-[0.5em] border border-stone-blue/40 bg-ink/45 px-[0.55em] py-[0.22em] font-sans leading-tight whitespace-nowrap text-rice-paper">
              {hint[action.id]}
            </kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}
