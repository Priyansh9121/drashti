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
