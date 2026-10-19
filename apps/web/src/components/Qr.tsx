import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A crisp SVG QR code (vouchers are scanned by the dealer app). */
export function Qr({ value, size = 160, color = "#023448" }: { value: string; size?: number; color?: string }) {
  const { n, cells } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(value);
    q.make();
    const count = q.getModuleCount();
    const dark: [number, number][] = [];
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) dark.push([c, r]);
    return { n: count, cells: dark };
  }, [value]);
  const pad = 2;
  return (
    <svg width={size} height={size} viewBox={`${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}`} role="img" aria-label={`QR code for ${value}`} shapeRendering="crispEdges">
      <rect x={-pad} y={-pad} width={n + pad * 2} height={n + pad * 2} fill="#fff" />
      <path d={cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("")} fill={color} />
    </svg>
  );
}
