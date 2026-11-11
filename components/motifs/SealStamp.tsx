// Red seal (chop): the logo mark and confirmation element.
// The glyph is a stylised 力 ("strength") drawn as strokes so it needs no CJK font.
export function SealStamp({
  size = 44,
  className = "",
  inverted = false,
}: {
  size?: number;
  className?: string;
  /** Rice-paper seal with scarlet strokes, for use on scarlet surfaces. */
  inverted?: boolean;
}) {
  const fill = inverted ? "var(--rice-paper)" : "var(--scarlet)";
  const ink = inverted ? "var(--scarlet)" : "var(--rice-paper)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="44" height="44" rx="9" fill={fill} />
      <rect
        x="6"
        y="6"
        width="36"
        height="36"
        rx="6"
        fill="none"
        stroke={ink}
        strokeWidth="1.6"
        opacity="0.9"
      />
      {/* 力: hooked horizontal-and-vertical, then the long left-falling sweep */}
      <path
        d="M14 18 H33 C33 26 32.5 32 30.5 35.5 C29.6 37 28 37.2 25.5 35.8"
        fill="none"
        stroke={ink}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 11.5 C24 22 21 31 13.5 37"
        fill="none"
        stroke={ink}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
