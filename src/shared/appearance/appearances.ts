/*
 * Drashti's appearances (Sessions 39–40): the look of its own windows, chosen in the app (View › Appearance)
 * and kept per computer, outside the library. An appearance is a complete set of the interface's colour tokens,
 * over the same names as app.css's @theme, so no component changes for one; its shadows' tints follow from its
 * base and its primary and live colours (vars.ts). Every one meets every rule (rules.ts, measured by
 * src/main/contrast.test.ts). The audience screens, the stream's page, the stage display and the phone pages
 * never take one (body.output and body.web keep their own, app.css).
 *
 * The states keep their meaning in every appearance: LIVE is always red with its label, ON AIR violet, REC a
 * red dot, a warning amber, success green, danger red, and the slide editor's guide and selection the same
 * on any slide. Each appearance may tune their shades so they meet the rules on its own surfaces.
 */

/** Every colour an appearance sets: the @theme's --color-* names. */
export const COLOUR_TOKENS = [
  'ink',
  'panel',
  'panel-2',
  'panel-3',
  'line',
  'line-strong',
  'field',
  'fg',
  'muted',
  'faint',
  'accent',
  'primary-hi',
  'primary',
  'primary-lo',
  'on-primary',
  'primary-edge',
  'live',
  'warning',
  'warning-bg',
  'warning-fg',
  'success',
  'success-bg',
  'success-fg',
  'danger',
  'danger-strong',
  'danger-bg',
  'danger-fg',
  'onair',
  'rec',
  'guide',
  'selection',
] as const;
export type ColourToken = (typeof COLOUR_TOKENS)[number];
export type Colours = Readonly<Record<ColourToken, string>>;

/** Dark (light words on dark surfaces) or light: the native parts (menus, scroll bars, pickers) follow it. */
export type AppearanceBase = 'dark' | 'light';

export interface Appearance {
  /** "black", "white", … for the built-in ones; "own-…" for one a person made (Session 40). */
  readonly id: string;
  /** Its name, as the menu and the Appearance window show it. */
  readonly name: string;
  readonly base: AppearanceBase;
  readonly colours: Colours;
}

/** Follow the computer (the default): Black or White, as macOS or Windows is set, changing when it changes. */
export const FOLLOW = 'follow';

/**
 * How the operator window moves (Session 40): Calm (Rising, Session 26g), Lively (more, never on a show
 * control), or Off. Reduced motion on the computer is Off, whatever is chosen.
 */
export type InterfaceMotion = 'calm' | 'lively' | 'off';
export const INTERFACE_MOTIONS: readonly InterfaceMotion[] = ['calm', 'lively', 'off'];

/** What a window draws in now: the appearance shown, its custom properties (vars.ts) and the motion. */
export interface AppearanceNow {
  id: string;
  base: AppearanceBase;
  vars: Readonly<Record<string, string>>;
  motion: InterfaceMotion;
}

/** The Appearance window's view: every appearance, what is chosen and what that shows now. */
export interface AppearanceView {
  /** FOLLOW, or an appearance's id. */
  choice: string;
  /** The appearance shown now (Follow the computer's: Black or White). */
  shown: string;
  list: readonly Appearance[];
  motion: InterfaceMotion;
}

/** The editor's marks, seen against any slide: the same in every appearance. */
const EDITOR = { guide: '#ff4fd8', selection: '#2563eb' } as const;

/** The states on dark surfaces: Drashti's as they always were. */
export const DARK_STATES = {
  live: '#d42a31',
  warning: '#f2b23e',
  'warning-bg': '#3b2a0a',
  'warning-fg': '#ffd88f',
  success: '#4cc26a',
  'success-bg': '#0f2b18',
  'success-fg': '#9be8b0',
  danger: '#ff7b7b',
  'danger-strong': '#c4262e',
  'danger-bg': '#3a1214',
  'danger-fg': '#ffb4b4',
  onair: '#7c3aed',
  rec: '#ff5a5a',
  ...EDITOR,
} as const;

/** The states on light surfaces: the same meanings, in shades that read on them. */
export const LIGHT_STATES = {
  live: '#d42a31',
  warning: '#b45309',
  'warning-bg': '#fdf0d5',
  'warning-fg': '#713f12',
  success: '#15803d',
  'success-bg': '#dcf5e3',
  'success-fg': '#14532d',
  danger: '#b91c1c',
  'danger-strong': '#b91c1c',
  'danger-bg': '#fde4e4',
  'danger-fg': '#7f1d1d',
  onair: '#6d28d9',
  rec: '#b42020',
  ...EDITOR,
} as const;

/**
 * Black: near-black and neutral, with nothing coloured but the states; the next thing to do is the one white
 * button, the clearest thing there can be on black.
 */
export const BLACK: Appearance = {
  id: 'black',
  name: 'Black',
  base: 'dark',
  colours: {
    ink: '#09090b',
    panel: '#121215',
    'panel-2': '#1b1b1f',
    'panel-3': '#26262b',
    line: '#2c2c32',
    'line-strong': '#42424a',
    field: '#82828d',
    fg: '#f5f5f7',
    muted: '#c8c8cf',
    faint: '#a1a1ab',
    accent: '#8ab4f8',
    'primary-hi': '#ffffff',
    primary: '#ededf0',
    'primary-lo': '#d6d6dc',
    'on-primary': '#0b0b0e',
    'primary-edge': '#c9c9d1',
    ...DARK_STATES,
  },
};

/** White: light surfaces and dark words; the next thing to do is the one near-black button. */
export const WHITE: Appearance = {
  id: 'white',
  name: 'White',
  base: 'light',
  colours: {
    ink: '#e9eaee',
    panel: '#f8f8fa',
    'panel-2': '#ffffff',
    'panel-3': '#dfe1e6',
    line: '#d4d6dc',
    'line-strong': '#b4b7bf',
    field: '#6f737c',
    fg: '#111216',
    muted: '#43464e',
    faint: '#5e626b',
    accent: '#1d4ed8',
    'primary-hi': '#2a2b31',
    primary: '#1c1d22',
    'primary-lo': '#0e0e11',
    'on-primary': '#ffffff',
    'primary-edge': '#2a2b31',
    ...LIGHT_STATES,
  },
};

/** The built-in appearances, in the menu's order (after Follow the computer). */
export const BUILT_IN: readonly Appearance[] = [BLACK, WHITE];

/** A built-in appearance by its id. */
export const builtIn = (id: string): Appearance | undefined => BUILT_IN.find((a) => a.id === id);

/** What Follow the computer shows: Black when the computer is set dark, else White. */
export const followed = (dark: boolean): Appearance => (dark ? BLACK : WHITE);
