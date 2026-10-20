import { luminance } from '../contrast';
import { oklchToHex } from './oklch';

/*
 * The window's zones (Session 44; Priyansh found each colourful appearance "mostly one or two colours"): the left
 * column, the middle, the right column and the layer bar, each with surfaces of its own in a colour of its kind.
 * A zone's surfaces are the appearance's own in another hue, at the same luminance (WCAG's relative luminance; a
 * hair darker on a dark appearance and lighter on a light one, as hex rounds, and the controls' edges the other
 * way), so every ratio the rules measure on the appearance's surfaces is as good or better on a zone's: the
 * words, the controls' edges and LIVE's border read as well everywhere. A light appearance's near-white surfaces
 * can carry little pink or blue at their own luminance, so a zone may take its surfaces a little darker (or a
 * dark one's a little lighter) by a factor of their luminance, as far as the rules allow: rules.ts measures every
 * zone with every rule. Black and White have none: each zone is their own surfaces, so they draw exactly as
 * before.
 *
 * A zone's colours are written out in the appearance (appearances.ts), worked out by `zonesOf` from the tints
 * beside them (src/main/contrast.test.ts checks they are), so a window never works them out as it opens.
 */

export const ZONES = ['left', 'middle', 'right', 'bar'] as const;
export type Zone = (typeof ZONES)[number];

/** The zones, as people call them. */
export const ZONE_NAMES: Readonly<Record<Zone, string>> = {
  left: 'the left column',
  middle: 'the middle',
  right: 'the right column',
  bar: 'the layer bar',
};

/** What a zone sets over the window's own: its surfaces, its dividers and its controls' edges. */
export const ZONE_TOKENS = ['ink', 'panel', 'panel-2', 'panel-3', 'line', 'line-strong', 'field'] as const;
export type ZoneToken = (typeof ZONE_TOKENS)[number];
export type ZoneColours = Readonly<Record<ZoneToken, string>>;
export type Zones = Readonly<Record<Zone, ZoneColours>>;

/**
 * A zone's colour: its hue (OKLCH, degrees) and chroma, and how far its surfaces' luminance is taken from the
 * appearance's own (a factor, 1 when left out); null for the appearance's own surfaces.
 */
export type Tint = readonly [hue: number, chroma: number, luminance?: number] | null;
export type Tints = Readonly<Record<Zone, Tint>>;

/** Every zone the appearance's own surfaces (Black and White, and one a person makes). */
export function plainZones(colours: ZoneColours): Zones {
  const own: ZoneColours = Object.fromEntries(ZONE_TOKENS.map((t) => [t, colours[t]])) as ZoneColours;
  return { left: own, middle: own, right: own, bar: own };
}

/**
 * `hex` in another hue and chroma at its luminance (times `factor`): no lighter (`darker`) or no darker
 * (`lighter`), as near as hex allows. A chroma a screen cannot show at that lightness is given up until it can
 * (oklch.ts).
 */
export function rehue(
  hex: string,
  hue: number,
  chroma: number,
  side: 'darker' | 'lighter',
  factor = 1,
): string {
  const want = Math.min(1, luminance(hex) * factor);
  const at = (l: number) => oklchToHex({ l, c: chroma, h: hue });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(at(mid)) < want) lo = mid;
    else hi = mid;
  }
  const above = at(hi);
  if (side === 'lighter' || luminance(above) <= want) return above;
  return at(lo);
}

/** An appearance's zones: each tinted one's surfaces in its hue (as above), the others its own. */
export function zonesOf(colours: ZoneColours, dark: boolean, tints: Tints): Zones {
  const plain = plainZones(colours);
  const zone = (tint: Tint): ZoneColours => {
    if (tint === null) return plain.left;
    const [hue, chroma, factor = 1] = tint;
    return Object.fromEntries(
      ZONE_TOKENS.map((t) => {
        // The controls' edges stand out from the surfaces, so they round the other way.
        const surface = t !== 'field';
        const side = surface === dark ? 'darker' : 'lighter';
        return [t, rehue(colours[t], hue, chroma, side, factor)];
      }),
    ) as ZoneColours;
  };
  return {
    left: zone(tints.left),
    middle: zone(tints.middle),
    right: zone(tints.right),
    bar: zone(tints.bar),
  };
}
