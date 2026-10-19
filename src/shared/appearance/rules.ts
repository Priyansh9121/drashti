import { contrastRatio, deltaE00, VISIONS, type Vision } from '../contrast';
import type { Appearance, ColourToken } from './appearances';

/*
 * The rules every appearance meets (Sessions 39–40), from Drashti's design rules (docs/design.md §2): text at
 * 4.5:1 or more on every surface, every fill with its text, control edges at 3:1 where controls sit, the
 * design lab's stronger aims (the words at 15:1 on panels, secondary words at 7:1), and the primary kept
 * apart from LIVE, ON AIR and a warning (CIEDE2000, at least 10, for usual colour vision and simulated
 * protanopia, deuteranopia and tritanopia) and from success and danger (at least 7). Ratios are compared
 * unrounded (2.999 fails 3). The built-in appearances are measured by src/main/contrast.test.ts; one a person
 * makes is measured as it is made, and refused when it fails (Session 40).
 */

type Colour = ColourToken | 'white' | 'black';

export interface ContrastRule {
  what: string;
  fg: Colour;
  bg: Colour;
  min: number;
  /** Where the rule comes from. */
  source: string;
}

const SURFACES = ['ink', 'panel', 'panel-2', 'panel-3'] as const;
/** Where controls sit: the window, panels, and raised cards and dialogs' fields. */
const CONTROL_SURFACES = ['ink', 'panel', 'panel-2'] as const;
/** Text colours that must read on every surface. */
const TEXT = [
  'fg',
  'muted',
  'faint',
  'accent',
  'danger',
  'warning-fg',
  'success-fg',
  'danger-fg',
  'rec',
] as const;
/** Fills, with the text drawn on them. */
const FILLS: readonly (readonly [Colour, ColourToken])[] = [
  ['white', 'live'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-hi'],
  ['on-primary', 'primary-lo'],
  ['white', 'onair'],
  ['white', 'danger-strong'],
  ['warning-fg', 'warning-bg'],
  ['success-fg', 'success-bg'],
  ['danger-fg', 'danger-bg'],
  ['fg', 'warning-bg'],
  ['fg', 'danger-bg'],
  // The setup wizard's step numbers, in the window's own colour on the accent.
  ['ink', 'accent'],
];

/**
 * Each Button variant's edge as drawn (ui/Button.tsx; contrast.test.ts checks the classes say so): the colour
 * of its border, solid, over its own background.
 */
export const BUTTON_EDGES = {
  secondary: 'field',
  strong: 'primary-edge',
  danger: 'danger',
  warning: 'warning',
} as const satisfies Record<string, ColourToken>;

export const CONTRAST_RULES: readonly ContrastRule[] = [
  { what: 'words on panels', fg: 'fg', bg: 'panel', min: 15, source: 'design.md (fg 15:1 on panels)' },
  { what: 'secondary words on panels', fg: 'muted', bg: 'panel', min: 7, source: 'design.md (muted 7:1)' },
  { what: 'secondary words on cards', fg: 'muted', bg: 'panel-2', min: 7, source: 'design.md (muted 7:1)' },
  ...TEXT.flatMap((fg) =>
    SURFACES.map((bg) => ({ what: `${fg} on ${bg}`, fg, bg, min: 4.5, source: 'WCAG 1.4.3' })),
  ),
  ...FILLS.map(([fg, bg]) => ({ what: `${fg} on ${bg}`, fg, bg, min: 4.5, source: 'WCAG 1.4.3 (a fill)' })),
  ...SURFACES.map((bg) => ({
    what: `focus ring vs ${bg}`,
    fg: 'accent' as const,
    bg,
    min: 3,
    source: 'WCAG 1.4.11',
  })),
  ...SURFACES.map((bg) => ({
    what: `control edge vs ${bg}`,
    fg: 'field' as const,
    bg,
    min: 3,
    source: 'WCAG 1.4.11',
  })),
  ...Object.entries(BUTTON_EDGES).flatMap(([variant, edge]) =>
    CONTROL_SURFACES.map((bg) => ({
      what: `${variant} button’s edge vs ${bg}`,
      fg: edge,
      bg,
      min: 3,
      source: 'WCAG 1.4.11 (ui/Button.tsx)',
    })),
  ),
  {
    what: 'live border vs panel (live row, thumbnail)',
    fg: 'live',
    bg: 'panel',
    min: 3,
    source: 'WCAG 1.4.11',
  },
  {
    what: 'live border vs the black slide inside it',
    fg: 'live',
    bg: 'black',
    min: 3,
    source: 'WCAG 1.4.11',
  },
  { what: 'live (lit clear dot) vs panel-2', fg: 'live', bg: 'panel-2', min: 3, source: 'WCAG 1.4.11' },
  { what: 'warning (Stopped rail) vs panel-2', fg: 'warning', bg: 'panel-2', min: 3, source: 'WCAG 1.4.11' },
];

/** Colours that must never be confused: [what, colour, colour, the least CIEDE2000 in any colour vision]. */
export const DISTANCE_RULES: readonly (readonly [string, ColourToken, ColourToken, number])[] = [
  ...(['primary', 'primary-hi', 'primary-lo', 'primary-edge'] as const).flatMap((p) =>
    (['live', 'onair', 'warning'] as const).map((s) => [`${p} vs ${s}`, p, s, 10] as const),
  ),
  ['primary vs success', 'primary', 'success', 7],
  ['primary vs danger', 'primary', 'danger', 7],
];

export interface Measured {
  what: string;
  /** "fg #f5f5f7 on panel #121215", or the two colours compared. */
  colours: string;
  value: number;
  min: number;
  /** For a distance, the colour vision it is least in. */
  vision?: Vision;
  source: string;
  ok: boolean;
}

/** An appearance's colour by its name (white and black as themselves). */
export function colourOf(a: Appearance, name: Colour): string {
  if (name === 'white') return '#ffffff';
  if (name === 'black') return '#000000';
  return a.colours[name];
}

/** Every contrast rule, measured on one appearance. */
export function measureContrast(a: Appearance): Measured[] {
  return CONTRAST_RULES.map((r) => {
    const fg = colourOf(a, r.fg);
    const bg = colourOf(a, r.bg);
    const value = contrastRatio(fg, bg);
    return {
      what: r.what,
      colours: `${r.fg} ${fg} on ${r.bg} ${bg}`,
      value,
      min: r.min,
      source: r.source,
      ok: value >= r.min,
    };
  });
}

/** Every distance rule, measured on one appearance: the least of the four colour visions. */
export function measureDistances(a: Appearance): Measured[] {
  return DISTANCE_RULES.map(([what, x, y, min]) => {
    const each = VISIONS.map((v) => deltaE00(a.colours[x], a.colours[y], v));
    const value = Math.min(...each);
    return {
      what,
      colours: `${x} ${a.colours[x]} and ${y} ${a.colours[y]}`,
      value,
      min,
      vision: VISIONS[each.indexOf(value)] ?? 'usual',
      source: 'CIEDE2000, usual and simulated colour vision (Machado 2009)',
      ok: value >= min,
    };
  });
}

/** What an appearance fails, in a line each ("muted on panel: 4.31, at least 7"); empty when it meets them all. */
export function appearanceProblems(a: Appearance): string[] {
  const cut = (v: number, places: number) => (Math.floor(v * 10 ** places) / 10 ** places).toFixed(places);
  return [
    ...measureContrast(a)
      .filter((m) => !m.ok)
      .map((m) => `${m.what}: ${cut(m.value, 2)}:1, at least ${String(m.min)}:1`),
    ...measureDistances(a)
      .filter((m) => !m.ok)
      .map((m) => `${m.what}: ${cut(m.value, 1)} (${m.vision ?? 'usual'}), at least ${String(m.min)}`),
  ];
}
