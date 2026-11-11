"use client";

import { useMemo } from "react";
import QRCode from "qrcode";

/** Crisp SVG QR code. Square modules, Egyptian blue on whatever sits behind it. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    let d = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.modules.get(r, c)) {
          c++;
          continue;
        }
        const start = c;
        while (c < n && qr.modules.get(r, c)) c++;
        d += `M${start} ${r}h${c - start}v1h-${c - start}z`;
      }
    }
    return { size: n, path: d };
  }, [value]);

  return (
    <svg
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className="block h-full w-full"
    >
      <path d={path} fill="var(--egyptian-blue)" />
    </svg>
  );
}
