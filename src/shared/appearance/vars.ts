import type { Appearance } from './appearances';
import { BAND_MAX, COLOUR_TOKENS, DECORATION_TOKENS } from './appearances';
import { ZONE_TOKENS, ZONES } from './zones';

/*
 * An appearance as the CSS custom properties it sets on a window's <html> (Sessions 39–40): every --color-*
 * token, and the tints of the shadows (--depth-*), which app.css's @theme shadows are made of. The shadows'
 * shapes never change with the appearance, only their colours, so a change of appearance never asks the
 * graphics chip for a new way of drawing (app.css, "Depth"): on dark surfaces they are black; on light ones a
 * soft grey; the live picture's glow is the live colour's and the primary's its own colour's.
 *
 * Session 42: the decoration's colours too (--color-header and the rest), and the band as BAND_MAX flat blocks:
 * --color-band-N and --band-N (1 for a block that is there, 0 for one that is not, as its share of the width),
 * and --band-height, 0px for an appearance with no band (Black and White), so nothing is drawn or moved there.
 *
 * Session 44: each zone's colours (--zone-<zone>-<token>, which app.css's [data-zone] sets over the window's own
 * there), and the two gradients: --header-image, from the header's colour to its far end (none when they are the
 * same), and --strip-image for the panels' title strips (none where both ends are the panel's, Black and White).
 */

/** The band's height, when there is one. */
export const BAND_HEIGHT = '6px';

/** "#rrggbb" at an alpha, as "#rrggbbaa" (rounded to 1/255, as Tailwind writes the @theme's own). */
export function tint(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex.toLowerCase()}${a.toString(16).padStart(2, '0')}`;
}

/** The shadows' tints, by base: what lies beneath (shade), light from above, and the glows' strengths. */
const DEPTH = {
  dark: { shade: '#000000', card: 0.7, ring: 0.3, overlay: 0.8, thumb: 0.55, light: 0.03, glow: 1 },
  light: { shade: '#0f1219', card: 0.2, ring: 0.1, overlay: 0.3, thumb: 0.22, light: 0.5, glow: 0.6 },
} as const;

/** Every custom property the appearance sets, by name. */
export function appearanceVars(a: Appearance): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of COLOUR_TOKENS) vars[`--color-${name}`] = a.colours[name];
  for (const name of DECORATION_TOKENS) vars[`--color-${name}`] = a.decoration[name];
  const band = a.decoration.band;
  for (let i = 0; i < BAND_MAX; i++) {
    vars[`--color-band-${String(i + 1)}`] = band[i] ?? 'transparent';
    vars[`--band-${String(i + 1)}`] = band[i] === undefined ? '0' : '1';
  }
  vars['--band-height'] = band.length > 0 ? BAND_HEIGHT : '0px';
  for (const zone of ZONES)
    for (const name of ZONE_TOKENS) vars[`--zone-${zone}-${name}`] = a.zones[zone][name];
  vars['--header-image'] = headerImage(a);
  vars['--strip-image'] = stripImage(a);
  const d = DEPTH[a.base];
  const white = (alpha: number) => tint('#ffffff', alpha);
  Object.assign(vars, {
    '--depth-light': white(d.light),
    '--depth-light-thumb': white(d.light + 0.01),
    '--depth-card': tint(d.shade, d.card),
    '--depth-ring': tint(d.shade, d.ring),
    '--depth-overlay': tint(d.shade, d.overlay),
    '--depth-thumb': tint(d.shade, d.thumb),
    '--depth-live': tint(a.colours.live, 0.5 * d.glow),
    '--depth-live-thumb': tint(a.colours.live, 0.7 * d.glow),
    '--depth-primary-top': white(0.22),
    '--depth-primary-ring': white(0.1),
    '--depth-primary': tint(a.colours.primary, 0.6 * d.glow),
    '--depth-primary-top-hover': white(0.28),
    '--depth-primary-ring-hover': white(0.18),
    '--depth-primary-hover': tint(a.colours.primary, 0.8 * d.glow),
  });
  return vars;
}

/** The header's gradient, left to right, or none for a flat header (Session 44). */
export function headerImage(a: Appearance): string {
  const d = a.decoration;
  return d.header === d['header-2'] ? 'none' : `linear-gradient(90deg, ${d.header}, ${d['header-2']})`;
}

/** Whether an appearance draws the panels' title strips: not where both ends are its panel (Session 44). */
export const hasStrips = (a: Appearance): boolean =>
  a.decoration.strip !== a.colours.panel || a.decoration['strip-2'] !== a.colours.panel;

/** The title strips' gradient, left to right, or none. */
export function stripImage(a: Appearance): string {
  const d = a.decoration;
  return hasStrips(a) ? `linear-gradient(90deg, ${d.strip}, ${d['strip-2']})` : 'none';
}
