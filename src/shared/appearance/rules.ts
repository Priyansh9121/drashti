import { contrastRatio, deltaE00, over, VISIONS, type Vision } from '../contrast';
import type { Appearance, ColourToken, DecorationToken } from './appearances';
import { BAND_MAX } from './appearances';
import { hexToOklch } from './oklch';

/*
 * The rules every appearance meets (Sessions 39–40), from Drashti's design rules (docs/design.md §2): text at
 * 4.5:1 or more on every surface, every fill with its text, control edges at 3:1 where controls sit, the
 * design lab's stronger aims (the words at 15:1 on panels, secondary words at 7:1), and the primary kept
 * apart from LIVE, ON AIR and a warning (CIEDE2000, at least 10, for usual colour vision and simulated
 * protanopia, deuteranopia and tritanopia) and from success and danger (at least 7). Ratios are compared
 * unrounded (2.999 fails 3). The built-in appearances are measured by src/main/contrast.test.ts; one a person
 * makes is measured as it is made, and refused when it fails (Session 40).
 *
 * Session 42, the decoration (appearances.ts): the header's words at 4.5:1 on it, and the focus ring, a control's
 * edge and a warning button (by its edge or its fill) at 3:1 there; section headings' words at 4.5:1 on every surface; the second
 * colour at 3:1 wherever it marks something, as it is drawn (the chosen row's edge is drawn at 70%); and the second
 * colour and the headings kept apart from the states as the primary is (the second colour from all but ON AIR,
 * below), so nothing that only marks or decorates can be taken for a state. The band carries no words, so no ratio is asked of it; and
 * LIVE, ON AIR and the network sit in the header on a panel of their own (operator/Header.tsx), never on the
 * header's colour, so the states are always read on the surfaces measured above.
 */

type Colour = ColourToken | DecorationToken | 'white' | 'black';

export interface ContrastRule {
  what: string;
  fg: Colour;
  bg: Colour;
  /** Drawn see-through: `fg` at this alpha over `under` (or over `bg`). */
  alpha?: number;
  under?: Colour;
  /** A control seen by its fill or its edge (WCAG 1.4.11): `fg` or this, whichever stands out more. */
  or?: Colour;
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
  ...decorationRules(),
];

/** The decoration's rules (Session 42). */
function decorationRules(): ContrastRule[] {
  const header = 'operator/Header.tsx';
  return [
    { what: 'words on the header', fg: 'on-header', bg: 'header', min: 4.5, source: 'WCAG 1.4.3' },
    {
      what: 'the header’s buttons’ words',
      fg: 'on-header-muted',
      bg: 'header',
      min: 4.5,
      source: 'WCAG 1.4.3',
    },
    { what: 'focus ring vs header', fg: 'header-ring', bg: 'header', min: 3, source: 'WCAG 1.4.11' },
    {
      what: 'control edge vs header (Screens, What is this?)',
      fg: 'header-field',
      bg: 'header',
      min: 3,
      source: `WCAG 1.4.11 (${header})`,
    },
    {
      what: 'a warning button on the header (Announcements, Admin): its edge or its fill',
      fg: 'warning',
      or: 'warning-bg',
      bg: 'header',
      min: 3,
      source: `WCAG 1.4.11 (${header})`,
    },
    ...SURFACES.map((bg) => ({
      what: `heading on ${bg}`,
      fg: 'heading' as const,
      bg,
      min: 4.5,
      source: 'WCAG 1.4.3 (ui/Panel.tsx)',
    })),
    ...SURFACES.map((bg) => ({
      what: `second (the chosen tab’s underline) vs ${bg}`,
      fg: 'second' as const,
      bg,
      min: 3,
      source: 'WCAG 1.4.11 (ui/Tabs.tsx)',
    })),
    ...(['panel-3', 'panel'] as const).map((bg) => ({
      what: `the chosen row’s edge (second at 70% on panel-3) vs ${bg}`,
      fg: 'second' as const,
      alpha: 0.7,
      under: 'panel-3' as const,
      bg,
      min: 3,
      source: 'WCAG 1.4.11 (ui/ListRow.tsx)',
    })),
  ];
}

/** Colours that must never be confused: [what, colour, colour, the least CIEDE2000 in any colour vision]. */
export const DISTANCE_RULES: readonly (readonly [
  string,
  ColourToken | DecorationToken,
  ColourToken,
  number,
])[] = [
  ...(['primary', 'primary-hi', 'primary-lo', 'primary-edge'] as const).flatMap((p) =>
    (['live', 'onair', 'warning'] as const).map((s) => [`${p} vs ${s}`, p, s, 10] as const),
  ),
  ['primary vs success', 'primary', 'success', 7],
  ['primary vs danger', 'primary', 'danger', 7],
  // Session 42: what marks, and the headings' words, are never taken for a state either. ON AIR is read only
  // from its own badge (violet, filled, with its words), never from an underline or a row's edge, so the second
  // colour is not measured against it: White's, its focus ring's blue as before Session 42, is 0.6 from it for
  // a person without working green cones.
  ['second vs live', 'second', 'live', 10],
  ['second vs warning', 'second', 'warning', 10],
  ...(['live', 'onair', 'warning'] as const).map((s) => [`heading vs ${s}`, 'heading', s, 10] as const),
  ['second vs success', 'second', 'success', 7],
  ['second vs danger', 'second', 'danger', 7],
  ['heading vs danger', 'heading', 'danger', 7],
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
  return name in a.colours ? a.colours[name as ColourToken] : a.decoration[name as DecorationToken];
}

/** Every contrast rule, measured on one appearance. */
export function measureContrast(a: Appearance): Measured[] {
  return CONTRAST_RULES.map((r) => {
    const bg = colourOf(a, r.bg);
    const solid = colourOf(a, r.fg);
    const drawn = r.alpha === undefined ? solid : over(solid, r.alpha, colourOf(a, r.under ?? r.bg));
    const other = r.or === undefined ? null : colourOf(a, r.or);
    const fg = other !== null && contrastRatio(other, bg) > contrastRatio(drawn, bg) ? other : drawn;
    const value = contrastRatio(fg, bg);
    const name = fg === other ? (r.or ?? r.fg) : r.fg;
    return {
      what: r.what,
      colours: `${name} ${fg}${r.alpha === undefined ? '' : ` (${solid} at ${String(r.alpha * 100)}%)`} on ${r.bg} ${bg}`,
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
    const each = VISIONS.map((v) => deltaE00(colourOf(a, x), a.colours[y], v));
    const value = Math.min(...each);
    return {
      what,
      colours: `${x} ${colourOf(a, x)} and ${y} ${a.colours[y]}`,
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

/*
 * More than one colour (Session 42): what an appearance with colours of its own (every built-in one but Black
 * and White, and every one a person makes) has in the decoration's places. A header colour of its own, apart from
 * its panels and window (CIEDE2000 10 at least) and a colour, not a grey (OKLCH chroma 0.04 at least); a band of
 * 2 to 5 colours; headings in a colour (chroma 0.05); and surfaces that carry its hue: the window's chroma 0.018
 * at least, and a dark appearance's panels 0.03 (Black's are 0.006, Saffron's were 0.018 before Session 42).
 */
const HEX = /^#[0-9a-f]{6}$/u;
export const COLOURFUL = { apart: 10, header: 0.04, heading: 0.05, window: 0.018, darkPanels: 0.03 } as const;

/** What an appearance lacks to be more than one colour, in a line each; empty when it has it all. */
export function decorationLacks(a: Appearance): string[] {
  const d = a.decoration;
  const c = a.colours;
  const chroma = (hex: string) => hexToOklch(hex).c;
  const lacks: string[] = [];
  if (d.band.length < 2 || d.band.length > BAND_MAX || !d.band.every((b) => HEX.test(b)))
    lacks.push(`a band of 2 to ${String(BAND_MAX)} colours (it has ${String(d.band.length)})`);
  if (Math.min(deltaE00(d.header, c.panel), deltaE00(d.header, c.ink)) < COLOURFUL.apart)
    lacks.push('a header colour apart from its panels and window');
  if (chroma(d.header) < COLOURFUL.header) lacks.push('a header in a colour, not a grey');
  if (chroma(d.heading) < COLOURFUL.heading) lacks.push('headings in a colour');
  if (chroma(c.ink) < COLOURFUL.window) lacks.push('a window that carries its hue');
  if (a.base === 'dark' && Math.min(chroma(c.panel), chroma(c['panel-2'])) < COLOURFUL.darkPanels)
    lacks.push('panels that carry its hue');
  return lacks;
}
