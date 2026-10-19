/*
 * OKLCH (Björn Ottosson's Oklab, 2020, in polar form) for working out an appearance from one colour (Session 40):
 * lightness L from 0 to 1, chroma C, hue h in degrees. Steps in L look like even steps in lightness, so the
 * surfaces and words of an appearance are set by L, with only a trace of the accent's hue; and a colour out of
 * what a screen can show (sRGB) keeps its lightness and hue and gives up chroma until it fits.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** "#rrggbb" as OKLCH. */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = [1, 3, 5].map((at) => toLinear(parseInt(hex.slice(at, at + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** OKLCH as linear sRGB, which may be outside 0..1. */
function toLinearRgb({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH as "#rrggbb": lightness and hue kept, chroma given up until it is a colour a screen can show. */
export function oklchToHex(colour: Oklch): string {
  const l = Math.min(1, Math.max(0, colour.l));
  let lo = 0;
  let hi = Math.max(0, colour.c);
  if (!inGamut(toLinearRgb({ l, c: hi, h: colour.h }))) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(toLinearRgb({ l, c: mid, h: colour.h }))) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  const rgb = toLinearRgb({ l, c: hi, h: colour.h });
  return `#${rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
