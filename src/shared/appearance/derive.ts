import { contrastRatio, deltaE00, over, VISIONS } from '../contrast';
import type { Appearance, AppearanceBase, Colours, Decoration, OwnAppearance } from './appearances';
import { DARK_STATES, LIGHT_STATES } from './appearances';
import { hexToOklch, oklchToHex, type Oklch } from './oklch';
import { appearanceProblems, measureDistances } from './rules';
import { plainZones } from './zones';

/*
 * A person's own appearance (Session 40): made in the Appearance window from a base (dark or light) and one
 * colour, the accent, for the next thing to do. Drashti works out every other token from those two: the surfaces
 * and words at set lightnesses (OKLCH) with a trace of the accent's hue, the focus ring a tint of the accent, the
 * primary the accent itself (made lighter or darker only as far as its words need), and the states as every
 * appearance of that base has them. Then every rule is measured (rules.ts): an accent that fails is refused in
 * plain words, with the nearest accent that passes offered.
 *
 * Session 42: its decoration too, from the same accent. A header in a deep shade of it with light words, a band of
 * the primary, a light tint and a neighbouring hue, and a second colour (for what marks) and headings in the hue
 * nearest the accent's that is kept apart from every state; each is moved in lightness as far as its rules need,
 * so the decoration always passes and only the primary can be refused.
 */

export type { OwnAppearance } from './appearances';
export const OWN_PREFIX = 'own-';
/** How many a computer keeps. */
export const OWN_MAX = 20;
export const OWN_NAME_MAX = 40;

const shift = (c: Oklch, dl: number): Oklch => ({ ...c, l: Math.min(1, Math.max(0, c.l + dl)) });

/**
 * The colour moved in lightness (by `step`, towards `dir`) until it meets `ratio` against every colour in
 * `against`, or as far as it can go.
 */
function reach(colour: Oklch, against: readonly string[], ratio: number, dir: 1 | -1, step = 0.01): string {
  let c = colour;
  for (let i = 0; i < 100; i++) {
    const hex = oklchToHex(c);
    if (against.every((bg) => contrastRatio(hex, bg) >= ratio)) return hex;
    if ((dir > 0 && c.l >= 1) || (dir < 0 && c.l <= 0)) return hex;
    c = shift(c, dir * step);
  }
  return oklchToHex(c);
}

/** Every token of an appearance made from a base and an accent. */
export function deriveColours(base: AppearanceBase, accentHex: string): Colours {
  const a = hexToOklch(accentHex);
  const dark = base === 'dark';
  const surfaceChroma = Math.min(dark ? 0.025 : 0.03, a.c * (dark ? 0.18 : 0.2));
  const tone = (l: number, c = surfaceChroma): Oklch => ({ l, c, h: a.h });
  const hex = (l: number, c = surfaceChroma) => oklchToHex(tone(l, c));

  const ink = hex(dark ? 0.155 : 0.925);
  const panel = hex(dark ? 0.185 : 0.975, dark ? surfaceChroma : surfaceChroma * 0.6);
  const panel2 = hex(dark ? 0.225 : 0.995, dark ? surfaceChroma : surfaceChroma * 0.3);
  const panel3 = hex(dark ? 0.27 : 0.895);
  const surfaces = [ink, panel, panel2, panel3];
  const line = hex(dark ? 0.3 : 0.875);
  const lineStrong = hex(dark ? 0.38 : 0.78);
  const away: 1 | -1 = dark ? 1 : -1;
  const field = reach(tone(dark ? 0.62 : 0.52), surfaces, 3.05, away);
  const fg = reach(tone(dark ? 0.975 : 0.19, 0.01), [panel], 15.05, away, 0.005);
  const muted = reach(tone(dark ? 0.86 : 0.37, 0.02), [panel, panel2], 7.05, away);
  const faint = reach(tone(dark ? 0.75 : 0.47, 0.02), surfaces, 4.55, away);
  const ring = reach(
    { l: dark ? 0.82 : 0.46, c: Math.min(a.c, dark ? 0.12 : 0.16), h: a.h },
    surfaces,
    4.55,
    away,
  );

  // The primary is the accent, made lighter or darker only as far as its words need: dark words on a light
  // accent, white on a dark one, whichever reads better.
  const darkWords = hex(0.16, 0.02);
  const onPrimary =
    contrastRatio(accentHex, darkWords) >= contrastRatio(accentHex, '#ffffff') ? darkWords : '#ffffff';
  const towards: 1 | -1 = onPrimary === '#ffffff' ? -1 : 1;
  const primary = reach(a, [onPrimary], 4.6, towards, 0.005);
  const p = hexToOklch(primary);
  const primaryHi = reach(shift(p, 0.035), [onPrimary], 4.6, towards, 0.005);
  const primaryLo = reach(shift(p, -0.045), [onPrimary], 4.6, towards, 0.005);
  // A strong secondary's edge: the primary's colour, as far from the surfaces as controls' edges must be.
  const primaryEdge = reach(hexToOklch(primaryHi), [ink, panel, panel2], 3.05, away, 0.005);

  return {
    ink,
    panel,
    'panel-2': panel2,
    'panel-3': panel3,
    line,
    'line-strong': lineStrong,
    field,
    fg,
    muted,
    faint,
    accent: ring,
    'primary-hi': primaryHi,
    primary,
    'primary-lo': primaryLo,
    'on-primary': onPrimary,
    'primary-edge': primaryEdge,
    ...(dark ? DARK_STATES : LIGHT_STATES),
  };
}

/** An appearance made from a base and an accent (and a second colour, if one was chosen), under an id and a name. */
export function madeAppearance(
  id: string,
  name: string,
  base: AppearanceBase,
  accent: string,
  second?: string,
): Appearance {
  const colours = deriveColours(base, accent);
  // Its zones are its own surfaces (Session 44): one made from one colour keeps to it there.
  return {
    id,
    name,
    base,
    colours,
    decoration: deriveDecoration(base, accent, colours, second),
    zones: plainZones(colours),
  };
}

/** The least CIEDE2000 between two colours over the four colour visions. */
const apart = (x: string, y: string) => Math.min(...VISIONS.map((v) => deltaE00(x, y, v)));

/** A colour that marks: 3:1 from every surface, and from the chosen row's own and outer surface at 70%. */
function marks(colour: Oklch, c: Colours, dark: boolean): string {
  const surfaces = [c.ink, c.panel, c['panel-2'], c['panel-3']];
  let at = colour;
  for (let i = 0; i < 100; i++) {
    const hex = oklchToHex(at);
    const row = over(hex, 0.7, c['panel-3']);
    if (
      surfaces.every((bg) => contrastRatio(hex, bg) >= 3.05) &&
      contrastRatio(row, c['panel-3']) >= 3.05 &&
      contrastRatio(row, c.panel) >= 3.05
    )
      return hex;
    if ((dark && at.l >= 1) || (!dark && at.l <= 0)) return hex;
    at = shift(at, dark ? 0.01 : -0.01);
  }
  return oklchToHex(at);
}
const markApart = (x: string, c: Colours) =>
  apart(x, c.live) >= 10.05 &&
  apart(x, c.warning) >= 10.05 &&
  apart(x, c.success) >= 7.05 &&
  apart(x, c.danger) >= 7.05;
const headingApart = (x: string, c: Colours) =>
  apart(x, c.live) >= 10.05 &&
  apart(x, c.onair) >= 10.05 &&
  apart(x, c.warning) >= 10.05 &&
  apart(x, c.danger) >= 7.05;

/**
 * The decoration of an appearance made from a base and an accent (Session 42), with a second colour of one's own
 * if one was chosen: kept in its hue, moved in lightness only as far as its rules need (checkAccent says if it is
 * still too close to a state).
 */
export function deriveDecoration(
  base: AppearanceBase,
  accentHex: string,
  c: Colours,
  chosenSecond?: string,
): Decoration {
  const a = hexToOklch(accentHex);
  const dark = base === 'dark';
  const chroma = Math.min(a.c, 0.12);
  // The header: as deep a shade of the accent as its words, its controls and a warning button need.
  let header = '';
  let words = '';
  let buttons = '';
  for (let l = dark ? 0.36 : 0.34; l >= 0.12; l -= 0.01) {
    header = oklchToHex({ l, c: chroma, h: a.h });
    words = reach({ l: 0.97, c: Math.min(chroma, 0.015), h: a.h }, [header], 4.6, 1, 0.005);
    buttons = reach({ l: 0.87, c: Math.min(chroma, 0.04), h: a.h }, [header], 4.6, 1, 0.005);
    const seen = (x: string, y: string) =>
      Math.max(contrastRatio(x, header), contrastRatio(y, header)) >= 3.05;
    if (
      contrastRatio(words, header) >= 4.6 &&
      contrastRatio(buttons, header) >= 4.6 &&
      seen(c.field, c['panel-2']) &&
      seen(c.warning, c['warning-bg'])
    )
      break;
  }
  // What marks and the headings: the hue nearest the accent's that stands apart from every state.
  const hueOf = (dh: number): Oklch => ({
    l: a.l,
    c: Math.min(Math.max(a.c, 0.08), 0.14),
    h: (a.h + dh + 360) % 360,
  });
  const surfaces = [c.ink, c.panel, c['panel-2'], c['panel-3']];
  let second = c.muted;
  let heading = c.muted;
  if (chosenSecond !== undefined) {
    second = marks(hexToOklch(chosenSecond), c, dark);
    heading = reach(hexToOklch(second), surfaces, 4.6, dark ? 1 : -1, 0.005);
  } else
    for (const dh of [40, -40, 80, -80, 120, -120, 180, 0]) {
      const mark = marks(hueOf(dh), c, dark);
      const words = reach(hexToOklch(mark), surfaces, 4.6, dark ? 1 : -1, 0.005);
      if (markApart(mark, c) && headingApart(words, c)) {
        second = mark;
        heading = words;
        break;
      }
    }
  const tint = oklchToHex({ l: dark ? 0.9 : 0.92, c: Math.min(chroma, 0.06), h: a.h });
  return {
    header,
    'on-header': words,
    'on-header-muted': buttons,
    'header-ring': words,
    'header-field': buttons,
    second,
    heading,
    // A flat header, no title strips, and the layer buttons as before (Session 44).
    'header-2': header,
    strip: c.panel,
    'strip-2': c.panel,
    layer: c['panel-2'],
    'layer-edge': c.line,
    band: [c.primary, tint, oklchToHex({ ...a, h: (a.h + 40) % 360 })],
  };
}

export function deriveAppearance(own: OwnAppearance): Appearance {
  return madeAppearance(own.id, own.name, own.base, own.accent, own.second);
}

/** What each state is, in words, for a colour too close to it. */
const STATE_WORDS: Record<string, string> = {
  live: 'LIVE’s red',
  onair: 'ON AIR’s violet',
  warning: 'a warning’s amber',
  success: 'the green that says something worked',
  danger: 'the red for removing and deleting',
};

/** "a", "a and b", "a, b and c". */
const inWords = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

export interface AccentCheck {
  ok: boolean;
  /** In plain words: why it is refused (empty when it is not). */
  why: string;
  /** Every rule it fails, for the curious. */
  problems: string[];
  /** The nearest colour that passes, when this one does not (null when none is near). */
  nearest: string | null;
  /** Which colour is refused (Session 42): the next thing to do's, or the second colour; null when neither. */
  which: 'accent' | 'second' | null;
}

/** The second colour's and the headings' rules (rules.ts). */
const ofSecond = (rule: string) => /^(second|heading|the chosen row)/u.test(rule);

/**
 * Whether an accent on this base (with a second colour of one's own, if chosen) meets every rule; if not, which
 * colour is refused, why, and the nearest one that does.
 */
export function checkAccent(base: AppearanceBase, accent: string, second?: string): AccentCheck {
  const made = madeAppearance('own-check', 'Check', base, accent, second);
  const problems = appearanceProblems(made);
  if (problems.length === 0) return { ok: true, why: '', problems, nearest: null, which: null };
  const which = second !== undefined && problems.every(ofSecond) ? 'second' : 'accent';
  const near = [
    ...new Set(
      measureDistances(made)
        .filter((m) => !m.ok && ofSecond(m.what) === (which === 'second'))
        .map((m) => STATE_WORDS[m.what.split(' vs ')[1] ?? ''] ?? ''),
    ),
  ].filter((w) => w !== '');
  if (which === 'second')
    return {
      ok: false,
      why:
        near.length > 0
          ? `This second colour is too close to ${inWords(near)}, so what it marks could be taken for it. Use the nearest colour that works, or choose another.`
          : 'Words in this second colour would be too hard to read. Use the nearest colour that works, or choose another.',
      problems,
      nearest: second === undefined ? null : nearestSecond(base, accent, second),
      which,
    };
  const why =
    near.length > 0
      ? `This colour is too close to ${inWords(near)}, so the next thing to do could be taken for it. Use the nearest colour that works, or choose another.`
      : 'Words on this colour would be too hard to read. Use the nearest colour that works, or choose another.';
  return { ok: false, why, problems, nearest: nearestAccent(base, accent, second), which };
}

/** Colours round this one, nearest first (CIEDE2000): other hues, lightnesses and strengths. */
function around(colour: string): string[] {
  const a = hexToOklch(colour);
  const candidates: string[] = [];
  for (let dh = -90; dh <= 90; dh += 6)
    for (const dl of [0, -0.04, 0.04, -0.08, 0.08, -0.12, 0.12, -0.18, 0.18])
      for (const cs of [1, 0.75, 0.5, 0.25])
        candidates.push(
          oklchToHex({ l: Math.min(0.95, Math.max(0.2, a.l + dl)), c: a.c * cs, h: (a.h + dh + 360) % 360 }),
        );
  return [...new Set(candidates)]
    .map((hex) => ({ hex, d: deltaE00(hex, colour) }))
    .sort((x, y) => x.d - y.d)
    .map((c) => c.hex);
}

/** The accent nearest this one (CIEDE2000) that meets every rule on this base, or null. */
export function nearestAccent(base: AppearanceBase, accent: string, second?: string): string | null {
  for (const hex of around(accent))
    if (appearanceProblems(madeAppearance('own-check', 'Check', base, hex, second)).length === 0) return hex;
  return null;
}

/** The second colour nearest this one that meets every rule with this accent on this base, or null. */
export function nearestSecond(base: AppearanceBase, accent: string, second: string): string | null {
  for (const hex of around(second))
    if (appearanceProblems(madeAppearance('own-check', 'Check', base, accent, hex)).length === 0) return hex;
  return null;
}
