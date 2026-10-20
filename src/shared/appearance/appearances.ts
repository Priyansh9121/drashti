/*
 * Drashti's appearances (Sessions 39–40): the look of its own windows, chosen in the app (View › Appearance)
 * and kept per computer, outside the library. An appearance is a complete set of the interface's colour tokens,
 * over the same names as app.css's @theme, so no component changes for one; its shadows' tints follow from its
 * base and its primary and live colours (vars.ts). Every one meets every rule (rules.ts, measured by
 * src/main/contrast.test.ts). The audience screens, the stream's page, the stage display and the phone pages
 * never take one (body.output keeps its own, and body.web is Black, fixed since Session 41: app.css).
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

/*
 * The decoration (Session 42): the colours that make an appearance more than one colour, in places that mark
 * and decorate but never act or tell a state. Each is a --color-* custom property too (vars.ts), so components
 * take them with no code per appearance; they are kept apart from `Colours` because the audience screens and
 * the phone pages never draw them (app.css's body.output and body.web set the colours above, and these only
 * appear in the operator's own windows).
 */
export const DECORATION_TOKENS = [
  /** The operator window's top bar (and Simple Mode's). */
  'header',
  /** The name on it. */
  'on-header',
  /** The words of the buttons on it. */
  'on-header-muted',
  /** The keyboard's place on it (the focus ring), where the window's own would not show. */
  'header-ring',
  /** The edges of the controls on it (Screens, What is this?). */
  'header-field',
  /** Things that mark without acting: the chosen tab's underline, the chosen row's edge. */
  'second',
  /** The words of section headings. */
  'heading',
] as const;
export type DecorationToken = (typeof DECORATION_TOKENS)[number];

/** The most colours a band has. */
export const BAND_MAX = 5;

export type Decoration = Readonly<Record<DecorationToken, string>> & {
  /**
   * The band: 2 to 5 colours drawn as flat blocks side by side in a thin strip under the header, the
   * appearance's sign. Decoration only: no words on it, hidden from screen readers, gone in forced colours.
   * Black and White have none.
   */
  readonly band: readonly string[];
};

/** Dark (light words on dark surfaces) or light: the native parts (menus, scroll bars, pickers) follow it. */
export type AppearanceBase = 'dark' | 'light';

export interface Appearance {
  /** "black", "white", … for the built-in ones; "own-…" for one a person made (Session 40). */
  readonly id: string;
  /** Its name, as the menu and the Appearance window show it. */
  readonly name: string;
  readonly base: AppearanceBase;
  readonly colours: Colours;
  readonly decoration: Decoration;
}

/**
 * The decoration of an appearance with no colours of its own there (Black and White): exactly what the window
 * drew before Session 42. The header is a panel, its name in the words' colour and its buttons in the secondary
 * words', with the window's focus ring and controls' edges; the marks are the focus ring's colour; headings are secondary words; and
 * there is no band.
 */
export const plainDecoration = (c: Colours): Decoration => ({
  header: c.panel,
  'on-header': c.fg,
  'on-header-muted': c.muted,
  'header-ring': c.accent,
  'header-field': c.field,
  second: c.accent,
  heading: c.muted,
  band: [],
});

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

/** One a person made (Session 40): kept as its name, base and accent; the rest is worked out (derive.ts). */
export interface OwnAppearance {
  /** "own-" and a random part, made once. */
  id: string;
  name: string;
  base: AppearanceBase;
  /** The next thing to do's colour, "#rrggbb", as chosen. */
  accent: string;
}

/** The Appearance window's view: every appearance, what is chosen and what that shows now. */
export interface AppearanceView {
  /** FOLLOW, or an appearance's id. */
  choice: string;
  /** The appearance shown now (Follow the computer's: Black or White). */
  shown: string;
  list: readonly Appearance[];
  /** This computer's own, as kept (their ids are in `list` too). */
  own: readonly OwnAppearance[];
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

const BLACK_COLOURS: Colours = {
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
};
/**
 * Black: near-black and neutral, with nothing coloured but the states; the next thing to do is the one white
 * button, the clearest thing there can be on black.
 */
export const BLACK: Appearance = {
  id: 'black',
  name: 'Black',
  base: 'dark',
  colours: BLACK_COLOURS,
  decoration: plainDecoration(BLACK_COLOURS),
};

const WHITE_COLOURS: Colours = {
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
};
/** White: light surfaces and dark words; the next thing to do is the one near-black button. */
export const WHITE: Appearance = {
  id: 'white',
  name: 'White',
  base: 'light',
  colours: WHITE_COLOURS,
  decoration: plainDecoration(WHITE_COLOURS),
};

/*
 * The colourful appearances (Session 40), each with one clear colour for the next thing to do and states that
 * never clash with it (rules.ts). Made with the licensed design skills' ideas (the skills review): a palette from
 * the subject's own things, designed light and dark rather than inverted. Session 42 made them more than one
 * colour (the user found them "very static ... just one colour"): surfaces that carry their hue, a header of their
 * own with a band under it, a second colour for what marks, and coloured headings, every one measured by the rules.
 */

/**
 * Saffron: bhagwa, warm and dark. Deep saffron-brown surfaces; the header a burnt saffron; the band kesar red,
 * saffron and turmeric; the next thing to do in saffron, headings in it too, and marks in the cream of a sadhu's
 * cloth. Its warning is a clear yellow, never taken for the saffron.
 */
export const SAFFRON: Appearance = {
  id: 'saffron',
  name: 'Saffron',
  base: 'dark',
  colours: {
    ink: '#1a0801',
    panel: '#200f05',
    'panel-2': '#2a180d',
    'panel-3': '#382318',
    line: '#3f2b20',
    'line-strong': '#554034',
    field: '#b9a093',
    fg: '#fef5f0',
    muted: '#dfcdc3',
    faint: '#bea99d',
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
  decoration: {
    header: '#93360a',
    'on-header': '#fff4e6',
    'on-header-muted': '#ffdcb8',
    'header-ring': '#fff4e6',
    'header-field': '#ffdcb8',
    second: '#fff3e4',
    heading: '#f48b30',
    band: ['#d8431c', '#f7923a', '#ffd166', '#f7923a', '#d8431c'],
  },
};

/**
 * Peacock: deep teal surfaces; the header the deep blue-green of its neck; the band the feather's eye, royal blue,
 * teal, green and gold; the next thing to do in the peacock's teal, marks in a light sky blue and headings in a
 * pale teal. Its success is a lime green, apart from the teal.
 */
export const PEACOCK: Appearance = {
  id: 'peacock',
  name: 'Peacock',
  base: 'dark',
  colours: {
    ink: '#001113',
    panel: '#00181b',
    'panel-2': '#002226',
    'panel-3': '#012f34',
    line: '#0d373b',
    'line-strong': '#254c50',
    field: '#6f989c',
    fg: '#eef9fb',
    muted: '#c0d6d8',
    faint: '#99b4b7',
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
  decoration: {
    header: '#0b4a63',
    'on-header': '#effcff',
    'on-header-muted': '#bfe9f2',
    'header-ring': '#effcff',
    'header-field': '#bfe9f2',
    second: '#6fd3ff',
    heading: '#8fe0d8',
    band: ['#1f4fbf', '#16b3ac', '#3fa34d', '#e0b13a'],
  },
};

/**
 * Midnight Blue: the night sky. Deep navy surfaces and an indigo header; the band night blue, sky blue, starlight
 * and a star's gold; the next thing to do in a clear sky blue, marks in starlight and headings in a pale blue.
 */
export const MIDNIGHT_BLUE: Appearance = {
  id: 'midnight-blue',
  name: 'Midnight Blue',
  base: 'dark',
  colours: {
    ink: '#050a24',
    panel: '#0a122a',
    'panel-2': '#131b34',
    'panel-3': '#1e2743',
    line: '#252f4a',
    'line-strong': '#394460',
    field: '#7f8cab',
    fg: '#f3f7ff',
    muted: '#cad1e1',
    faint: '#a6aec2',
    accent: '#9cc3ff',
    'primary-hi': '#7db8ff',
    primary: '#5aa2ff',
    'primary-lo': '#3f8cf2',
    'on-primary': '#04102a',
    'primary-edge': '#6aa9ff',
    ...DARK_STATES,
  },
  decoration: {
    header: '#1b2a6e',
    'on-header': '#f1f4ff',
    'on-header-muted': '#c9d3ff',
    'header-ring': '#f1f4ff',
    'header-field': '#c9d3ff',
    second: '#b8c6ff',
    heading: '#a9c1ff',
    band: ['#2a3f99', '#5aa2ff', '#c9d6ff', '#ffd27a'],
  },
};

/**
 * Sandalwood: light and warm, the colour of chandan. The header in chandan paste, its words in dark wood; the band
 * the tilak's kumkum, chandan and haldi; the next thing to do in a deep blue-green, marks in a deep blue and
 * headings in deep teal.
 */
export const SANDALWOOD: Appearance = {
  id: 'sandalwood',
  name: 'Sandalwood',
  base: 'light',
  colours: {
    ink: '#f8e3c6',
    panel: '#fff2e2',
    'panel-2': '#fffcf8',
    'panel-3': '#f2daba',
    line: '#e8d2b6',
    'line-strong': '#c9b498',
    field: '#78664c',
    fg: '#17130e',
    muted: '#473e32',
    faint: '#655948',
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
  decoration: {
    header: '#efc27e',
    'on-header': '#2b1a08',
    'on-header-muted': '#3d2a14',
    'header-ring': '#2b1a08',
    'header-field': '#3d2a14',
    second: '#0b4f6c',
    heading: '#0f5f63',
    band: ['#c81d25', '#f1dcb4', '#e8a317', '#f1dcb4', '#c81d25'],
  },
};

/**
 * Lotus: light, the lotus's soft pink. The header the deep pink of its heart; the band petal pink, blush, the
 * leaf's green and the pollen's gold; the next thing to do in deep pink, headings in it too, and marks in the
 * blue of the water.
 */
export const LOTUS: Appearance = {
  id: 'lotus',
  name: 'Lotus',
  base: 'light',
  colours: {
    ink: '#ffdbea',
    panel: '#fff0f6',
    'panel-2': '#fffbfd',
    'panel-3': '#f9d1e3',
    line: '#eecada',
    'line-strong': '#cfacbb',
    field: '#7e5f6d',
    fg: '#181215',
    muted: '#4a3b41',
    faint: '#68545d',
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
  decoration: {
    header: '#8e2050',
    'on-header': '#fff4f8',
    'on-header-muted': '#ffd6e6',
    'header-ring': '#fff4f8',
    'header-field': '#ffd6e6',
    second: '#24527a',
    heading: '#8e2050',
    band: ['#e86a9a', '#f8c8d8', '#3c9a5f', '#f2d16b'],
  },
};

/**
 * Marble: light, the mandir's cool white marble, faintly veined blue. The header a slate navy; the band the
 * kalash's gold, marble white and navy; the next thing to do in a deep navy, marks and headings in blues of it.
 */
export const MARBLE: Appearance = {
  id: 'marble',
  name: 'Marble',
  base: 'light',
  colours: {
    ink: '#dde8f3',
    panel: '#eef5fe',
    'panel-2': '#fafdff',
    'panel-3': '#d3e0ec',
    line: '#ccd7e3',
    'line-strong': '#aeb9c4',
    field: '#606a74',
    fg: '#101419',
    muted: '#36414c',
    faint: '#4e5c6b',
    accent: '#0b5e9e',
    'primary-hi': '#24427a',
    primary: '#1b3566',
    'primary-lo': '#132852',
    'on-primary': '#ffffff',
    'primary-edge': '#1b3566',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#26344f',
    'on-header': '#f6f7f9',
    'on-header-muted': '#d6dce8',
    'header-ring': '#f6f7f9',
    'header-field': '#d6dce8',
    second: '#24507f',
    heading: '#2c4a7a',
    band: ['#c9a227', '#ffffff', '#1b3566', '#ffffff', '#c9a227'],
  },
};

/**
 * Tulsi: dark, the tulsi plant's deep green. The header its darkest leaf; the band green leaves, Krishna tulsi's
 * purple and the ivory of its flowers; the next thing to do in ivory, marks and headings in that purple, lightened.
 */
export const TULSI: Appearance = {
  id: 'tulsi',
  name: 'Tulsi',
  base: 'dark',
  colours: {
    ink: '#001204',
    panel: '#05190a',
    'panel-2': '#0e2213',
    'panel-3': '#192f1e',
    line: '#213625',
    'line-strong': '#364b3a',
    field: '#7b9380',
    fg: '#f1f9f3',
    muted: '#c7d6c9',
    faint: '#a1b4a4',
    accent: '#a9d8ff',
    'primary-hi': '#fffbea',
    primary: '#f6efd6',
    'primary-lo': '#e6dcbc',
    'on-primary': '#11160f',
    'primary-edge': '#e6dcbc',
    ...DARK_STATES,
  },
  decoration: {
    header: '#1d4a2b',
    'on-header': '#f6f1dc',
    'on-header-muted': '#d6e8d0',
    'header-ring': '#f6f1dc',
    'header-field': '#d6e8d0',
    second: '#c5a8f0',
    heading: '#c9b5f2',
    band: ['#2e7d4f', '#7a4fb0', '#f6efd6', '#7a4fb0', '#2e7d4f'],
  },
};

/**
 * Dhaja: the mandir flag's colours (Session 42), colours only: the flag's shape, its disc and the logo it carries
 * are never drawn. The flag has five stripes, three red and two white, and a white disc ringed red (Flags of the
 * World); the logo on it is in red and gold. Dark maroon surfaces; the header a deep flag red, its words warm
 * white; the band red and white stripes with the logo's gold between them. Red belongs to LIVE, so the flag's red
 * stays in the header and the band: the next thing to do is white, marks the logo's gold, softened, and headings
 * a warm peach. Named for the flag (dhaja), not for any organisation, so it can be used anywhere.
 */
export const DHAJA: Appearance = {
  id: 'dhaja',
  name: 'Dhaja',
  base: 'dark',
  colours: {
    ink: '#1e0305',
    panel: '#250a0b',
    'panel-2': '#2f1314',
    'panel-3': '#3d1f1f',
    line: '#442727',
    'line-strong': '#5b3b3b',
    field: '#b18c8b',
    fg: '#fff4f3',
    muted: '#e0cbca',
    faint: '#c0a7a6',
    accent: '#ffd98a',
    'primary-hi': '#ffffff',
    primary: '#fdf4ec',
    'primary-lo': '#efe0d2',
    'on-primary': '#2a0a0e',
    'primary-edge': '#f1dfd3',
    ...DARK_STATES,
  },
  decoration: {
    header: '#8c1a22',
    'on-header': '#fff6ee',
    'on-header-muted': '#ffd9d2',
    'header-ring': '#fff6ee',
    'header-field': '#ffd9d2',
    second: '#ffe6a8',
    heading: '#ffd4a8',
    band: ['#d0202b', '#ffffff', '#f2b630', '#ffffff', '#d0202b'],
  },
};

/**
 * Tiranga: India's flag colours (Session 42), colours only: no Ashoka Chakra and no flag shape, which the Flag
 * Code of India keeps for the flag itself. The commonly published shades: saffron #FF9933, white, India green
 * #138808 and the wheel's navy #000080. Light, the flag's white for panels, with a whisper of green in the window
 * and of saffron in what is pressed; the header the wheel's navy; the band saffron, white and green. The next thing
 * to do in saffron, kept apart from a warning (a deep amber-brown here) and with a navy edge; marks and headings in
 * navy. Green stays in the band, apart from success's green.
 */
export const TIRANGA: Appearance = {
  id: 'tiranga',
  name: 'Tiranga',
  base: 'light',
  colours: {
    ink: '#e2efdd',
    panel: '#f0f5fa',
    'panel-2': '#fafdff',
    'panel-3': '#fde3c6',
    line: '#d0d7de',
    'line-strong': '#b2b8bf',
    field: '#646a70',
    fg: '#101419',
    muted: '#36414c',
    faint: '#4e5c6b',
    accent: '#1d4ed8',
    'primary-hi': '#ffa347',
    primary: '#ff9933',
    'primary-lo': '#f28a1f',
    'on-primary': '#1d0e02',
    'primary-edge': '#1a2a8c',
    ...LIGHT_STATES,
    warning: '#c26a00',
    'warning-fg': '#5c3d00',
  },
  decoration: {
    header: '#000080',
    'on-header': '#ffffff',
    'on-header-muted': '#dfe3ff',
    'header-ring': '#ffffff',
    'header-field': '#dfe3ff',
    second: '#1a2a8c',
    heading: '#13306e',
    band: ['#ff9933', '#ffffff', '#138808'],
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
  DHAJA,
  TIRANGA,
];

/** A built-in appearance by its id. */
export const builtIn = (id: string): Appearance | undefined => BUILT_IN.find((a) => a.id === id);

/** What Follow the computer shows: Black when the computer is set dark, else White. */
export const followed = (dark: boolean): Appearance => (dark ? BLACK : WHITE);
