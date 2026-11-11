// Auspicious cloud scroll (xiangyun), line-drawn. Decorative only.
export function CloudScroll({
  width = 220,
  className = "",
  opacity = 0.22,
}: {
  width?: number;
  className?: string;
  opacity?: number;
}) {
  return (
    <svg
      width={width}
      viewBox="0 0 220 96"
      className={className}
      fill="none"
      stroke="var(--stone-blue)"
      strokeWidth="1.4"
      strokeLinecap="round"
      opacity={opacity}
      aria-hidden
    >
      {/* outer silhouette */}
      <path d="M18 78 C6 78 4 62 16 58 C12 44 28 36 40 44 C42 26 64 18 78 30 C86 12 116 10 126 30 C140 20 162 26 162 44 C178 38 196 50 190 64 C204 66 206 78 194 78 Z" />
      {/* curls */}
      <path d="M40 44 C48 46 52 56 46 60 C41 63 36 58 40 54 C42 52 45 54 44 56" />
      <path d="M78 30 C88 34 92 48 84 54 C77 59 70 52 74 47 C77 44 81 47 79 50" />
      <path d="M126 30 C134 36 134 50 126 54 C120 57 115 50 119 46 C122 43 125 46 123 49" />
      <path d="M162 44 C170 50 168 62 160 64 C155 65 152 59 156 56 C158 55 160 57 159 59" />
      {/* trailing wisp */}
      <path d="M194 78 C206 78 214 84 216 90" />
      <path d="M18 78 C10 80 6 86 6 92" />
    </svg>
  );
}
