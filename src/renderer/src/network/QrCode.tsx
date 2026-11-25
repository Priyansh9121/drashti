import { useMemo } from 'react';
import { encode } from 'uqr';
import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';

/**
 * A QR code, drawn as one SVG path from uqr's modules (black on white, with
 * a quiet border, so every phone camera reads it, in dark mode too). Private
 * in Report a Problem's picture (alpha.23): it carries a working code or key.
 */
export function QrCode({ text, label, size = 192 }: { text: string; label: string; size?: number }) {
  const { n, d } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 });
    let path = '';
    qr.data.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (!row[x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < row.length && row[x]) x++;
        path += `M${start} ${y}h${x - start}v1h${start - x}z`;
      }
    });
    return { n: qr.size, d: path };
  }, [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md"
      data-testid="qr-code"
      {...{ [REPORT_PRIVATE_ATTR]: '' }}
    >
      <rect width={n} height={n} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
