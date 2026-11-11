// Thin lattice-window fret (回 pattern) used as a hairline divider.
export function LatticeBand({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="100%"
      height="12"
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <pattern id="lattice-fret" width="24" height="12" patternUnits="userSpaceOnUse">
          <path
            d="M0 11 H6 V1 H18 V8 H10 V5 H14 M18 11 H24"
            fill="none"
            stroke="var(--stone-blue)"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="12" fill="url(#lattice-fret)" opacity="0.45" />
    </svg>
  );
}
