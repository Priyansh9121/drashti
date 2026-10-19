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

/*
 * The colourful appearances (Session 40), each with one clear colour for the next thing to do, calm surfaces,
 * and states that never clash with it (rules.ts). Made with the licensed design skills' ideas (the skills
 * review): a palette from the subject's own things, designed light and dark rather than inverted, one bold
 * colour spent in one place.
 */

/** Saffron: warm and dark; the next thing to do in saffron. Its warning is a clear yellow, never taken for it. */
export const SAFFRON: Appearance = {
  id: 'saffron',
  name: 'Saffron',
  base: 'dark',
  colours: {
    ink: '#120c08',
    panel: '#1b130d',
    'panel-2': '#251a12',
    'panel-3': '#312319',
    line: '#3a2a1e',
    'line-strong': '#54402f',
    field: '#9a8470',
    fg: '#fdf6ee',
    muted: '#dccab8',
    faint: '#b9a591',
    accent: '#ffc58a',
    'primary-hi': '#f7923a',
    primary: '#ee8228',
    'primary-lo': '#da7016',
    'on-primary': '#1d0e02',
    'primary-edge': '#e8893a',
    ...DARK_STATES,
    warning: '#ffe45c',
    'warning-bg': '#33290a',
    'warning-fg': '#ffe98a',
    danger: '#ff8fb8',
    'danger-fg': '#ffc2d8',
  },
};

/** Peacock: deep teal; the next thing to do in the peacock's teal. Its success is a lime green, apart from it. */
export const PEACOCK: Appearance = {
  id: 'peacock',
  name: 'Peacock',
  base: 'dark',
  colours: {
    ink: '#05141a',
    panel: '#0a1d24',
    'panel-2': '#10272f',
    'panel-3': '#17333c',
    line: '#1e3c45',
    'line-strong': '#2e5560',
    field: '#6d959e',
    fg: '#edfbfb',
    muted: '#bad8db',
    faint: '#91b3b8',
    accent: '#86d7ff',
    'primary-hi': '#2cc6bf',
    primary: '#16b3ac',
    'primary-lo': '#0c9c96',
    'on-primary': '#02191a',
    'primary-edge': '#20bab3',
    ...DARK_STATES,
    success: '#a5d64c',
    'success-bg': '#1d2b0b',
    'success-fg': '#d6f2a6',
    rec: '#ff6b6b',
  },
};

/** Midnight Blue: deep navy; the next thing to do in a clear sky blue. */
export const MIDNIGHT_BLUE: Appearance = {
  id: 'midnight-blue',
  name: 'Midnight Blue',
  base: 'dark',
  colours: {
    ink: '#070b1a',
    panel: '#0d1326',
    'panel-2': '#141c33',
    'panel-3': '#1c2642',
    line: '#232d4c',
    'line-strong': '#36426a',
    field: '#7883a8',
    fg: '#f1f4ff',
    muted: '#c4cbea',
    faint: '#9ba4c8',
    accent: '#9cc3ff',
    'primary-hi': '#7db8ff',
    primary: '#5aa2ff',
    'primary-lo': '#3f8cf2',
    'on-primary': '#04102a',
    'primary-edge': '#6aa9ff',
    ...DARK_STATES,
  },
};

/** Sandalwood: light and warm, the colour of chandan; the next thing to do in a deep blue-green. */
export const SANDALWOOD: Appearance = {
  id: 'sandalwood',
  name: 'Sandalwood',
  base: 'light',
  colours: {
    ink: '#e9dcc4',
    panel: '#f6eedf',
    'panel-2': '#fdf8ef',
    'panel-3': '#e3d4b8',
    line: '#d9c8a8',
    'line-strong': '#bba885',
    field: '#7a6a52',
    fg: '#20180e',
    muted: '#4a3c2a',
    faint: '#64543f',
    accent: '#0b5e73',
    'primary-hi': '#126c8c',
    primary: '#0b5c7a',
    'primary-lo': '#084a63',
    'on-primary': '#ffffff',
    'primary-edge': '#0b5c7a',
    ...LIGHT_STATES,
    danger: '#a51616',
    'danger-strong': '#a51616',
  },
};

/** Lotus: light, the lotus's soft pink; the next thing to do in its deep pink. */
export const LOTUS: Appearance = {
  id: 'lotus',
  name: 'Lotus',
  base: 'light',
  colours: {
    ink: '#f0e4e8',
    panel: '#faf4f6',
    'panel-2': '#ffffff',
    'panel-3': '#ead8de',
    line: '#e1cdd4',
    'line-strong': '#c4aab3',
    field: '#7d6870',
    fg: '#1f1216',
    muted: '#4c3840',
    faint: '#67535a',
    accent: '#1d4ed8',
    'primary-hi': '#b8336a',
    primary: '#a52a5e',
    'primary-lo': '#8e2050',
    'on-primary': '#ffffff',
    'primary-edge': '#a52a5e',
    ...LIGHT_STATES,
    warning: '#946200',
    'warning-fg': '#5c3d00',
  },
};

/** Marble: light, the mandir's cool white marble; the next thing to do in a deep navy. */
export const MARBLE: Appearance = {
  id: 'marble',
  name: 'Marble',
  base: 'light',
  colours: {
    ink: '#e6e8ec',
    panel: '#f6f7f9',
    'panel-2': '#ffffff',
    'panel-3': '#dcdfe5',
    line: '#d2d6dd',
    'line-strong': '#b0b5bf',
    field: '#6b717c',
    fg: '#0f141c',
    muted: '#3f4652',
    faint: '#59606c',
    accent: '#0b5e9e',
    'primary-hi': '#24427a',
    primary: '#1b3566',
    'primary-lo': '#132852',
    'on-primary': '#ffffff',
    'primary-edge': '#1b3566',
    ...LIGHT_STATES,
  },
};

/** Tulsi: dark, the tulsi plant's deep green; the next thing to do in ivory. */
export const TULSI: Appearance = {
  id: 'tulsi',
  name: 'Tulsi',
  base: 'dark',
  colours: {
    ink: '#07110c',
    panel: '#0d1a13',
    'panel-2': '#13241a',
    'panel-3': '#1b3023',
    line: '#22392b',
    'line-strong': '#355240',
    field: '#78947f',
    fg: '#f2faf4',
    muted: '#c3d8c9',
    faint: '#9ab5a2',
    accent: '#a9d8ff',
    'primary-hi': '#fffbea',
    primary: '#f6efd6',
    'primary-lo': '#e6dcbc',
    'on-primary': '#11160f',
    'primary-edge': '#e6dcbc',
    ...DARK_STATES,
  },
};

/** The built-in appearances, in the menu's order (after Follow the computer). */
export const BUILT_IN: readonly Appearance[] = [
  BLACK,
  WHITE,
  SAFFRON,
  PEACOCK,
  MIDNIGHT_BLUE,
  SANDALWOOD,
  LOTUS,
  MARBLE,
  TULSI,
];

/** A built-in appearance by its id. */
export const builtIn = (id: string): Appearance | undefined => BUILT_IN.find((a) => a.id === id);

/** What Follow the computer shows: Black when the computer is set dark, else White. */
export const followed = (dark: boolean): Appearance => (dark ? BLACK : WHITE);
