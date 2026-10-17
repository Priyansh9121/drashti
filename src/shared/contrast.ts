/*
 * WCAG 2's contrast (Session 26): how far apart two colours are in
 * lightness, from 1 (the same) to 21 (black and white). Drashti's built-in
 * themes keep every word at 7:1 or more against its background, for dim
 * halls and washed-out projectors (builtin-themes.test.ts).
 */

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** The relative luminance of "#rrggbb": 0 for black, 1 for white. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** The contrast ratio between two "#rrggbb" colours, either way round. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` at `alpha` over `bottom`, mixed in sRGB as browsers draw it ("#rrggbb"). */
export function over(top: string, alpha: number, bottom: string): string {
  const mix = [1, 3, 5].map((at) => {
    const t = parseInt(top.slice(at, at + 2), 16);
    const b = parseInt(bottom.slice(at, at + 2), 16);
    return Math.round(t * alpha + b * (1 - alpha));
  });
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** A colour with black over it at `strength` (Sessions 31–36, SLD-3: darkening behind the words). */
export const darkened = (color: string, strength: number): string => over('#000000', strength, color);

/** Words read from the back of the hall at this contrast or more; below it the editor warns. */
export const WORDS_CONTRAST_MIN = 4.5;
/** What Drashti aims for (its own themes keep it): 7:1. */
export const WORDS_CONTRAST_AIM = 7;

/** Words' contrast against what is behind them: the background, darkened as the slide or theme darkens it. */
export function wordsContrast(
  words: string,
  background: string,
  darken?: { strength: number } | null,
): number {
  return contrastRatio(words, darken ? darkened(background, darken.strength) : background);
}

/*
 * How far apart two colours look (Session 26g): CIEDE2000 (Sharma, Wu and Dalal 2005), in usual
 * colour vision and as people without working red, green or blue cones see them (Machado,
 * Oliveira and Fernandes 2009, severity 1, on linear sRGB). Drashti keeps the primary and the
 * default group colours at least 10 from LIVE and ON AIR in all four.
 */

export type Vision = 'usual' | 'protanopia' | 'deuteranopia' | 'tritanopia';
export const VISIONS: readonly Vision[] = ['usual', 'protanopia', 'deuteranopia', 'tritanopia'];

const MACHADO: Record<Exclude<Vision, 'usual'>, readonly (readonly [number, number, number])[]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const linearRgb = (hex: string): [number, number, number] => [
  channel(hex, 1),
  channel(hex, 3),
  channel(hex, 5),
];
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A colour as someone with this colour vision sees it ("#rrggbb"). */
export function seenWith(hex: string, vision: Vision): string {
  if (vision === 'usual') return hex.toLowerCase();
  const lin = linearRgb(hex);
  const out = MACHADO[vision].map((row) =>
    Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])),
  );
  return `#${out
    .map((c) =>
      Math.round(gamma(c) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** CIELAB (D65) of "#rrggbb". */
export function toLab(hex: string): [number, number, number] {
  const [r, g, b] = linearRgb(hex);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 between two CIELAB colours. */
export function deltaE00Lab(
  [L1, a1, b1]: readonly [number, number, number],
  [L2, a2, b2]: readonly [number, number, number],
): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const [ap1, ap2] = [(1 + G) * a1, (1 + G) * a2];
  const [Cp1, Cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (bb: number, ap: number) => (bb === 0 && ap === 0 ? 0 : (Math.atan2(bb, ap) / rad + 360) % 360);
  const [hp1, hp2] = [hue(b1, ap1), hue(b2, ap2)];
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = hp2 - hp1;
  if (Cp1 * Cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cpm = (Cp1 + Cp2) / 2;
  let hm = hp1 + hp2;
  if (Cp1 * Cp2 !== 0)
    hm = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2;
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cpm;
  const SH = 1 + 0.015 * Cpm * T;
  const RT =
    -2 *
    Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) *
    Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** CIEDE2000 between two "#rrggbb" colours, as someone with this colour vision sees them. */
export function deltaE00(a: string, b: string, vision: Vision = 'usual'): number {
  return deltaE00Lab(toLab(seenWith(a, vision)), toLab(seenWith(b, vision)));
}

/** The smallest of the four distances, and the colour vision it is in. */
export function leastDistance(a: string, b: string): { deltaE: number; vision: Vision } {
  return VISIONS.map((vision) => ({ deltaE: deltaE00(a, b, vision), vision })).reduce((x, y) =>
    y.deltaE < x.deltaE ? y : x,
  );
}
