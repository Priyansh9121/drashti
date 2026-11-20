import type { Tints, ZoneColours, Zones } from './zones';
import { plainZones } from './zones';

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
  /*
   * LIVE's frame and lit dot (the owner's Q60-36, Q1 A): LIVE's own red where it reads at 3:1 (Black, the light
   * appearances, one's own), a lighter red on the comfortable dark surfaces, where LIVE's own reads 2.4:1. The
   * LIVE label is always `live` with white words.
   */
  'live-edge',
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
  /*
   * Session 44, more places for colour: the header's far end (the header is a gradient from its colour to this,
   * left to right, and flat when they are the same); the panels' title strips (a gradient from `strip` to
   * `strip-2`, not drawn where both are the panel's own, as in Black and White); and the layer buttons (a lit
   * one's fill, and an unlit one's edge). Gradients only where nothing acts and nothing tells a state, never
   * moving (docs/design.md §5).
   */
  'header-2',
  'strip',
  'strip-2',
  'layer',
  'layer-edge',
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
  /** The window's zones (Session 44, zones.ts): the left column, the middle, the right column, the layer bar. */
  readonly zones: Zones;
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
  'header-2': c.panel,
  strip: c.panel,
  'strip-2': c.panel,
  layer: c['panel-2'],
  'layer-edge': c.line,
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
  /**
   * A second colour of one's own (Session 42), "#rrggbb", for what marks and the headings; without one it is
   * worked out from the accent (derive.ts).
   */
  second?: string;
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
  'live-edge': '#d42a31',
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

/**
 * The states on the comfortable dark surfaces (Session 60, the owner's Q60-36): Drashti's dark ones, with LIVE's frame and
 * lit dots in a lighter red (`live-edge`, Q1 A), where LIVE's own would read 2.4:1. Each appearance lifts the
 * shades of its words (REC, danger and the rest) as far as its own surfaces need.
 */
export const COMFORT_DARK_STATES = {
  ...DARK_STATES,
  'live-edge': '#ff5a60',
} as const;

/** The states on light surfaces: the same meanings, in shades that read on them. */
export const LIGHT_STATES = {
  live: '#d42a31',
  'live-edge': '#d42a31',
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
  zones: plainZones(BLACK_COLOURS),
};

const WHITE_COLOURS: Colours = {
  ink: '#dee1e5',
  panel: '#e6e8ea',
  'panel-2': '#eceef0',
  'panel-3': '#d9dadd',
  line: '#c7c9cb',
  'line-strong': '#acaeb0',
  field: '#78797a',
  fg: '#242629',
  muted: '#43464b',
  faint: '#565a61',
  accent: '#1b47c9',
  'primary-hi': '#24252a',
  primary: '#1c1d22',
  'primary-lo': '#121317',
  'on-primary': '#ffffff',
  'primary-edge': '#24252a',
  ...LIGHT_STATES,
};
/** White: light surfaces and dark words; the next thing to do is the one near-black button. */
export const WHITE: Appearance = {
  id: 'white',
  name: 'White',
  base: 'light',
  colours: WHITE_COLOURS,
  decoration: plainDecoration(WHITE_COLOURS),
  zones: plainZones(WHITE_COLOURS),
};

/** A zone's colours, in the order of ZONE_TOKENS: window, panel, raised, pressed, divider, strong divider, edge. */
const zone = (
  ink: string,
  panel: string,
  panel2: string,
  panel3: string,
  line: string,
  lineStrong: string,
  field: string,
): ZoneColours => ({
  ink,
  panel,
  'panel-2': panel2,
  'panel-3': panel3,
  line,
  'line-strong': lineStrong,
  field,
});

/*
 * The colourful appearances (Session 40, more colourful in Sessions 42 and 44), comfort-tuned in Session 60
 * (the owner's Q60-30 and Q60-36): every surface a deep tint (dark, 3–4.5 % luminance) or soft paper (light,
 * 76–85 %) rather than near-black or near-white, the words at 10–13:1, and every two of a base clearly apart
 * (src/main/contrast.test.ts). Made from a design per appearance (its subject's own colours; ideas from the
 * licensed design skills and the palettes of ui-ux-pro-max-skill's colors.csv, colours only, nothing copied) by
 * x48's maker, which moves only lightness and, within a design's range, hue and chroma, until every rule in
 * rules.ts holds.
 */

/**
 * Dhaja (Flags): the mandir flag's red and white stripes and the logo's gold, colours only; red kept in the
 * header and the band, so Next is white. Dark, at the twilight level.
 */
export const DHAJA: Appearance = {
  id: 'dhaja',
  name: 'Dhaja',
  base: 'dark',
  colours: {
    ink: '#502935',
    panel: '#562e3a',
    'panel-2': '#5b333f',
    'panel-3': '#623945',
    line: '#704a56',
    'line-strong': '#84616b',
    field: '#a38c92',
    fg: '#fcf4f6',
    muted: '#dfd2d5',
    faint: '#c4b1b6',
    accent: '#ffd98a',
    'primary-hi': '#ffffff',
    primary: '#fdf4ec',
    'primary-lo': '#eee5dd',
    'on-primary': '#110f0d',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#8c1a22',
    'on-header': '#fdf1f1',
    'on-header-muted': '#f0cdca',
    'header-ring': '#fdf1f1',
    'header-field': '#f0cdca',
    second: '#fff3e7',
    heading: '#e7cd90',
    'header-2': '#7a1238',
    strip: '#513756',
    'strip-2': '#433b5f',
    layer: '#274266',
    'layer-edge': '#d9ffe9',
    band: ['#d0202b', '#ffffff', '#f2b630', '#ffffff', '#d0202b'],
  },
  zones: {
    left: zone('#412e47', '#46334d', '#4b3852', '#523e58', '#624d68', '#78637f', '#a18ba8'),
    middle: zone('#4d2c29', '#53312e', '#583632', '#5f3c38', '#704b47', '#87615d', '#b18983'),
    right: zone('#273927', '#2c3e2c', '#314331', '#364a36', '#465946', '#5b6f5b', '#829882'),
    bar: zone('#482f1f', '#4e3424', '#533929', '#593f2f', '#6a4f3e', '#806453', '#aa8c79'),
  },
};

/**
 * Tiranga (Flags): India's flag colours in the commonly published shades (saffron #FF9933, white, India green
 * #138808, the wheel's navy #000080), colours only. Light, at the paper level.
 */
export const TIRANGA: Appearance = {
  id: 'tiranga',
  name: 'Tiranga',
  base: 'light',
  colours: {
    ink: '#d6e5d3',
    panel: '#e0ebde',
    'panel-2': '#e6f1e4',
    'panel-3': '#d3ddd0',
    line: '#c3cbc0',
    'line-strong': '#a8b0a6',
    field: '#757b74',
    fg: '#222721',
    muted: '#40483e',
    faint: '#515d4f',
    accent: '#1d4ed8',
    'primary-hi': '#ffab61',
    primary: '#ff9933',
    'primary-lo': '#ef8b1d',
    'on-primary': '#190c03',
    'primary-edge': '#6a3600',
    ...LIGHT_STATES,
    warning: '#bf6800',
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
    'header-2': '#1a1a6e',
    strip: '#fadbc0',
    'strip-2': '#e8e1bb',
    layer: '#bfd9b9',
    'layer-edge': '#2a498e',
    band: ['#ff9933', '#ffffff', '#138808'],
  },
  zones: {
    left: zone('#f1dece', '#f8e5d5', '#feebdb', '#ead7c7', '#d8c6b6', '#bdab9b', '#887668'),
    middle: zone('#d6e5d3', '#ddedda', '#e3f3e0', '#cfdfcc', '#becdba', '#a3b2a0', '#707d6c'),
    right: zone('#dbe1ef', '#e2e9f6', '#e8effc', '#d4dbe8', '#c3c9d6', '#a8aebb', '#747986'),
    bar: zone('#e7e2c7', '#eee9ce', '#f4efd4', '#e0dbc1', '#cecab0', '#b3af96', '#7e7962'),
  },
};

/**
 * Saffron (Mandir materials): bhagwa: warm saffron-brown, kesar red, turmeric and the olive of neem leaves.
 * Dark, at the twilight level.
 */
export const SAFFRON: Appearance = {
  id: 'saffron',
  name: 'Saffron',
  base: 'dark',
  colours: {
    ink: '#512a22',
    panel: '#572f27',
    'panel-2': '#5c342c',
    'panel-3': '#633a31',
    line: '#724b43',
    'line-strong': '#86625a',
    field: '#a48d87',
    fg: '#fdf4f3',
    muted: '#e0d3d0',
    faint: '#c4b2ae',
    accent: '#ffc58a',
    'primary-hi': '#facfae',
    primary: '#eec4a3',
    'primary-lo': '#dfb695',
    'on-primary': '#160d07',
    'primary-edge': '#facfae',
    ...COMFORT_DARK_STATES,
    warning: '#fff176',
    'warning-bg': '#33290a',
    'warning-fg': '#ffe98a',
    danger: '#ff94bb',
    'danger-fg': '#ffc2d8',
    rec: '#ff9891',
  },
  decoration: {
    header: '#994c17',
    'on-header': '#ffffff',
    'on-header-muted': '#ffece0',
    'header-ring': '#ffffff',
    'header-field': '#ffece0',
    second: '#fffdfc',
    heading: '#e5b3a4',
    'header-2': '#8d5f12',
    strip: '#3f431c',
    'strip-2': '#25482e',
    layer: '#603439',
    'layer-edge': '#a6cac2',
    band: ['#d8431c', '#f7923a', '#ffd166', '#f7923a', '#d8431c'],
  },
  zones: {
    left: zone('#333718', '#383c1d', '#3d4122', '#434728', '#535737', '#696d4c', '#909673'),
    middle: zone('#432d45', '#49324a', '#4d374f', '#543d56', '#644d66', '#7b627c', '#a48aa5'),
    right: zone('#472f26', '#4d332b', '#523830', '#593e35', '#6a4e45', '#81645b', '#aa8c81'),
    bar: zone('#1a3a34', '#1f3f39', '#24443e', '#2a4a44', '#3a5a54', '#4f716a', '#779991'),
  },
};

/**
 * Peacock (Nature): the peacock's blues and greens with a touch of its feather's gold. Dark, at the night
 * level. Moving: the band shimmers like a peacock feather.
 */
export const PEACOCK: Appearance = {
  id: 'peacock',
  name: 'Peacock',
  base: 'dark',
  colours: {
    ink: '#00332c',
    panel: '#013932',
    'panel-2': '#073e37',
    'panel-3': '#11453d',
    line: '#2b564f',
    'line-strong': '#476c65',
    field: '#79928d',
    fg: '#e9f2f0',
    muted: '#c0cfcc',
    faint: '#9eb2ae',
    accent: '#86d7ff',
    'primary-hi': '#21acb1',
    primary: '#00a1a6',
    'primary-lo': '#009296',
    'on-primary': '#001314',
    'primary-edge': '#21acb1',
    ...COMFORT_DARK_STATES,
    success: '#a5d64c',
    'success-bg': '#1d2b0b',
    'success-fg': '#d6f2a6',
    danger: '#ff8584',
    rec: '#ff8784',
  },
  decoration: {
    header: '#00445e',
    'on-header': '#ecf5fa',
    'on-header-muted': '#bad9ea',
    'header-ring': '#ecf5fa',
    'header-field': '#bad9ea',
    second: '#5cd0fb',
    heading: '#88dbc0',
    'header-2': '#004f4b',
    strip: '#1e3e29',
    'strip-2': '#333456',
    layer: '#673036',
    'layer-edge': '#e4d8ab',
    band: ['#1f4fbf', '#16b3ac', '#3fa34d', '#e0b13a'],
  },
  zones: {
    left: zone('#12303a', '#183540', '#1d3a46', '#24414d', '#35525e', '#4b6976', '#72929e'),
    middle: zone('#3a253c', '#402a42', '#452f47', '#4c364d', '#5e4760', '#755d77', '#9f85a0'),
    right: zone('#272f15', '#2c351b', '#31391f', '#374026', '#495237', '#5e684c', '#869173'),
    bar: zone('#2c2944', '#322e4b', '#373350', '#3d3a57', '#4e4b6a', '#656181', '#8d8aab'),
  },
};

/**
 * Midnight Blue (Nature): a clear night: deep navy and violet with a gold star in the band. Dark, at the night
 * level.
 */
export const MIDNIGHT_BLUE: Appearance = {
  id: 'midnight-blue',
  name: 'Midnight Blue',
  base: 'dark',
  colours: {
    ink: '#2a284d',
    panel: '#2f2d53',
    'panel-2': '#343258',
    'panel-3': '#3b3960',
    line: '#4c4b6f',
    'line-strong': '#636284',
    field: '#8b8ca0',
    fg: '#eff0f7',
    muted: '#cacbd6',
    faint: '#acadbc',
    accent: '#9cc3ff',
    'primary-hi': '#2ea6ff',
    primary: '#0b9bf6',
    'primary-lo': '#008de2',
    'on-primary': '#05101c',
    'primary-edge': '#2ea6ff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#262585',
    'on-header': '#f1f4fc',
    'on-header-muted': '#cdd4f0',
    'header-ring': '#f1f4fc',
    'header-field': '#cdd4f0',
    second: '#beb3eb',
    heading: '#ffdbb1',
    'header-2': '#350b83',
    strip: '#113b51',
    'strip-2': '#403051',
    layer: '#663039',
    'layer-edge': '#e4b8a2',
    band: ['#2a3f99', '#5aa2ff', '#c9d6ff', '#ffd27a'],
  },
  zones: {
    left: zone('#2a2945', '#2e2e4b', '#333350', '#3a3a58', '#4b4c6a', '#616282', '#898bad'),
    middle: zone('#352546', '#3a2a4b', '#3f2f51', '#463658', '#58476b', '#6f5e83', '#9887ad'),
    right: zone('#292a41', '#2e2f46', '#32344b', '#393b53', '#4a4d65', '#61637d', '#898ca6'),
    bar: zone('#1f2c46', '#24314b', '#283651', '#2f3d58', '#3f4f6a', '#566582', '#7d8fad'),
  },
};

/**
 * Sandalwood (Mandir materials): sandal paste and its warm creams, with the mandir's red and gold in the band.
 * Light, at the paper level.
 */
export const SANDALWOOD: Appearance = {
  id: 'sandalwood',
  name: 'Sandalwood',
  base: 'light',
  colours: {
    ink: '#ffdabf',
    panel: '#fbe3d0',
    'panel-2': '#ffeada',
    'panel-3': '#eed6c4',
    line: '#dac5b5',
    'line-strong': '#bdaa9d',
    field: '#84776d',
    fg: '#2a2520',
    muted: '#4e443c',
    faint: '#66574b',
    accent: '#0b5e73',
    'primary-hi': '#12587b',
    primary: '#004e71',
    'primary-lo': '#004160',
    'on-primary': '#ffffff',
    'primary-edge': '#12587b',
    ...LIGHT_STATES,
    warning: '#b15103',
    danger: '#a51616',
    'danger-strong': '#a51616',
  },
  decoration: {
    header: '#f0bf84',
    'on-header': '#2d261c',
    'on-header-muted': '#504434',
    'header-ring': '#2d261c',
    'header-field': '#504434',
    second: '#006164',
    heading: '#00676e',
    'header-2': '#f4c1a7',
    strip: '#f7dcbd',
    'strip-2': '#ffd8c5',
    layer: '#d2d4b6',
    'layer-edge': '#005b63',
    band: ['#c81d25', '#f1dcb4', '#e8a317', '#f1dcb4', '#c81d25'],
  },
  zones: {
    left: zone('#f6dbdb', '#fce1e2', '#ffe9e9', '#efd5d5', '#ddc3c3', '#c1a8a8', '#8b7374'),
    middle: zone('#cbe8d5', '#d1efdb', '#d7f5e1', '#c4e2cf', '#b3d0bd', '#99b4a2', '#657f6f'),
    right: zone('#cae7e8', '#d0edee', '#d7f4f5', '#c3e0e1', '#b3ced0', '#97b3b4', '#647e80'),
    bar: zone('#d6e3f2', '#dce9f8', '#e3effe', '#d0dceb', '#becad9', '#a3afbd', '#707a88'),
  },
};

/**
 * Lotus (Nature): the lotus's pinks with its leaf's green. Light, at the stone level.
 */
export const LOTUS: Appearance = {
  id: 'lotus',
  name: 'Lotus',
  base: 'light',
  colours: {
    ink: '#f7d1d5',
    panel: '#f6dcde',
    'panel-2': '#fde3e5',
    'panel-3': '#e8cfd1',
    line: '#d5bfc1',
    'line-strong': '#b9a5a7',
    field: '#807374',
    fg: '#282121',
    muted: '#4d3f40',
    faint: '#655254',
    accent: '#1c4dd7',
    'primary-hi': '#b63883',
    primary: '#aa2c79',
    'primary-lo': '#9b1a6c',
    'on-primary': '#ffffff',
    'primary-edge': '#b63883',
    ...LIGHT_STATES,
    warning: '#946200',
    'warning-fg': '#5c3d00',
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#8e0f52',
    'on-header': '#fcf1f4',
    'on-header-muted': '#edccd6',
    'header-ring': '#fcf1f4',
    'header-field': '#edccd6',
    second: '#005777',
    heading: '#831d7f',
    'header-2': '#780f6e',
    strip: '#eed3f0',
    'strip-2': '#c8ddfb',
    layer: '#c6d8b6',
    'layer-edge': '#104f7e',
    band: ['#e86a9a', '#f8c8d8', '#3c9a5f', '#f2d16b'],
  },
  zones: {
    left: zone('#eed5ce', '#f6ddd6', '#fde4dd', '#e9d0c9', '#d8bfb8', '#bda59f', '#88716b'),
    middle: zone('#ebd4e2', '#f3dcea', '#fae3f1', '#e5cfdc', '#d4bfcb', '#b9a4b1', '#84707c'),
    right: zone('#c9e0d2', '#d1e8da', '#d8efe1', '#c4dbcd', '#b3cabd', '#99afa2', '#667a6f'),
    bar: zone('#cadee8', '#d2e6f0', '#d9edf7', '#c5d8e2', '#b4c8d1', '#9aadb6', '#677881'),
  },
};

/**
 * Marble (Mandir materials): white mandir marble, cool and quiet, with gold and navy. Light, at the paper
 * level.
 */
export const MARBLE: Appearance = {
  id: 'marble',
  name: 'Marble',
  base: 'light',
  colours: {
    ink: '#d0e3f8',
    panel: '#dce9f7',
    'panel-2': '#e2effe',
    'panel-3': '#cfdcea',
    line: '#becad6',
    'line-strong': '#a5afb9',
    field: '#737a81',
    fg: '#22262c',
    muted: '#3e4750',
    faint: '#4e5b68',
    accent: '#0b5e9e',
    'primary-hi': '#093262',
    primary: '#002958',
    'primary-lo': '#001e45',
    'on-primary': '#ffffff',
    'primary-edge': '#093262',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#2d3c57',
    'on-header': '#eff4fc',
    'on-header-muted': '#c6d6f0',
    'header-ring': '#eff4fc',
    'header-field': '#c6d6f0',
    second: '#005d7b',
    heading: '#455b81',
    'header-2': '#324774',
    strip: '#c1e7ed',
    'strip-2': '#e9dbf6',
    layer: '#e1d0ad',
    'layer-edge': '#5974a3',
    band: ['#c9a227', '#ffffff', '#1b3566', '#ffffff', '#c9a227'],
  },
  zones: {
    left: zone('#cee6e3', '#d5edea', '#dbf3f0', '#c8e0dd', '#b6cecb', '#9cb3b0', '#687d7c'),
    middle: zone('#e6deef', '#ede5f6', '#f3ebfc', '#e0d8e9', '#cec6d6', '#b3abbb', '#7e7686'),
    right: zone('#e7e1cb', '#eee8d1', '#f4eed7', '#e1dbc5', '#cfc9b3', '#b4ae99', '#7f7966'),
    bar: zone('#d3e4ea', '#daebf1', '#e0f1f7', '#cddee4', '#bbccd2', '#a1b1b7', '#6d7b82'),
  },
};

/**
 * Tulsi (Nature): tulsi's leaves and its violet manjari, with an ivory Next. Dark, at the night level.
 */
export const TULSI: Appearance = {
  id: 'tulsi',
  name: 'Tulsi',
  base: 'dark',
  colours: {
    ink: '#073327',
    panel: '#0e382c',
    'panel-2': '#143d31',
    'panel-3': '#1c4538',
    line: '#325649',
    'line-strong': '#4c6c60',
    field: '#7a9289',
    fg: '#e9f2ee',
    muted: '#c1cfc9',
    faint: '#a0b2ab',
    accent: '#a9d8ff',
    'primary-hi': '#f1ead4',
    primary: '#e5dec9',
    'primary-lo': '#d6cfbb',
    'on-primary': '#110f0b',
    'primary-edge': '#f1ead4',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#2b6730',
    'on-header': '#ffffff',
    'on-header-muted': '#c9e2c9',
    'header-ring': '#ffffff',
    'header-field': '#c9e2c9',
    second: '#f5acff',
    heading: '#c7a2e8',
    'header-2': '#176856',
    strip: '#43360e',
    'strip-2': '#502f17',
    layer: '#333e6c',
    'layer-edge': '#e4a2ac',
    band: ['#2e7d4f', '#7a4fb0', '#f6efd6', '#7a4fb0', '#2e7d4f'],
  },
  zones: {
    left: zone('#083138', '#0e363d', '#143b42', '#1d434a', '#2e545b', '#456b72', '#6c949b'),
    middle: zone('#133129', '#18362e', '#1d3b32', '#25433a', '#36554b', '#4c6b61', '#739488'),
    right: zone('#0e3130', '#143635', '#193b3a', '#214342', '#325553', '#496b6a', '#709492'),
    bar: zone('#43222a', '#48282f', '#4e2c34', '#56343c', '#69454d', '#815b63', '#aa838b'),
  },
};

/**
 * Diwali (Festivals): diyas and rangoli: plum night, marigold, gold and pink. Dark, at the night level. Moving:
 * a diya’s glow breathes at the header’s end; the band shimmers.
 */
export const DIWALI: Appearance = {
  id: 'diwali',
  name: 'Diwali',
  base: 'dark',
  colours: {
    ink: '#412331',
    panel: '#472837',
    'panel-2': '#4c2d3c',
    'panel-3': '#543443',
    line: '#644654',
    'line-strong': '#7a5d6a',
    field: '#9d8790',
    fg: '#f6eef1',
    muted: '#d5c9ce',
    faint: '#bba9b1',
    accent: '#d9c4ff',
    'primary-hi': '#ffd5aa',
    primary: '#f8c897',
    'primary-lo': '#e9ba89',
    'on-primary': '#170d04',
    'primary-edge': '#ffd5aa',
    ...COMFORT_DARK_STATES,
    warning: '#fff176',
    'warning-bg': '#33300a',
    'warning-fg': '#fff3a6',
    danger: '#ff8fb8',
    'danger-fg': '#ffc2d8',
    rec: '#ff8882',
  },
  decoration: {
    header: '#530b49',
    'on-header': '#faf1f8',
    'on-header-muted': '#e7cde1',
    'header-ring': '#faf1f8',
    'header-field': '#e7cde1',
    second: '#eabefd',
    heading: '#c6c7f7',
    'header-2': '#532002',
    strip: '#2c3657',
    'strip-2': '#542b2f',
    layer: '#5d3728',
    'layer-edge': '#e6d8a3',
    band: ['#ff8f1f', '#ffc23d', '#e83e8c', '#ffc23d', '#ff8f1f'],
  },
  zones: {
    left: zone('#43231e', '#492924', '#4e2e28', '#56352f', '#69453f', '#815c56', '#ab847d'),
    middle: zone('#08303f', '#0f3544', '#143a49', '#1c4251', '#2e5363', '#456a7b', '#6c93a4'),
    right: zone('#402612', '#452c17', '#4b301c', '#523823', '#644934', '#7c5f4a', '#a68770'),
    bar: zone('#3a2911', '#3f2e16', '#44331b', '#4b3b22', '#5d4c32', '#756249', '#9e8a6f'),
  },
};

/**
 * Holi (Festivals): Holi's colours thrown on a clear aqua day. Light, at the paper level. Moving: puffs of
 * colour drift across the header.
 */
export const HOLI: Appearance = {
  id: 'holi',
  name: 'Holi',
  base: 'light',
  colours: {
    ink: '#bee8f1',
    panel: '#d1ecf3',
    'panel-2': '#d6f3f9',
    'panel-3': '#c3dfe5',
    line: '#b4cdd2',
    'line-strong': '#9cb2b6',
    field: '#6d7c7f',
    fg: '#1f2729',
    muted: '#39484b',
    faint: '#485d61',
    accent: '#1b46a3',
    'primary-hi': '#945476',
    primary: '#894a6c',
    'primary-lo': '#7b3d5f',
    'on-primary': '#ffffff',
    'primary-edge': '#945476',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#01697d',
    'on-header': '#ffffff',
    'on-header-muted': '#c3e7f1',
    'header-ring': '#ffffff',
    'header-field': '#c3e7f1',
    second: '#3842a3',
    heading: '#a1136f',
    'header-2': '#105894',
    strip: '#e7e1bb',
    'strip-2': '#cae8ca',
    layer: '#e2cbe1',
    'layer-edge': '#ad7662',
    band: ['#e0218a', '#ffd23f', '#2fb344', '#12b5c6', '#ff7a1a'],
  },
  zones: {
    left: zone('#d2e2fc', '#dbe9ff', '#e4efff', '#cbdcf6', '#bacae3', '#a0afc8', '#6c7a92'),
    middle: zone('#f5dbda', '#fde1e1', '#ffe9e8', '#efd4d3', '#ddc3c2', '#c2a8a8', '#8b7373'),
    right: zone('#f0e0bc', '#f6e6c2', '#fdedc9', '#e9d9b5', '#d8c7a4', '#bcad8a', '#867857'),
    bar: zone('#dee4c6', '#e5ebcd', '#ecf1d2', '#d8ddbf', '#c7ccae', '#acb194', '#777b61'),
  },
};

/**
 * Aarti (Festivals): the aarti's lamp: gold, saffron and crimson. Light, at the paper level. Moving: the
 * aarti’s flame glows and breathes at the header’s end.
 */
export const AARTI: Appearance = {
  id: 'aarti',
  name: 'Aarti',
  base: 'light',
  colours: {
    ink: '#ece1b5',
    panel: '#efe8cb',
    'panel-2': '#f5eed1',
    'panel-3': '#e2dabe',
    line: '#cfc9af',
    'line-strong': '#b3ae98',
    field: '#7d7969',
    fg: '#27261f',
    muted: '#49463a',
    faint: '#5e5949',
    accent: '#2f4f8f',
    'primary-hi': '#92154d',
    primary: '#860044',
    'primary-lo': '#720039',
    'on-primary': '#ffffff',
    'primary-edge': '#92154d',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#795611',
    'on-header': '#ffffff',
    'on-header-muted': '#ebd9be',
    'header-ring': '#ffffff',
    'header-field': '#ebd9be',
    second: '#5f001d',
    heading: '#871261',
    'header-2': '#7b4110',
    strip: '#c9e8cb',
    'strip-2': '#fed6e6',
    layer: '#f4c6ce',
    'layer-edge': '#234077',
    band: ['#b3122e', '#e0a526', '#f26b1d', '#e0a526', '#b3122e'],
  },
  zones: {
    left: zone('#f9dbca', '#ffe3d3', '#ffeade', '#f2d5c4', '#e1c3b3', '#c5a898', '#8e7365'),
    middle: zone('#f3dbe5', '#fae2ec', '#ffe8f2', '#ecd4de', '#dac3cd', '#bfa8b1', '#89737c'),
    right: zone('#f2dcda', '#f9e3e1', '#ffe9e7', '#ecd5d4', '#dac4c2', '#bea9a8', '#887474'),
    bar: zone('#cce8d9', '#d2efe0', '#d8f5e6', '#c5e1d3', '#b4cfc1', '#99b4a6', '#657e72'),
  },
};

/**
 * Monsoon (Nature): rain clouds, wet leaves and the first light after the rain. Dark, at the twilight level.
 * Moving: fine rain lines fall across the header.
 */
export const MONSOON: Appearance = {
  id: 'monsoon',
  name: 'Monsoon',
  base: 'dark',
  colours: {
    ink: '#153944',
    panel: '#1c3f4a',
    'panel-2': '#21434f',
    'panel-3': '#274a55',
    line: '#3b5a64',
    'line-strong': '#536f78',
    field: '#80959d',
    fg: '#eff8fb',
    muted: '#cad8dc',
    faint: '#a6b9bf',
    accent: '#8fd3ff',
    'primary-hi': '#c0ceff',
    primary: '#b3c2f9',
    'primary-lo': '#a5b4ea',
    'on-primary': '#0c0f1a',
    'primary-edge': '#c0ceff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#232564',
    'on-header': '#f2f3fc',
    'on-header-muted': '#ced3f0',
    'header-ring': '#f2f3fc',
    'header-field': '#ced3f0',
    second: '#49d9b8',
    heading: '#b1e5c4',
    'header-2': '#014457',
    strip: '#493a5c',
    'strip-2': '#32462b',
    layer: '#1e4746',
    'layer-edge': '#b9c499',
    band: ['#4a6fa5', '#2fb3a6', '#5fbf5f', '#ffe66d'],
  },
  zones: {
    left: zone('#3a3046', '#40364d', '#453a51', '#4b4158', '#5b5169', '#71667f', '#998da7'),
    middle: zone('#17393d', '#1e3f43', '#224347', '#294a4e', '#385b5f', '#4e7074', '#74989c'),
    right: zone('#123a39', '#18403f', '#1d4443', '#244b49', '#355c5a', '#4a716f', '#709a97'),
    bar: zone('#38304d', '#3e3653', '#423a58', '#48415f', '#585170', '#6e6686', '#958daf'),
  },
};

/**
 * Sandhya (Dusk): the evening sky from indigo through rose to gold. Dark, at the night level. Moving: the
 * header’s sunset colours drift slowly.
 */
export const SANDHYA: Appearance = {
  id: 'sandhya',
  name: 'Sandhya',
  base: 'dark',
  colours: {
    ink: '#342642',
    panel: '#392c48',
    'panel-2': '#3f304d',
    'panel-3': '#463854',
    line: '#574965',
    'line-strong': '#6c617a',
    field: '#928a9d',
    fg: '#f2eff6',
    muted: '#cfcad4',
    faint: '#b2abb9',
    accent: '#ffc2d6',
    'primary-hi': '#c9bfff',
    primary: '#beb3f8',
    'primary-lo': '#b0a5e9',
    'on-primary': '#100d1b',
    'primary-edge': '#c9bfff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#871d50',
    'on-header': '#ffffff',
    'on-header-muted': '#f0cfd9',
    'header-ring': '#ffffff',
    'header-field': '#f0cfd9',
    second: '#abdbff',
    heading: '#ffd4df',
    'header-2': '#944100',
    strip: '#403051',
    'strip-2': '#522e1d',
    layer: '#314022',
    'layer-edge': '#c7b192',
    band: ['#3b2a8f', '#7a3fb8', '#e05a8a', '#ff8a5c', '#ffc04d'],
  },
  zones: {
    left: zone('#352540', '#3b2b46', '#3f304b', '#473753', '#594865', '#705f7d', '#9887a6'),
    middle: zone('#432228', '#49282e', '#4e2c32', '#563439', '#68454a', '#815b61', '#ac8388'),
    right: zone('#332641', '#392c48', '#3d304c', '#453855', '#564967', '#6d607e', '#9688a8'),
    bar: zone('#0c303b', '#123640', '#173a46', '#1f424e', '#30535f', '#476a77', '#6f93a0'),
  },
};

/**
 * Forest (Nature): deep woods: moss, bark and leaf. Dark, at the night level.
 */
export const FOREST: Appearance = {
  id: 'forest',
  name: 'Forest',
  base: 'dark',
  colours: {
    ink: '#27300e',
    panel: '#2b3513',
    'panel-2': '#303a18',
    'panel-3': '#384120',
    line: '#495334',
    'line-strong': '#60694d',
    field: '#89907c',
    fg: '#eef1ea',
    muted: '#cacdc2',
    faint: '#aab0a0',
    accent: '#9fe0c0',
    'primary-hi': '#d5eaa6',
    primary: '#cade9b',
    'primary-lo': '#bccf8d',
    'on-primary': '#0d1104',
    'primary-edge': '#d5eaa6',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#553010',
    'on-header': '#fbf2ec',
    'on-header-muted': '#ead0bc',
    'header-ring': '#fbf2ec',
    'header-field': '#ead0bc',
    second: '#a2bcff',
    heading: '#a7e2ad',
    'header-2': '#134627',
    strip: '#1b3e26',
    'strip-2': '#0d3e36',
    layer: '#563b26',
    'layer-edge': '#6fc1c2',
    band: ['#2e6b4f', '#8db348', '#8a5a32', '#d9874a'],
  },
  zones: {
    left: zone('#083138', '#0e363d', '#143b42', '#1c4249', '#2e555c', '#456b72', '#6c949b'),
    middle: zone('#173125', '#1c362a', '#213b2f', '#284335', '#395547', '#506b5d', '#779484'),
    right: zone('#402527', '#452a2c', '#4a2f31', '#523638', '#654749', '#7c5e5f', '#a68687'),
    bar: zone('#302d15', '#353119', '#3a361e', '#413e25', '#535036', '#6a664c', '#928f73'),
  },
};

/**
 * Navratri (Festivals): the garba's nine nights: bright chaniya-choli colours on deep plum. Dark, at the
 * twilight level. Moving: the band shimmers like the garba’s lights.
 */
export const NAVRATRI: Appearance = {
  id: 'navratri',
  name: 'Navratri',
  base: 'dark',
  colours: {
    ink: '#482c3f',
    panel: '#4d3145',
    'panel-2': '#523649',
    'panel-3': '#593c4f',
    line: '#674d5f',
    'line-strong': '#7d6374',
    field: '#a08c99',
    fg: '#fbf4f9',
    muted: '#ded2d9',
    faint: '#c1b2bb',
    accent: '#ffd36b',
    'primary-hi': '#28c4d5',
    primary: '#08b9ca',
    'primary-lo': '#00aab9',
    'on-primary': '#001316',
    'primary-edge': '#28c4d5',
    ...COMFORT_DARK_STATES,
    success: '#a5d64c',
    'success-bg': '#1d2b0b',
    'success-fg': '#d6f2a6',
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#851a77',
    'on-header': '#faf1f8',
    'on-header-muted': '#e7cde1',
    'header-ring': '#faf1f8',
    'header-field': '#e7cde1',
    second: '#ffd1ea',
    heading: '#fff0a8',
    'header-2': '#2c3895',
    strip: '#503856',
    'strip-2': '#1e445c',
    layer: '#1e4558',
    'layer-edge': '#f9959d',
    band: ['#e0218a', '#ff8a1f', '#ffd23f', '#2fb344', '#2a5bd7'],
  },
  zones: {
    left: zone('#4a2b39', '#50303e', '#553543', '#5c3b4a', '#6d4b59', '#84606f', '#ad8897'),
    middle: zone('#1d374d', '#223c52', '#274157', '#2c475d', '#3c576e', '#516d85', '#7895ae'),
    right: zone('#2a3920', '#2f3e25', '#34432a', '#3b4930', '#4a5940', '#606f55', '#86977a'),
    bar: zone('#482c39', '#4d313f', '#533644', '#593c4a', '#6a4c5a', '#816170', '#aa8997'),
  },
};

/**
 * Neel (Crafts and textiles): indigo dye, with ivory, madder red and gold. Dark, at the twilight level.
 */
export const NEEL: Appearance = {
  id: 'neel',
  name: 'Neel',
  base: 'dark',
  colours: {
    ink: '#313156',
    panel: '#35375c',
    'panel-2': '#3a3c61',
    'panel-3': '#404268',
    line: '#505275',
    'line-strong': '#666889',
    field: '#8f90a5',
    fg: '#f5f6fd',
    muted: '#d3d5e0',
    faint: '#b3b5c4',
    accent: '#a9c8ff',
    'primary-hi': '#fff6e9',
    primary: '#ffe8c8',
    'primary-lo': '#f0d9ba',
    'on-primary': '#130f08',
    'primary-edge': '#fff6e9',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#551a14',
    'on-header': '#fcf2f0',
    'on-header-muted': '#efcdc7',
    'header-ring': '#fcf2f0',
    'header-field': '#efcdc7',
    second: '#80cec4',
    heading: '#c8d0ff',
    'header-2': '#1b257c',
    strip: '#4e3858',
    'strip-2': '#1d445c',
    layer: '#353d71',
    'layer-edge': '#e1c479',
    band: ['#2e3a9a', '#f3ead2', '#b8432f', '#d9a62e', '#2e3a9a'],
  },
  zones: {
    left: zone('#003a46', '#02404c', '#094551', '#124b58', '#255b68', '#3c727e', '#649aa7'),
    middle: zone('#4d2c24', '#52322a', '#58362e', '#5e3d34', '#6f4c44', '#866259', '#af897e'),
    right: zone('#243929', '#2a3f2e', '#2f4433', '#354a39', '#445a48', '#59705e', '#7f9884'),
    bar: zone('#193941', '#1f3e47', '#24434c', '#2a4952', '#3a5962', '#4f6f79', '#7697a1'),
  },
};

/**
 * Ratna (Jewels): gems on velvet: emerald, sapphire, ruby, gold and pearl. Dark, at the twilight level.
 */
export const RATNA: Appearance = {
  id: 'ratna',
  name: 'Ratna',
  base: 'dark',
  colours: {
    ink: '#422e47',
    panel: '#47334d',
    'panel-2': '#4c3852',
    'panel-3': '#533e58',
    line: '#624e67',
    'line-strong': '#77657c',
    field: '#9b8d9f',
    fg: '#faf5fb',
    muted: '#dad3dd',
    faint: '#bdb3c0',
    accent: '#a8e6d0',
    'primary-hi': '#9bf6e4',
    primary: '#8fead9',
    'primary-lo': '#80dbca',
    'on-primary': '#021310',
    'primary-edge': '#9bf6e4',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#0a4b34',
    'on-header': '#ecf6f1',
    'on-header-muted': '#bcdccb',
    'header-ring': '#ecf6f1',
    'header-field': '#bcdccb',
    second: '#ffc8e0',
    heading: '#96e3bb',
    'header-2': '#0e3073',
    strip: '#57364e',
    'strip-2': '#4a395b',
    layer: '#314b38',
    'layer-edge': '#e9c67d',
    band: ['#1f8a5a', '#2a4fb8', '#b8143a', '#e8b84a', '#f4efe6'],
  },
  zones: {
    left: zone('#133948', '#183e4d', '#1d4352', '#244a58', '#345969', '#4a7080', '#7098a8'),
    middle: zone('#153b2e', '#1a4133', '#204638', '#274c3f', '#365c4e', '#4c7263', '#729a8a'),
    right: zone('#4a2c3a', '#4f313f', '#553544', '#5b3c4b', '#6c4b5b', '#846171', '#ac8898'),
    bar: zone('#3a3519', '#3f3a1e', '#443f23', '#4a4529', '#5a5538', '#706b4d', '#979373'),
  },
};

/**
 * Prabhat (Nature): dawn: peach and rose light over a blue morning. Light, at the paper level. Moving: the
 * header’s dawn colours drift slowly.
 */
export const PRABHAT: Appearance = {
  id: 'prabhat',
  name: 'Prabhat',
  base: 'light',
  colours: {
    ink: '#f9dadd',
    panel: '#f7e3e5',
    'panel-2': '#fee9eb',
    'panel-3': '#ead5d8',
    line: '#d7c4c6',
    'line-strong': '#b9aaab',
    field: '#827678',
    fg: '#2b2424',
    muted: '#504243',
    faint: '#685557',
    accent: '#1d4ed8',
    'primary-hi': '#b77689',
    primary: '#ac6c7f',
    'primary-lo': '#aa6a7d',
    'on-primary': '#190b0f',
    'primary-edge': '#ab6b7e',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#944e4b',
    'on-header': '#ffffff',
    'on-header-muted': '#ffe3e0',
    'header-ring': '#ffffff',
    'header-field': '#ffe3e0',
    second: '#a1277a',
    heading: '#8a4951',
    'header-2': '#98522c',
    strip: '#e5e2bc',
    'strip-2': '#fdd9c3',
    layer: '#b3d9dd',
    'layer-edge': '#48427f',
    band: ['#e8708a', '#ffb38a', '#ffd166', '#7fc4f0'],
  },
  zones: {
    left: zone('#e2e3cd', '#e9ead3', '#eff0d9', '#dbdcc5', '#cacab4', '#afaf9a', '#7a7a66'),
    middle: zone('#e8deef', '#eee5f6', '#f4ebfc', '#e0d7e7', '#cfc5d6', '#b3abbb', '#7e7585'),
    right: zone('#cfe6e5', '#d5edec', '#dbf3f2', '#c7dfde', '#b6cdcd', '#9cb2b1', '#677d7c'),
    bar: zone('#f6dec7', '#fce4cd', '#ffebd8', '#eed6c0', '#dcc5af', '#c0aa94', '#8a7561'),
  },
};

/**
 * Mehndi (Crafts and textiles): henna leaves and the warm stain they leave. Light, at the stone level.
 */
export const MEHNDI: Appearance = {
  id: 'mehndi',
  name: 'Mehndi',
  base: 'light',
  colours: {
    ink: '#cce1b8',
    panel: '#d8e7cc',
    'panel-2': '#dfeed3',
    'panel-3': '#cbd9be',
    line: '#bbc8b0',
    'line-strong': '#a3ae99',
    field: '#71796a',
    fg: '#20241d',
    muted: '#3f453a',
    faint: '#515a4a',
    accent: '#1b4bd5',
    'primary-hi': '#56371e',
    primary: '#4c2e15',
    'primary-lo': '#402309',
    'on-primary': '#ffffff',
    'primary-edge': '#56371e',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#3e4a17',
    'on-header': '#f2f5ec',
    'on-header-muted': '#cfd8bc',
    'header-ring': '#f2f5ec',
    'header-field': '#cfd8bc',
    second: '#013400',
    heading: '#693c30',
    'header-2': '#6d3115',
    strip: '#e8dbb6',
    'strip-2': '#f3d6ba',
    layer: '#c8d7bb',
    'layer-edge': '#005443',
    band: ['#6b7a2a', '#9a4a2a', '#f3e7c9', '#c0613a'],
  },
  zones: {
    left: zone('#c4e2cf', '#ccead7', '#d3f1de', '#bedcc9', '#aecbb8', '#95b1a0', '#627c6c'),
    middle: zone('#ead7c7', '#f2dfcf', '#f9e6d6', '#e5d1c2', '#d3c1b1', '#baa799', '#857366'),
    right: zone('#c6e1d1', '#cee9d9', '#d4f0e0', '#c0dbcc', '#b0cabb', '#97b1a2', '#637c6e'),
    bar: zone('#f6d2d1', '#fedad9', '#ffe3e2', '#f0cdcb', '#debcba', '#c4a3a2', '#8e6e6e'),
  },
};

/**
 * Haldi (Crafts and textiles): turmeric's yellow, with marigold and leaf green. Light, at the paper level.
 */
export const HALDI: Appearance = {
  id: 'haldi',
  name: 'Haldi',
  base: 'light',
  colours: {
    ink: '#dbe5c3',
    panel: '#e4ead3',
    'panel-2': '#eaf1da',
    'panel-3': '#d6ddc6',
    line: '#c5cbb7',
    'line-strong': '#abb09e',
    field: '#777b6f',
    fg: '#252720',
    muted: '#43473b',
    faint: '#575b4b',
    accent: '#1d4ed8',
    'primary-hi': '#5a186e',
    primary: '#500a64',
    'primary-lo': '#420054',
    'on-primary': '#ffffff',
    'primary-edge': '#5a186e',
    ...LIGHT_STATES,
    warning: '#9a4a00',
    'warning-fg': '#5c3000',
  },
  decoration: {
    header: '#f8d23c',
    'on-header': '#2a271b',
    'on-header-muted': '#4b4633',
    'header-ring': '#2a271b',
    'header-field': '#4b4633',
    second: '#334788',
    heading: '#432f00',
    'header-2': '#fac457',
    strip: '#cee7c8',
    'strip-2': '#e7e1bb',
    layer: '#bfd9b9',
    'layer-edge': '#00677e',
    band: ['#f2c230', '#ff9a1f', '#3a8f3a', '#ffffff'],
  },
  zones: {
    left: zone('#d6e6ca', '#ddedd1', '#e4f3d7', '#d0dfc3', '#bfceb3', '#a4b398', '#707d65'),
    middle: zone('#e7e2bd', '#eee9c3', '#f5f0c9', '#e1dcb6', '#cfcaa4', '#b4af8a', '#7f7a58'),
    right: zone('#f2dcd9', '#f9e3df', '#ffeae6', '#ebd6d2', '#d9c4c0', '#beaaa6', '#887572'),
    bar: zone('#e7e2c4', '#eee8ca', '#f4efd0', '#e0dbbd', '#cfc9ac', '#b4af92', '#7e7a5f'),
  },
};

/**
 * Himalaya (Nature): snow, ice and pine. Light, at the paper level.
 */
export const HIMALAYA: Appearance = {
  id: 'himalaya',
  name: 'Himalaya',
  base: 'light',
  colours: {
    ink: '#c1e8ec',
    panel: '#d3ecef',
    'panel-2': '#d9f3f5',
    'panel-3': '#c5dfe1',
    line: '#b6cdcf',
    'line-strong': '#9eb1b4',
    field: '#6e7c7d',
    fg: '#1f2828',
    muted: '#3a484a',
    faint: '#475d60',
    accent: '#1d4ed8',
    'primary-hi': '#417496',
    primary: '#376a8b',
    'primary-lo': '#2a5d7d',
    'on-primary': '#ffffff',
    'primary-edge': '#417496',
    ...LIGHT_STATES,
    warning: '#ae4f00',
  },
  decoration: {
    header: '#8ccde6',
    'on-header': '#1c292e',
    'on-header-muted': '#334951',
    'header-ring': '#1c292e',
    'header-field': '#334951',
    second: '#004f57',
    heading: '#243a69',
    'header-2': '#a9d8cf',
    strip: '#c5e8da',
    'strip-2': '#cee7ce',
    layer: '#c0d4ec',
    'layer-edge': '#5e365c',
    band: ['#8fd0ec', '#ffffff', '#2f6b52', '#5a6b80'],
  },
  zones: {
    left: zone('#d0e6df', '#d6ede6', '#ddf3ec', '#c9dfd8', '#b8cec7', '#9eb2ac', '#6a7d77'),
    middle: zone('#e6deec', '#ede5f2', '#f4ebf9', '#dfd8e5', '#cec6d3', '#b2abb7', '#7e7683'),
    right: zone('#cfe7d4', '#d6eedb', '#ddf4e2', '#c9e0ce', '#b8cfbd', '#9db3a2', '#697e6e'),
    bar: zone('#d5e6cf', '#dcedd6', '#e2f3dd', '#cedfc9', '#bdceb8', '#a2b39d', '#6e7d69'),
  },
};

/**
 * Uttarayan (Festivals): the kite festival's blue sky full of bright kites. Light, at the paper level. Moving:
 * a few kites float across the header.
 */
export const UTTARAYAN: Appearance = {
  id: 'uttarayan',
  name: 'Uttarayan',
  base: 'light',
  colours: {
    ink: '#c8e6f5',
    panel: '#d7ebf5',
    'panel-2': '#ddf1fb',
    'panel-3': '#cadde7',
    line: '#baccd4',
    'line-strong': '#a1b0b7',
    field: '#707b80',
    fg: '#20272a',
    muted: '#3b484e',
    faint: '#4a5c65',
    accent: '#1d4ed8',
    'primary-hi': '#ffe087',
    primary: '#ffd23f',
    'primary-lo': '#f0c328',
    'on-primary': '#140f02',
    'primary-edge': '#4b3d00',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#12518d',
    'on-header': '#ffffff',
    'on-header-muted': '#d5e9ff',
    'header-ring': '#ffffff',
    'header-field': '#d5e9ff',
    second: '#035974',
    heading: '#0f5f7a',
    'header-2': '#0f6d7d',
    strip: '#c6e5f7',
    'strip-2': '#b8e9ea',
    layer: '#ddd2a6',
    'layer-edge': '#884d8e',
    band: ['#e8402a', '#ffd23f', '#2fb344', '#d6238a', '#2a6fd6'],
  },
  zones: {
    left: zone('#d0e5ec', '#d6ecf3', '#dcf2f9', '#c8dee5', '#b7cdd4', '#9db1b8', '#697c83'),
    middle: zone('#e3e4be', '#eaebc4', '#f0f1ca', '#dcddb7', '#cbcca6', '#b0b08b', '#7b7b59'),
    right: zone('#efdde7', '#f5e3ed', '#fbe9f3', '#e8d5e0', '#d7c4cf', '#baa9b3', '#85747e'),
    bar: zone('#c6e9dd', '#cdf0e3', '#d2f6e9', '#bfe2d5', '#aed1c4', '#93b5a9', '#607f75'),
  },
};

/**
 * Mogra (Nature): jasmine: white flowers among green leaves, with a pink accent. Light, at the stone level.
 */
export const MOGRA: Appearance = {
  id: 'mogra',
  name: 'Mogra',
  base: 'light',
  colours: {
    ink: '#c6e1cb',
    panel: '#d5e7d8',
    'panel-2': '#dcedde',
    'panel-3': '#c7d9ca',
    line: '#b8c8bb',
    'line-strong': '#a0aea2',
    field: '#6f7871',
    fg: '#1e241f',
    muted: '#3b453c',
    faint: '#4c5a4f',
    accent: '#1b4bd5',
    'primary-hi': '#752554',
    primary: '#6a1a4a',
    'primary-lo': '#5c0a3e',
    'on-primary': '#ffffff',
    'primary-edge': '#752554',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#2c623b',
    'on-header': '#ffffff',
    'on-header-muted': '#c4dec8',
    'header-ring': '#ffffff',
    'header-field': '#c4dec8',
    second: '#22528e',
    heading: '#113a1a',
    'header-2': '#29625d',
    strip: '#bce4d1',
    'strip-2': '#b5e3ec',
    layer: '#e4ccd4',
    'layer-edge': '#006789',
    band: ['#3a8f4a', '#ffffff', '#f3ecd0', '#d6457a'],
  },
  zones: {
    left: zone('#d8ddc3', '#e0e6cc', '#e6ecd1', '#d2d8be', '#c1c7ad', '#a8ad95', '#737861'),
    middle: zone('#f5d3c9', '#fddcd1', '#ffe3da', '#efcec3', '#debdb3', '#c3a49a', '#8d6f66'),
    right: zone('#e5d6e3', '#eddeec', '#f4e4f2', '#dfd0de', '#cfc0cd', '#b5a6b4', '#7f717e'),
    bar: zone('#c0e1dc', '#c9e9e5', '#cef0eb', '#bbdbd6', '#aacbc6', '#91b1ac', '#5d7b77'),
  },
};

/**
 * Dusk Slate (Dusk): a calm slate-blue dusk: flat colour, soft words. Dark, at the twilight level. Moving: the
 * header drifts slowly from slate to indigo and back.
 */
export const DUSK_SLATE: Appearance = {
  id: 'dusk-slate',
  name: 'Dusk Slate',
  base: 'dark',
  colours: {
    ink: '#2b3547',
    panel: '#303b4d',
    'panel-2': '#353f52',
    'panel-3': '#3b4559',
    line: '#4c5567',
    'line-strong': '#626b7b',
    field: '#8b929f',
    fg: '#f3f6fd',
    muted: '#d0d6e0',
    faint: '#afb6c5',
    accent: '#a8c4ff',
    'primary-hi': '#a0adf7',
    primary: '#95a2eb',
    'primary-lo': '#8894dc',
    'on-primary': '#0c0e1c',
    'primary-edge': '#a0adf7',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#59538b',
    'on-header': '#ffffff',
    'on-header-muted': '#d6d5f2',
    'header-ring': '#ffffff',
    'header-field': '#d6d5f2',
    second: '#aab0ee',
    heading: '#cbc4fe',
    'header-2': '#59538b',
    strip: '#303b4d',
    'strip-2': '#303b4d',
    layer: '#124756',
    'layer-edge': '#e08f9d',
    band: ['#3e4a8f', '#7b5ea8', '#c9a46a'],
  },
  zones: {
    left: zone('#1c3938', '#223f3d', '#264341', '#2c4a48', '#3c5a58', '#52706e', '#789895'),
    middle: zone('#3f2f40', '#453547', '#4a394b', '#503f51', '#604f62', '#766578', '#9e8ca0'),
    right: zone('#24392c', '#2a3f32', '#2e4336', '#33493c', '#43594b', '#587061', '#7f9888'),
    bar: zone('#462f2b', '#4d3430', '#513834', '#573f3a', '#684e4a', '#7f6460', '#a88c86'),
  },
};

/**
 * Dusk Rose (Dusk): a calm rose dusk: flat colour, soft words. Dark, at the twilight level. Moving: the header
 * drifts slowly from rose to plum and back.
 */
export const DUSK_ROSE: Appearance = {
  id: 'dusk-rose',
  name: 'Dusk Rose',
  base: 'dark',
  colours: {
    ink: '#4a2d2f',
    panel: '#4f3334',
    'panel-2': '#543738',
    'panel-3': '#5b3d3f',
    line: '#694e4f',
    'line-strong': '#7e6466',
    field: '#a18d8d',
    fg: '#fdf4f4',
    muted: '#e0d2d2',
    faint: '#c5b1b2',
    accent: '#a9d4ff',
    'primary-hi': '#95eebf',
    primary: '#8ae2b4',
    'primary-lo': '#7bd3a6',
    'on-primary': '#03130b',
    'primary-edge': '#95eebf',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#814560',
    'on-header': '#fffdfe',
    'on-header-muted': '#ecccd9',
    'header-ring': '#fffdfe',
    'header-field': '#ecccd9',
    second: '#67cbe4',
    heading: '#d7b1da',
    'header-2': '#814560',
    strip: '#4f3334',
    'strip-2': '#4f3334',
    layer: '#5e362f',
    'layer-edge': '#bfac8f',
    band: ['#7a3d63', '#b0607d', '#d9a07e'],
  },
  zones: {
    left: zone('#343247', '#3a384d', '#3e3c52', '#444258', '#545269', '#6a687f', '#9190a8'),
    middle: zone('#283547', '#2e3b4d', '#323f51', '#374658', '#475669', '#5c6b7f', '#8493a8'),
    right: zone('#462f2a', '#4c342f', '#513833', '#573f39', '#684f49', '#7f645e', '#a88c85'),
    bar: zone('#323348', '#38384d', '#3c3d51', '#424359', '#525369', '#676880', '#8f90a8'),
  },
};

/**
 * Dusk Sage (Dusk): a calm sage-green dusk: flat colour, soft words. Dark, at the night level.
 */
export const DUSK_SAGE: Appearance = {
  id: 'dusk-sage',
  name: 'Dusk Sage',
  base: 'dark',
  colours: {
    ink: '#1d311d',
    panel: '#233623',
    'panel-2': '#273b27',
    'panel-3': '#2e432f',
    line: '#415441',
    'line-strong': '#586a58',
    field: '#839183',
    fg: '#ecf2ec',
    muted: '#c5cec5',
    faint: '#a4b1a4',
    accent: '#a9d4ff',
    'primary-hi': '#ffffff',
    primary: '#fff4f1',
    'primary-lo': '#f0e5e2',
    'on-primary': '#110f0e',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#006c69',
    'on-header': '#ffffff',
    'on-header-muted': '#c3e9e6',
    'header-ring': '#ffffff',
    'header-field': '#c3e9e6',
    second: '#67cbe4',
    heading: '#f0fec9',
    'header-2': '#006c69',
    strip: '#233623',
    'strip-2': '#233623',
    layer: '#194848',
    'layer-edge': '#64b8d5',
    band: ['#3f6f5a', '#7f9a62', '#c7b27a'],
  },
  zones: {
    left: zone('#332b16', '#38311b', '#3d3520', '#453d28', '#574e38', '#6d644e', '#958d75'),
    middle: zone('#3c271c', '#412d22', '#463126', '#4f392e', '#614a3e', '#786054', '#a1897b'),
    right: zone('#202d3e', '#253244', '#2a3749', '#313f50', '#425063', '#58667a', '#7f8fa3'),
    bar: zone('#2e293d', '#332e43', '#383348', '#403b50', '#514c62', '#676279', '#908aa3'),
  },
};

/**
 * Dusk Indigo (Dusk): a calm indigo dusk: flat colour, soft words. Dark, at the night level. Moving: the header
 * drifts slowly from indigo to violet and back.
 */
export const DUSK_INDIGO: Appearance = {
  id: 'dusk-indigo',
  name: 'Dusk Indigo',
  base: 'dark',
  colours: {
    ink: '#31283d',
    panel: '#382d43',
    'panel-2': '#3c3248',
    'panel-3': '#443950',
    line: '#544b60',
    'line-strong': '#6a6275',
    field: '#918a9a',
    fg: '#f1eff6',
    muted: '#cecad5',
    faint: '#b1abba',
    accent: '#b8c8ff',
    'primary-hi': '#fffcff',
    primary: '#ffeafe',
    'primary-lo': '#f0dbef',
    'on-primary': '#120e12',
    'primary-edge': '#fffcff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#494ba6',
    'on-header': '#f8f9ff',
    'on-header-muted': '#ced3f0',
    'header-ring': '#f8f9ff',
    'header-field': '#ced3f0',
    second: '#9fe49f',
    heading: '#dca6e1',
    'header-2': '#494ba6',
    strip: '#382d43',
    'strip-2': '#382d43',
    layer: '#3b3e61',
    'layer-edge': '#e0949d',
    band: ['#2e2a6a', '#5a4ab0', '#e8b4c8'],
  },
  zones: {
    left: zone('#392633', '#3f2b38', '#44303d', '#4c3745', '#5e4856', '#755f6d', '#9e8796'),
    middle: zone('#3d2525', '#432b2b', '#483030', '#503737', '#634848', '#7a5e5e', '#a38685'),
    right: zone('#172e3a', '#1d3440', '#223945', '#29404c', '#3a525f', '#506875', '#76919e'),
    bar: zone('#1d3023', '#223527', '#273a2c', '#2e4234', '#3f5344', '#556a5b', '#7c9382'),
  },
};

/**
 * Dusk Amber (Dusk): a calm amber dusk: flat colour, soft words. Dark, at the night level.
 */
export const DUSK_AMBER: Appearance = {
  id: 'dusk-amber',
  name: 'Dusk Amber',
  base: 'dark',
  colours: {
    ink: '#342c0f',
    panel: '#393114',
    'panel-2': '#3f3619',
    'panel-3': '#463d20',
    line: '#574e35',
    'line-strong': '#6c654d',
    field: '#928d7a',
    fg: '#f2f0e8',
    muted: '#cfccc0',
    faint: '#b2ae9e',
    accent: '#a8d0ff',
    'primary-hi': '#a4e5d9',
    primary: '#99d9ce',
    'primary-lo': '#8bcac0',
    'on-primary': '#051210',
    'primary-edge': '#a4e5d9',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#594000',
    'on-header': '#f8f3eb',
    'on-header-muted': '#e1d3b7',
    'header-ring': '#f8f3eb',
    'header-field': '#e1d3b7',
    second: '#fff9a9',
    heading: '#e8ce9d',
    'header-2': '#594000',
    strip: '#393114',
    'strip-2': '#393114',
    layer: '#423d5a',
    'layer-edge': '#79bba6',
    band: ['#7a5220', '#c08a3a', '#e8c890'],
  },
  zones: {
    left: zone('#3d2629', '#422b2e', '#483033', '#50373a', '#62474b', '#7a5e62', '#a38689'),
    middle: zone('#3a2633', '#3f2b38', '#45303e', '#4c3745', '#5e4856', '#755e6d', '#9e8796'),
    right: zone('#183129', '#1d362e', '#223b33', '#284239', '#39544a', '#4f6b60', '#779388'),
    bar: zone('#212d3f', '#263145', '#2b374b', '#323e52', '#434f64', '#58667b', '#808ea4'),
  },
};

/**
 * Dusk Teal (Dusk): a calm teal dusk: flat colour, soft words. Dark, at the twilight level.
 */
export const DUSK_TEAL: Appearance = {
  id: 'dusk-teal',
  name: 'Dusk Teal',
  base: 'dark',
  colours: {
    ink: '#143a3e',
    panel: '#1a4044',
    'panel-2': '#1f4449',
    'panel-3': '#254b4f',
    line: '#395a5f',
    'line-strong': '#527073',
    field: '#7f9699',
    fg: '#eef8f9',
    muted: '#c9d8d9',
    faint: '#a6babc',
    accent: '#a8d8ff',
    'primary-hi': '#e1efa7',
    primary: '#d6e39c',
    'primary-lo': '#c7d48e',
    'on-primary': '#0f1104',
    'primary-edge': '#e1efa7',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#315d68',
    'on-header': '#f5fdff',
    'on-header-muted': '#b7dbe4',
    'header-ring': '#f5fdff',
    'header-field': '#b7dbe4',
    second: '#ffc6ca',
    heading: '#b7feff',
    'header-2': '#315d68',
    strip: '#1a4044',
    'strip-2': '#1a4044',
    layer: '#11493d',
    'layer-edge': '#e4d19e',
    band: ['#1f5560', '#3a8a8a', '#a8d8c8'],
  },
  zones: {
    left: zone('#283547', '#2e3b4d', '#323f51', '#384659', '#475668', '#5d6c80', '#8494a8'),
    middle: zone('#243645', '#2a3c4c', '#2d4050', '#344757', '#435767', '#596d7e', '#7f95a6'),
    right: zone('#38351f', '#3e3b25', '#423f29', '#484630', '#58553e', '#6e6b54', '#959379'),
    bar: zone('#1b393b', '#213f41', '#254345', '#2c4a4c', '#3b5a5b', '#517072', '#779899'),
  },
};

/**
 * Manek (Jewels): ruby (manek): deep crimson with gold and pearl. Dark, at the night level. Moving: a sparkle
 * crosses the band now and then.
 */
export const MANEK: Appearance = {
  id: 'manek',
  name: 'Manek',
  base: 'dark',
  colours: {
    ink: '#4a1e26',
    panel: '#50242c',
    'panel-2': '#562831',
    'panel-3': '#5e3038',
    line: '#6e4349',
    'line-strong': '#835b60',
    field: '#9f878a',
    fg: '#f7eeef',
    muted: '#d7c8ca',
    faint: '#bca9ab',
    accent: '#ffd0a0',
    'primary-hi': '#efc7d5',
    primary: '#e3bcca',
    'primary-lo': '#d4aebc',
    'on-primary': '#150d10',
    'primary-edge': '#efc7d5',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#93023e',
    'on-header': '#fcf1f2',
    'on-header-muted': '#efccd1',
    'header-ring': '#fcf1f2',
    'header-field': '#efccd1',
    second: '#fbe38c',
    heading: '#fbb9e9',
    'header-2': '#5f094e',
    strip: '#532c27',
    'strip-2': '#243856',
    layer: '#543751',
    'layer-edge': '#d1be8d',
    band: ['#9b111e', '#e0b84a', '#f4ead8', '#9b111e'],
  },
  zones: {
    left: zone('#43231d', '#492922', '#4e2e26', '#57352e', '#69463f', '#815d55', '#ab847b'),
    middle: zone('#232b45', '#28304c', '#2d3551', '#343d58', '#454e6c', '#5a6583', '#818dad'),
    right: zone('#3c2533', '#412b39', '#462f3e', '#4e3645', '#604857', '#785e6e', '#a18596'),
    bar: zone('#232b40', '#283147', '#2d364b', '#343d53', '#454f65', '#5b657d', '#828da6'),
  },
};

/**
 * Panna (Jewels): emerald (panna): deep green with gold. Dark, at the twilight level. Moving: a sparkle crosses
 * the band now and then.
 */
export const PANNA: Appearance = {
  id: 'panna',
  name: 'Panna',
  base: 'dark',
  colours: {
    ink: '#1a3c16',
    panel: '#1f421c',
    'panel-2': '#244721',
    'panel-3': '#2a4d26',
    line: '#3d5d3a',
    'line-strong': '#557252',
    field: '#879685',
    fg: '#f2f8f1',
    muted: '#cfd8ce',
    faint: '#adb9ac',
    accent: '#9ff0d0',
    'primary-hi': '#ffffff',
    primary: '#f2fffe',
    'primary-lo': '#e3f0ef',
    'on-primary': '#0d1010',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#096038',
    'on-header': '#eef7f1',
    'on-header-muted': '#bfdcc8',
    'header-ring': '#eef7f1',
    'header-field': '#bfdcc8',
    second: '#e3fa99',
    heading: '#9adbce',
    'header-2': '#064b3a',
    strip: '#104655',
    'strip-2': '#29472b',
    layer: '#33415c',
    'layer-edge': '#d2e1a2',
    band: ['#0b6e4f', '#2fa36b', '#e8d48a'],
  },
  zones: {
    left: zone('#3a3510', '#3f3b16', '#44401b', '#4a4521', '#5b5631', '#706b46', '#98946c'),
    middle: zone('#123a37', '#19403d', '#1e4542', '#244b48', '#355c58', '#4a716e', '#719a95'),
    right: zone('#283923', '#2d3f28', '#32432c', '#384932', '#485a42', '#5c7056', '#83987d'),
    bar: zone('#482d2d', '#4f3333', '#543837', '#5a3d3d', '#6b4e4d', '#826363', '#ab8a8a'),
  },
};

/**
 * Neelam (Jewels): sapphire (neelam): royal blue with gold. Dark, at the twilight level. Moving: a sparkle
 * crosses the band now and then.
 */
export const NEELAM: Appearance = {
  id: 'neelam',
  name: 'Neelam',
  base: 'dark',
  colours: {
    ink: '#023954',
    panel: '#083e59',
    'panel-2': '#0f435f',
    'panel-3': '#184966',
    line: '#2f5974',
    'line-strong': '#4a6f87',
    field: '#8195a2',
    fg: '#f0f7fb',
    muted: '#cbd7de',
    faint: '#a9b8c2',
    accent: '#9cc3ff',
    'primary-hi': '#eeecad',
    primary: '#e2e0a2',
    'primary-lo': '#d3d194',
    'on-primary': '#111004',
    'primary-edge': '#eeecad',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#191fa1',
    'on-header': '#f0f4fc',
    'on-header-muted': '#cad5f0',
    'header-ring': '#f0f4fc',
    'header-field': '#cad5f0',
    second: '#fbfcff',
    heading: '#95c7e8',
    'header-2': '#0f1277',
    strip: '#4f3856',
    'strip-2': '#4d3859',
    layer: '#22445e',
    'layer-edge': '#e8c870',
    band: ['#0f2a8a', '#3a6ad8', '#c8d8ff', '#e8c060'],
  },
  zones: {
    left: zone('#213554', '#263a59', '#2b3f5e', '#304565', '#405576', '#556b8d', '#7b94b7'),
    middle: zone('#34324f', '#383754', '#3c3c59', '#43425f', '#525270', '#686788', '#9090b1'),
    right: zone('#0d3a44', '#133f49', '#19444e', '#204a54', '#305a65', '#46717c', '#6e99a4'),
    bar: zone('#433123', '#483628', '#4e3b2d', '#544133', '#645142', '#7b6657', '#a48f7e'),
  },
};

/**
 * Moti (Jewels): pearl (moti): soft lustrous whites, pinks and greys. Light, at the stone level. Moving: a soft
 * lustre passes along the band.
 */
export const MOTI: Appearance = {
  id: 'moti',
  name: 'Moti',
  base: 'light',
  colours: {
    ink: '#e3d6e4',
    panel: '#e7e0e7',
    'panel-2': '#ede7ee',
    'panel-3': '#d9d3da',
    line: '#c8c2c8',
    'line-strong': '#aea8ae',
    field: '#787579',
    fg: '#252126',
    muted: '#484049',
    faint: '#5f5360',
    accent: '#3a4ab8',
    'primary-hi': '#604065',
    primary: '#56375b',
    'primary-lo': '#4a2b4e',
    'on-primary': '#ffffff',
    'primary-edge': '#604065',
    ...LIGHT_STATES,
    warning: '#843300',
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#aa91be',
    'on-header': '#0e0a12',
    'on-header-muted': '#342b3a',
    'header-ring': '#0e0a12',
    'header-field': '#342b3a',
    second: '#69416e',
    heading: '#7b3f6d',
    'header-2': '#dcafbe',
    strip: '#e1d8e4',
    'strip-2': '#dadae8',
    layer: '#dbcde0',
    'layer-edge': '#75414f',
    band: ['#f4eef4', '#e0d8e8', '#c8c0d8', '#f8f0e8'],
  },
  zones: {
    left: zone('#e8d6d5', '#f1dede', '#f7e5e4', '#e3d1d0', '#d2c0bf', '#b7a6a6', '#827272'),
    middle: zone('#dfd8e5', '#e7e0ed', '#eee7f4', '#dad3e0', '#c9c1cf', '#afa8b4', '#7a7380'),
    right: zone('#e8d6d5', '#f1dedd', '#f7e5e4', '#e3d1d0', '#d2c0bf', '#b7a6a6', '#827272'),
    bar: zone('#cbdede', '#d3e6e6', '#daeded', '#c6d9d9', '#b5c8c8', '#9caeae', '#69797a'),
  },
};

/**
 * Pukhraj (Jewels): yellow sapphire (pukhraj): honey and topaz. Dark, at the twilight level.
 */
export const PUKHRAJ: Appearance = {
  id: 'pukhraj',
  name: 'Pukhraj',
  base: 'dark',
  colours: {
    ink: '#4b2f0f',
    panel: '#503415',
    'panel-2': '#56391a',
    'panel-3': '#5c3f20',
    line: '#6b5035',
    'line-strong': '#7f664d',
    field: '#9f8f7f',
    fg: '#fbf5ef',
    muted: '#ddd4cb',
    faint: '#c0b4a8',
    accent: '#a8d8ff',
    'primary-hi': '#ffffff',
    primary: '#fffbf7',
    'primary-lo': '#f0ece8',
    'on-primary': '#100f0e',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#ffc137',
    'on-header': '#292319',
    'on-header-muted': '#453d2b',
    'header-ring': '#292319',
    'header-field': '#453d2b',
    second: '#fcffca',
    heading: '#f8fb97',
    'header-2': '#e8a000',
    strip: '#29472a',
    'strip-2': '#5c3540',
    layer: '#4a3b57',
    'layer-edge': '#f2fffe',
    band: ['#e8b820', '#f4d470', '#8a6410'],
  },
  zones: {
    left: zone('#253a26', '#2a3f2a', '#2f442f', '#354a35', '#445a44', '#597059', '#80987f'),
    middle: zone('#34371c', '#393c20', '#3e4125', '#44472b', '#53573a', '#696d50', '#909575'),
    right: zone('#463023', '#4c3428', '#513a2d', '#583f32', '#685042', '#7f6557', '#a88c7d'),
    bar: zone('#1d3938', '#223e3d', '#274443', '#2d4a48', '#3d5a59', '#52706e', '#789895'),
  },
};

/**
 * Heera (Jewels): diamond (heera): icy clear with a prism's glints. Dark, at the night level. Moving: a glint
 * sweeps the band and the header.
 */
export const HEERA: Appearance = {
  id: 'heera',
  name: 'Heera',
  base: 'dark',
  colours: {
    ink: '#183034',
    panel: '#1d3539',
    'panel-2': '#223a3e',
    'panel-3': '#2a4146',
    line: '#3d5257',
    'line-strong': '#55696d',
    field: '#809093',
    fg: '#e8f2f3',
    muted: '#c0ced2',
    faint: '#9eb1b5',
    accent: '#c0d8ff',
    'primary-hi': '#ffffff',
    primary: '#fafcff',
    'primary-lo': '#ebedf0',
    'on-primary': '#0f0f10',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#241d3b',
    'on-header': '#f4f3fb',
    'on-header-muted': '#d6d1ee',
    'header-ring': '#f4f3fb',
    'header-field': '#d6d1ee',
    second: '#cefff9',
    heading: '#b1d8ff',
    'header-2': '#47415f',
    strip: '#183b4c',
    'strip-2': '#472f45',
    layer: '#254457',
    'layer-edge': '#f7fdff',
    band: ['#a8e8ff', '#ffc8f0', '#fff0a8', '#c8b8ff', '#ffffff'],
  },
  zones: {
    left: zone('#183129', '#1d362e', '#223b33', '#29423a', '#39534b', '#506b62', '#77948a'),
    middle: zone('#352738', '#3a2c3d', '#3f3143', '#47384a', '#58495c', '#706073', '#98889c'),
    right: zone('#292e1a', '#2e331f', '#333824', '#3a3f2b', '#4b513c', '#626852', '#8a9078'),
    bar: zone('#272b3e', '#2c3044', '#303549', '#373c50', '#484e62', '#5f647a', '#868da3'),
  },
};

/**
 * Gulmohar (Nature): the gulmohar tree in flower: flame red and orange over green. Light, at the stone level.
 * Moving: a few flame-red petals drift down the header.
 */
export const GULMOHAR: Appearance = {
  id: 'gulmohar',
  name: 'Gulmohar',
  base: 'light',
  colours: {
    ink: '#ead7c5',
    panel: '#ede0d4',
    'panel-2': '#f3e7db',
    'panel-3': '#dfd3c7',
    line: '#cdc2b8',
    'line-strong': '#b2a8a0',
    field: '#7b756e',
    fg: '#27211c',
    muted: '#4a4138',
    faint: '#625448',
    accent: '#1c4dd7',
    'primary-hi': '#4a7695',
    primary: '#406c8a',
    'primary-lo': '#335f7c',
    'on-primary': '#ffffff',
    'primary-edge': '#4a7695',
    ...LIGHT_STATES,
    warning: '#752900',
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#ea4c50',
    'on-header': '#000000',
    'on-header-muted': '#241211',
    'header-ring': '#000000',
    'header-field': '#241211',
    second: '#371d00',
    heading: '#006652',
    'header-2': '#ff8661',
    strip: '#f0d3e4',
    'strip-2': '#f6d3d2',
    layer: '#bad6e3',
    'layer-edge': '#777653',
    band: ['#d8401a', '#f08a2a', '#f8c840', '#3a8a3a'],
  },
  zones: {
    left: zone('#dfdbc1', '#e7e3c8', '#edeacf', '#d9d6bc', '#c8c5ab', '#aeab92', '#7a765f'),
    middle: zone('#d3dec9', '#dbe6d1', '#e1edd8', '#ced9c4', '#bdc8b3', '#a3ae9a', '#6f7967'),
    right: zone('#ebd7c3', '#f3dfca', '#f9e6d1', '#e5d2bd', '#d4c1ac', '#b9a793', '#847361'),
    bar: zone('#e9d5e4', '#f1ddec', '#f8e3f3', '#e3d0df', '#d2bfcd', '#b8a5b3', '#82707e'),
  },
};

/**
 * Kesuda (Nature): kesuda (palash) in flower: orange blossoms on dark branches. Light, at the paper level.
 * Moving: a few orange petals fall past the header.
 */
export const KESUDA: Appearance = {
  id: 'kesuda',
  name: 'Kesuda',
  base: 'light',
  colours: {
    ink: '#ffdabe',
    panel: '#fee3cf',
    'panel-2': '#ffeada',
    'panel-3': '#f1d5c1',
    line: '#ddc4b3',
    'line-strong': '#beaa9a',
    field: '#85766b',
    fg: '#2a2520',
    muted: '#4e443c',
    faint: '#66564c',
    accent: '#1d4ed8',
    'primary-hi': '#166c76',
    primary: '#00626c',
    'primary-lo': '#00545d',
    'on-primary': '#ffffff',
    'primary-edge': '#166c76',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#220c00',
    'on-header': '#fbf2ec',
    'on-header-muted': '#eccfbd',
    'header-ring': '#fbf2ec',
    'header-field': '#eccfbd',
    second: '#473200',
    heading: '#493300',
    'header-2': '#3d1702',
    strip: '#fbd7df',
    'strip-2': '#f6d8ea',
    layer: '#cfd4bf',
    'layer-edge': '#247171',
    band: ['#f06a0a', '#ff9a2a', '#2a1a10'],
  },
  zones: {
    left: zone('#dfe4c9', '#e6ebd0', '#ecf1d6', '#d8ddc3', '#c7ccb2', '#acb097', '#777b63'),
    middle: zone('#eedcec', '#f6e3f3', '#fce8f9', '#e7d5e5', '#d6c4d4', '#baa9b8', '#847382'),
    right: zone('#f1dec9', '#f9e5d0', '#ffebd6', '#ebd7c2', '#d9c6b2', '#bdab97', '#877563'),
    bar: zone('#d7e2f2', '#dee9f9', '#e4efff', '#d1dbeb', '#c0cada', '#a5afbe', '#707988'),
  },
};

/**
 * Champa (Nature): champa (frangipani): cream and pink petals, golden centres, green leaves. Light, at the
 * paper level. Moving: a few white-and-gold petals drift across the header.
 */
export const CHAMPA: Appearance = {
  id: 'champa',
  name: 'Champa',
  base: 'light',
  colours: {
    ink: '#f6dbdc',
    panel: '#f6e3e4',
    'panel-2': '#fceaea',
    'panel-3': '#e8d6d6',
    line: '#d5c5c5',
    'line-strong': '#b8abab',
    field: '#807777',
    fg: '#2b2424',
    muted: '#504243',
    faint: '#685555',
    accent: '#1d4ed8',
    'primary-hi': '#f4bb33',
    primary: '#e8b020',
    'primary-lo': '#d8a200',
    'on-primary': '#150e02',
    'primary-edge': '#4e3d00',
    ...LIGHT_STATES,
    warning: '#a84b00',
  },
  decoration: {
    header: '#deb1b9',
    'on-header': '#302426',
    'on-header-muted': '#554043',
    'header-ring': '#302426',
    'header-field': '#554043',
    second: '#4d3000',
    heading: '#6a2a3a',
    'header-2': '#deb1b9',
    strip: '#f5dadc',
    'strip-2': '#e8e0c3',
    layer: '#ded0b9',
    'layer-edge': '#71895e',
    band: ['#fff8f0', '#f8d870', '#f4b8c8', '#4a8a3a'],
  },
  zones: {
    left: zone('#f6dbdc', '#fde1e2', '#ffeaea', '#efd4d5', '#ddc3c4', '#c2a8a9', '#8b7375'),
    middle: zone('#e8e2c8', '#eee8ce', '#f5efd4', '#e1dbc1', '#cfc9af', '#b5ae95', '#7f7962'),
    right: zone('#d6e6d3', '#dcecd9', '#e3f3e0', '#cfdfcc', '#becdba', '#a4b2a0', '#6f7c6c'),
    bar: zone('#efdde8', '#f5e3ee', '#fce9f4', '#e8d5e1', '#d5c4cf', '#bbaab4', '#85747f'),
  },
};

/**
 * Sagar (Nature): the sea (sagar): deep blues and greens, foam and sand. Dark, at the night level. Moving:
 * waves: the band shimmers and the header’s blues roll slowly.
 */
export const SAGAR: Appearance = {
  id: 'sagar',
  name: 'Sagar',
  base: 'dark',
  colours: {
    ink: '#00313e',
    panel: '#003746',
    'panel-2': '#053c4b',
    'panel-3': '#0f4352',
    line: '#2a5462',
    'line-strong': '#466b78',
    field: '#799199',
    fg: '#e9f2f5',
    muted: '#c0ced3',
    faint: '#9fb1b7',
    accent: '#ffe0b0',
    'primary-hi': '#66dcf0',
    primary: '#59d0e4',
    'primary-lo': '#48c1d5',
    'on-primary': '#001317',
    'primary-edge': '#66dcf0',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#064376',
    'on-header': '#ffffff',
    'on-header-muted': '#c5dbf2',
    'header-ring': '#ffffff',
    'header-field': '#c5dbf2',
    second: '#feffc4',
    heading: '#acc3f4',
    'header-2': '#006475',
    strip: '#1b3e25',
    'strip-2': '#133f2b',
    layer: '#35415c',
    'layer-edge': '#fff8ef',
    band: ['#0a4a78', '#1a8aa8', '#a8e8e8', '#e8d8b0'],
  },
  zones: {
    left: zone('#15321e', '#1b3723', '#203c28', '#27432f', '#385540', '#4f6c56', '#75957d'),
    middle: zone('#1c311e', '#213722', '#263b27', '#2c422e', '#3d543f', '#546b55', '#7b947c'),
    right: zone('#2d2844', '#332e4b', '#37334f', '#3e3957', '#4f4b69', '#666282', '#8e8aab'),
    bar: zone('#232f1b', '#293520', '#2d3a25', '#34412c', '#45523c', '#5b6a53', '#829279'),
  },
};

/**
 * Akash (Nature): the sky (akash): bright blue with white clouds and the sun. Light, at the paper level.
 * Moving: white clouds drift across the header.
 */
export const AKASH: Appearance = {
  id: 'akash',
  name: 'Akash',
  base: 'light',
  colours: {
    ink: '#b3eafb',
    panel: '#caeef9',
    'panel-2': '#d1f4ff',
    'panel-3': '#bce0eb',
    line: '#aeced8',
    'line-strong': '#97b2bb',
    field: '#697c82',
    fg: '#1f2729',
    muted: '#3a484c',
    faint: '#495d63',
    accent: '#1d4ed8',
    'primary-hi': '#63749d',
    primary: '#5c6e96',
    'primary-lo': '#506188',
    'on-primary': '#ffffff',
    'primary-edge': '#63749d',
    ...LIGHT_STATES,
    warning: '#722700',
  },
  decoration: {
    header: '#2588da',
    'on-header': '#000000',
    'on-header-muted': '#0b1723',
    'header-ring': '#000000',
    'header-field': '#0b1723',
    second: '#4c41a2',
    heading: '#00647a',
    'header-2': '#42a8fd',
    strip: '#d4e1f8',
    'strip-2': '#c4e7e7',
    layer: '#d7cee2',
    'layer-edge': '#30599f',
    band: ['#3a8ad8', '#a8d8f8', '#ffffff', '#f0c040'],
  },
  zones: {
    left: zone('#e2dff5', '#e9e6fc', '#efecff', '#dbd8ed', '#cac6dc', '#afabc0', '#7a768a'),
    middle: zone('#d5e6d4', '#dbeddb', '#e1f3e1', '#cddfcd', '#bccebc', '#a2b2a1', '#6d7d6d'),
    right: zone('#f6dcda', '#fde2e0', '#ffeae8', '#efd4d2', '#ddc3c1', '#c1a8a6', '#8b7372'),
    bar: zone('#eadeed', '#f1e4f4', '#f7eafa', '#e3d6e6', '#d1c5d4', '#b5aab9', '#807584'),
  },
};

/**
 * Chandni (Nature): moonlight (chandni): silver and night blue. Light, at the stone level. Moving: the moon
 * glows softly at the header’s end.
 */
export const CHANDNI: Appearance = {
  id: 'chandni',
  name: 'Chandni',
  base: 'light',
  colours: {
    ink: '#ded7e9',
    panel: '#e5e0ec',
    'panel-2': '#ece7f3',
    'panel-3': '#d8d2df',
    line: '#c7c2cd',
    'line-strong': '#aca9b2',
    field: '#77757b',
    fg: '#242127',
    muted: '#45414b',
    faint: '#5a5463',
    accent: '#3a4ab8',
    'primary-hi': '#457a9b',
    primary: '#3d7292',
    'primary-lo': '#306584',
    'on-primary': '#ffffff',
    'primary-edge': '#457a9b',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#1d1b45',
    'on-header': '#f2f3fc',
    'on-header-muted': '#d0d3ef',
    'header-ring': '#f2f3fc',
    'header-field': '#d0d3ef',
    second: '#494984',
    heading: '#30124b',
    'header-2': '#2d255d',
    strip: '#e9d6e0',
    'strip-2': '#c8e0df',
    layer: '#c0d7cb',
    'layer-edge': '#50407d',
    band: ['#1a2050', '#c8c8e8', '#f8f8ff'],
  },
  zones: {
    left: zone('#e8d5df', '#f0dde8', '#f7e4ef', '#e2d0da', '#d2bfc9', '#b8a6af', '#82717b'),
    middle: zone('#d0dce7', '#d8e4ef', '#dfebf6', '#cad6e1', '#bac6d1', '#a1acb6', '#6d7782'),
    right: zone('#dfd8e5', '#e8dfed', '#efe6f4', '#d9d2df', '#c9c2cf', '#afa8b4', '#7b737f'),
    bar: zone('#cbdedb', '#d3e6e4', '#daedeb', '#c6d9d6', '#b5c8c5', '#9daeac', '#697978'),
  },
};

/**
 * Bandhani (Crafts and textiles): bandhani tie-dye: red, yellow, green and white dots; colours only. Light, at
 * the paper level.
 */
export const BANDHANI: Appearance = {
  id: 'bandhani',
  name: 'Bandhani',
  base: 'light',
  colours: {
    ink: '#fbd8e2',
    panel: '#f9e2e8',
    'panel-2': '#ffe8ee',
    'panel-3': '#ecd4db',
    line: '#d8c4c9',
    'line-strong': '#bbaaae',
    field: '#827679',
    fg: '#2b2426',
    muted: '#4f4246',
    faint: '#68545a',
    accent: '#1d4ed8',
    'primary-hi': '#281d95',
    primary: '#220d8a',
    'primary-lo': '#1a0075',
    'on-primary': '#ffffff',
    'primary-edge': '#281d95',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#3a0018',
    'on-header': '#fcf1f3',
    'on-header-muted': '#eeccd3',
    'header-ring': '#fcf1f3',
    'header-field': '#eeccd3',
    second: '#9f0a7a',
    heading: '#7d0051',
    'header-2': '#760028',
    strip: '#f0daee',
    'strip-2': '#f7dbc7',
    layer: '#b7d8d6',
    'layer-edge': '#9a8662',
    band: ['#c8102e', '#ffffff', '#f2c230', '#ffffff', '#1f8a3a'],
  },
  zones: {
    left: zone('#f6dae5', '#fde1ec', '#ffe8f1', '#efd3de', '#ddc2cd', '#c3a7b3', '#8b727d'),
    middle: zone('#f7dcc8', '#fee3cf', '#ffeadb', '#f1d5c2', '#dfc4b1', '#c4aa97', '#8d7463'),
    right: zone('#eae1c7', '#f1e8ce', '#f7eed4', '#e3dac0', '#d2c9b0', '#b6ae95', '#817862'),
    bar: zone('#f5dbdc', '#fde2e3', '#ffe9ea', '#eed4d5', '#ddc3c4', '#c2a8aa', '#8b7375'),
  },
};

/**
 * Patola (Crafts and textiles): Patan's patola double ikat: red, green, yellow, white and black; colours only.
 * Dark, at the twilight level.
 */
export const PATOLA: Appearance = {
  id: 'patola',
  name: 'Patola',
  base: 'dark',
  colours: {
    ink: '#243a23',
    panel: '#294029',
    'panel-2': '#2e442d',
    'panel-3': '#344b34',
    line: '#455a45',
    'line-strong': '#5d705c',
    field: '#879686',
    fg: '#f2f8f1',
    muted: '#cfd8ce',
    faint: '#adb9ac',
    accent: '#a8d8ff',
    'primary-hi': '#ffffff',
    primary: '#fff6c0',
    'primary-lo': '#f0e7b2',
    'on-primary': '#121005',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9997',
    rec: '#ff9891',
  },
  decoration: {
    header: '#921327',
    'on-header': '#fdf1f1',
    'on-header-muted': '#f0cccb',
    'header-ring': '#fdf1f1',
    'header-field': '#f0cccb',
    second: '#ffbce2',
    heading: '#fff0b8',
    'header-2': '#165434',
    strip: '#5e3532',
    'strip-2': '#444219',
    layer: '#51394f',
    'layer-edge': '#fff4de',
    band: ['#b01e2e', '#1f7a4a', '#f2c230', '#ffffff', '#2a2a6a'],
  },
  zones: {
    left: zone('#2e381e', '#343e23', '#384228', '#3f482e', '#4e583d', '#646f52', '#8b9779'),
    middle: zone('#4c2c27', '#53312d', '#573631', '#5f3c37', '#6f4c46', '#87625c', '#b08982'),
    right: zone('#2f381d', '#353d23', '#394127', '#40482d', '#4f583d', '#656e52', '#8c9678'),
    bar: zone('#3c3046', '#41364c', '#453a50', '#4c4157', '#5c5067', '#73667f', '#9a8da7'),
  },
};

/**
 * Ajrakh (Crafts and textiles): ajrakh block print: indigo and madder red on black and white; colours only.
 * Dark, at the night level.
 */
export const AJRAKH: Appearance = {
  id: 'ajrakh',
  name: 'Ajrakh',
  base: 'dark',
  colours: {
    ink: '#252c40',
    panel: '#2a3146',
    'panel-2': '#2e364b',
    'panel-3': '#353d53',
    line: '#474f63',
    'line-strong': '#5e6578',
    field: '#878d9c',
    fg: '#edf0f7',
    muted: '#c8ccd7',
    faint: '#a8aebc',
    accent: '#a8c0ff',
    'primary-hi': '#dcc7ff',
    primary: '#d2b9fb',
    'primary-lo': '#c4abec',
    'on-primary': '#120c1a',
    'primary-edge': '#dcc7ff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#89230b',
    'on-header': '#fcf2ef',
    'on-header-muted': '#efcdc5',
    'header-ring': '#fcf2ef',
    'header-field': '#efcdc5',
    second: '#ffcac8',
    heading: '#fedaae',
    'header-2': '#19256a',
    strip: '#47340d',
    'strip-2': '#3f3151',
    layer: '#573844',
    'layer-edge': '#dce0cf',
    band: ['#1a2a6a', '#a8281a', '#f4ead8', '#1a1a1a'],
  },
  zones: {
    left: zone('#12303a', '#17353f', '#1c3a45', '#23414c', '#35535e', '#4a6975', '#72929e'),
    middle: zone('#412427', '#47292c', '#4c2e31', '#543538', '#674649', '#7f5c5f', '#a98486'),
    right: zone('#192f3b', '#1f3440', '#233945', '#2a404d', '#3c525f', '#516876', '#78919f'),
    bar: zone('#372a1c', '#3c2f21', '#413426', '#483b2d', '#5a4d3e', '#716253', '#998b7a'),
  },
};

/**
 * Kalamkari (Crafts and textiles): kalamkari painting: kalam black, rust, indigo and mustard on cream; colours
 * only. Light, at the stone level.
 */
export const KALAMKARI: Appearance = {
  id: 'kalamkari',
  name: 'Kalamkari',
  base: 'light',
  colours: {
    ink: '#e3dbad',
    panel: '#e8e3c4',
    'panel-2': '#eeeacb',
    'panel-3': '#dad6b7',
    line: '#c9c5aa',
    'line-strong': '#aeab93',
    field: '#797766',
    fg: '#24221c',
    muted: '#444337',
    faint: '#5a5746',
    accent: '#1c4dd7',
    'primary-hi': '#86130d',
    primary: '#7a0001',
    'primary-lo': '#650000',
    'on-primary': '#ffffff',
    'primary-edge': '#86130d',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#2a0e00',
    'on-header': '#fbf2ed',
    'on-header-muted': '#eccfbf',
    'header-ring': '#fbf2ed',
    'header-field': '#eccfbf',
    second: '#9c2549',
    heading: '#521c12',
    'header-2': '#621107',
    strip: '#cce1c9',
    'strip-2': '#dfdcc2',
    layer: '#bbd7db',
    'layer-edge': '#5c163e',
    band: ['#2a3a7a', '#a84a1a', '#d8a830', '#2a2018'],
  },
  zones: {
    left: zone('#f2d4cd', '#fadcd5', '#ffe3dc', '#eccfc8', '#dbbeb7', '#c1a49e', '#8b706b'),
    middle: zone('#dedbc4', '#e6e3cc', '#edead3', '#d9d6bf', '#c8c5af', '#aeab95', '#7a7762'),
    right: zone('#dfd7e8', '#e8dff0', '#eee6f7', '#dad2e3', '#cac1d2', '#b0a7b8', '#7b7383'),
    bar: zone('#dadcc5', '#e3e4cd', '#e9ebd4', '#d5d7c0', '#c4c6b0', '#aaac96', '#767863'),
  },
};

/**
 * Madhubani (Crafts and textiles): Madhubani painting: bright red, yellow, green, blue and pink on paper;
 * colours only. Light, at the paper level.
 */
export const MADHUBANI: Appearance = {
  id: 'madhubani',
  name: 'Madhubani',
  base: 'light',
  colours: {
    ink: '#ede0c4',
    panel: '#efe7d4',
    'panel-2': '#f5edda',
    'panel-3': '#e2dac8',
    line: '#cfc8b8',
    'line-strong': '#b4ad9f',
    field: '#7d796f',
    fg: '#28261f',
    muted: '#4a453a',
    faint: '#605949',
    accent: '#1d4ed8',
    'primary-hi': '#638cc0',
    primary: '#5981b5',
    'primary-lo': '#567fb2',
    'on-primary': '#07101b',
    'primary-edge': '#5880b3',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#203093',
    'on-header': '#f0f4fc',
    'on-header-muted': '#cad5f0',
    'header-ring': '#f0f4fc',
    'header-field': '#cad5f0',
    second: '#a50073',
    heading: '#4d477e',
    'header-2': '#280814',
    strip: '#f8d9d6',
    'strip-2': '#c1e8e3',
    layer: '#e1ccde',
    'layer-edge': '#a25771',
    band: ['#d82020', '#f8c820', '#1a8a3a', '#1a3a9a', '#e83a8a'],
  },
  zones: {
    left: zone('#d5e7d0', '#dbedd6', '#e1f3dc', '#cee0c9', '#bcceb8', '#a2b39d', '#6e7d6a'),
    middle: zone('#e9ddf1', '#f0e4f8', '#f6eafe', '#e2d7eb', '#d0c5d8', '#b5aabd', '#807588'),
    right: zone('#cce8d9', '#d2efe0', '#d8f5e6', '#c6e1d3', '#b3cfc1', '#99b4a6', '#657f72'),
    bar: zone('#dfe0f6', '#e5e6fc', '#ececff', '#d9d9ef', '#c7c7dc', '#acacc1', '#77778b'),
  },
};

/**
 * Warli (Crafts and textiles): Warli painting: white on terracotta; colours only. Dark, at the night level.
 */
export const WARLI: Appearance = {
  id: 'warli',
  name: 'Warli',
  base: 'dark',
  colours: {
    ink: '#46221a',
    panel: '#4c281f',
    'panel-2': '#522c24',
    'panel-3': '#59342b',
    line: '#69463d',
    'line-strong': '#7f5d56',
    field: '#9f8882',
    fg: '#f7efec',
    muted: '#d6c9c5',
    faint: '#bcaaa5',
    accent: '#ffd0a8',
    'primary-hi': '#ffffff',
    primary: '#fffbf9',
    'primary-lo': '#f0ecea',
    'on-primary': '#100f0f',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#6c4b3e',
    'on-header': '#fcf2ee',
    'on-header-muted': '#eecec1',
    'header-ring': '#fcf2ee',
    'header-field': '#eecec1',
    second: '#e4c999',
    heading: '#ffd3cc',
    'header-2': '#6c4b3e',
    strip: '#4c281f',
    'strip-2': '#4c281f',
    layer: '#1d483e',
    'layer-edge': '#cbd3c4',
    band: ['#8a3a1a', '#f8f0e0', '#c88a3a'],
  },
  zones: {
    left: zone('#322c0b', '#383111', '#3d3616', '#443d1d', '#554e2e', '#6c6544', '#958e6b'),
    middle: zone('#2a2e17', '#2f341c', '#343820', '#3b4028', '#4c5138', '#62674d', '#8a9074'),
    right: zone('#3d2719', '#422d1e', '#473123', '#4f382a', '#61493a', '#796050', '#a28877'),
    bar: zone('#2d2d19', '#32331e', '#373722', '#3e3f2a', '#4f503a', '#65664f', '#8d8f76'),
  },
};

/**
 * Sandstone (Mandir materials): the mandir's carved pink sandstone. Light, at the stone level.
 */
export const SANDSTONE: Appearance = {
  id: 'sandstone',
  name: 'Sandstone',
  base: 'light',
  colours: {
    ink: '#ffcfcd',
    panel: '#fddad9',
    'panel-2': '#ffe2e1',
    'panel-3': '#efcdcb',
    line: '#dcbdbc',
    'line-strong': '#bea4a3',
    field: '#847271',
    fg: '#282120',
    muted: '#4d403f',
    faint: '#665251',
    accent: '#1c4dd7',
    'primary-hi': '#124d67',
    primary: '#03435d',
    'primary-lo': '#00374d',
    'on-primary': '#ffffff',
    'primary-edge': '#124d67',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#9f4b28',
    'on-header': '#ffffff',
    'on-header-muted': '#ffe1d5',
    'header-ring': '#ffffff',
    'header-field': '#ffe1d5',
    second: '#923343',
    heading: '#442700',
    'header-2': '#7d3b1b',
    strip: '#edd4e4',
    'strip-2': '#e8d5ea',
    layer: '#e2ccd8',
    'layer-edge': '#52748f',
    band: ['#c87a5a', '#e8c0a0', '#8a4030'],
  },
  zones: {
    left: zone('#edd4e3', '#f5dbeb', '#fbe2f2', '#e7cedd', '#d6becd', '#bca4b3', '#866f7e'),
    middle: zone('#efd5d5', '#f7dcdc', '#fee3e3', '#e9cfcf', '#d9bebf', '#bea4a4', '#887071'),
    right: zone('#d6dec8', '#dee5cf', '#e4ecd6', '#d0d8c2', '#c0c7b2', '#a6ad98', '#727865'),
    bar: zone('#ccdee3', '#d4e6eb', '#daecf1', '#c6d8dd', '#b6c8cd', '#9cadb2', '#69787d'),
  },
};

/**
 * Teak (Mandir materials): carved teak wood: warm browns. Dark, at the twilight level.
 */
export const TEAK: Appearance = {
  id: 'teak',
  name: 'Teak',
  base: 'dark',
  colours: {
    ink: '#46310a',
    panel: '#4c3610',
    'panel-2': '#513b15',
    'panel-3': '#58411d',
    line: '#665231',
    'line-strong': '#7a684b',
    field: '#9c907e',
    fg: '#faf6ef',
    muted: '#dbd5ca',
    faint: '#beb5a7',
    accent: '#a8d8ff',
    'primary-hi': '#b1cdea',
    primary: '#a6c2de',
    'primary-lo': '#98b4cf',
    'on-primary': '#0a1016',
    'primary-edge': '#b1cdea',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#50240d',
    'on-header': '#fbf2ed',
    'on-header-muted': '#eecec0',
    'header-ring': '#fbf2ed',
    'header-field': '#eecec0',
    second: '#fff0ea',
    heading: '#f6f6bf',
    'header-2': '#301406',
    strip: '#5d343f',
    'strip-2': '#543751',
    layer: '#573a28',
    'layer-edge': '#f6c2c3',
    band: ['#5a3418', '#a8702a', '#e8c890'],
  },
  zones: {
    left: zone('#4a2c35', '#4f313a', '#55363f', '#5b3c45', '#6d4c55', '#83616a', '#ac8991'),
    middle: zone('#34361e', '#393b23', '#3e4028', '#44472e', '#54573e', '#696c52', '#919479'),
    right: zone('#482d31', '#4e3236', '#53373b', '#5a3d41', '#6b4d50', '#816365', '#aa8a8d'),
    bar: zone('#1d3936', '#223f3b', '#274340', '#2e4a47', '#3d5a57', '#53706d', '#799893'),
  },
};

/**
 * Pittal (Mandir materials): brass (pittal) lamps and bells, with verdigris. Dark, at the twilight level.
 * Moving: a glint of polished brass passes along the band.
 */
export const PITTAL: Appearance = {
  id: 'pittal',
  name: 'Pittal',
  base: 'dark',
  colours: {
    ink: '#313814',
    panel: '#373d19',
    'panel-2': '#3b421e',
    'panel-3': '#424824',
    line: '#515837',
    'line-strong': '#676e50',
    field: '#8f947f',
    fg: '#f5f7ef',
    muted: '#d4d7cb',
    faint: '#b4b8a8',
    accent: '#a8e0d0',
    'primary-hi': '#679b8e',
    primary: '#5d9084',
    'primary-lo': '#54867b',
    'on-primary': '#07120f',
    'primary-edge': '#679b8e',
    ...COMFORT_DARK_STATES,
    warning: '#ffc561',
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#7d6600',
    'on-header': '#ffffff',
    'on-header-muted': '#f7efd1',
    'header-ring': '#ffffff',
    'header-field': '#f7efd1',
    second: '#fffbf8',
    heading: '#dff3ae',
    'header-2': '#5f4900',
    strip: '#5d3629',
    'strip-2': '#314625',
    layer: '#304125',
    'layer-edge': '#99e1c4',
    band: ['#b8901a', '#e8c860', '#3fb8a0'],
  },
  zones: {
    left: zone('#4a2d25', '#4f332a', '#55372e', '#5b3e34', '#6c4d44', '#846359', '#ad8a7f'),
    middle: zone('#30371d', '#353d22', '#3a4126', '#40482c', '#50583b', '#666e51', '#8c9677'),
    right: zone('#213747', '#263c4c', '#2b4152', '#304758', '#405768', '#556d7f', '#7c95a8'),
    bar: zone('#3f331d', '#453822', '#493d26', '#50432c', '#60533c', '#766951', '#9f9077'),
  },
};

/**
 * Tamra (Mandir materials): copper (tamra) vessels, warm and bright, with verdigris. Dark, at the twilight
 * level.
 */
export const TAMRA: Appearance = {
  id: 'tamra',
  name: 'Tamra',
  base: 'dark',
  colours: {
    ink: '#502c0d',
    panel: '#553213',
    'panel-2': '#5b3618',
    'panel-3': '#613d1f',
    line: '#704e33',
    'line-strong': '#84644c',
    field: '#a18e81',
    fg: '#fbf5f0',
    muted: '#ded4cc',
    faint: '#c2b3a9',
    accent: '#a8d8ff',
    'primary-hi': '#e5cdc7',
    primary: '#d9c2bc',
    'primary-lo': '#cab4ae',
    'on-primary': '#130e0d',
    'primary-edge': '#e5cdc7',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#07594d',
    'on-header': '#ebf6f3',
    'on-header-muted': '#b8dcd3',
    'header-ring': '#ebf6f3',
    'header-field': '#b8dcd3',
    second: '#7cd6d2',
    heading: '#ffe1c0',
    'header-2': '#6c2304',
    strip: '#57364e',
    'strip-2': '#553b1a',
    layer: '#463b1c',
    'layer-edge': '#b4f6e7',
    band: ['#b8582a', '#e8905a', '#5aa898'],
  },
  zones: {
    left: zone('#3b3514', '#413a1a', '#453f1e', '#4c4525', '#5c5535', '#716b49', '#9a926f'),
    middle: zone('#3c3046', '#42354b', '#463a50', '#4d4057', '#5d5067', '#73657d', '#9a8da6'),
    right: zone('#273646', '#2c3b4c', '#304051', '#364657', '#465768', '#5b6c7e', '#8194a6'),
    bar: zone('#482d31', '#4e3336', '#53373b', '#5a3d41', '#6b4d51', '#816266', '#aa8a8d'),
  },
};

/**
 * Gold Leaf (Mandir materials): gold leaf (varakh) on cream, with maroon. Light, at the stone level. Moving: a
 * glint of gold passes along the band.
 */
export const GOLD_LEAF: Appearance = {
  id: 'gold-leaf',
  name: 'Gold Leaf',
  base: 'light',
  colours: {
    ink: '#dcddaf',
    panel: '#e4e4c5',
    'panel-2': '#eaebcc',
    'panel-3': '#d6d7b8',
    line: '#c5c6ab',
    'line-strong': '#abac94',
    field: '#767766',
    fg: '#22231c',
    muted: '#434438',
    faint: '#575847',
    accent: '#1c4dd7',
    'primary-hi': '#673f44',
    primary: '#5d363b',
    'primary-lo': '#502a30',
    'on-primary': '#ffffff',
    'primary-edge': '#673f44',
    ...LIGHT_STATES,
    warning: '#813100',
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#bfa622',
    'on-header': '#060500',
    'on-header-muted': '#2f2c1a',
    'header-ring': '#060500',
    'header-field': '#2f2c1a',
    second: '#182800',
    heading: '#1f2000',
    'header-2': '#b09600',
    strip: '#f5d4cc',
    'strip-2': '#f0d6c7',
    layer: '#e1cbdf',
    'layer-edge': '#989c76',
    band: ['#d8b048', '#f8ecc0', '#a8801a'],
  },
  zones: {
    left: zone('#e2dbbd', '#eae3c5', '#f1e9cc', '#ddd5b8', '#cbc5a8', '#b1ab8e', '#7c765b'),
    middle: zone('#e5d9c5', '#ede1cd', '#f4e8d4', '#e0d4c0', '#cfc3af', '#b5a996', '#807463'),
    right: zone('#cbdfd0', '#d3e8d8', '#daeedf', '#c6dacb', '#b5cabb', '#9cb0a1', '#687a6d'),
    bar: zone('#ebd5d5', '#f4dddd', '#fae4e4', '#e6d0d0', '#d5bfc0', '#bba6a6', '#857171'),
  },
};

/**
 * Kesar (Mandir materials): saffron (kesar): its crimson threads, golden milk and the crocus's violet. Light,
 * at the paper level.
 */
export const KESAR: Appearance = {
  id: 'kesar',
  name: 'Kesar',
  base: 'light',
  colours: {
    ink: '#f6deb6',
    panel: '#f6e6cb',
    'panel-2': '#fcecd1',
    'panel-3': '#e8d8bf',
    line: '#d5c7b0',
    'line-strong': '#b9ac98',
    field: '#80786a',
    fg: '#292620',
    muted: '#4b453a',
    faint: '#615849',
    accent: '#1d4ed8',
    'primary-hi': '#163190',
    primary: '#0e2685',
    'primary-lo': '#061677',
    'on-primary': '#ffffff',
    'primary-edge': '#163190',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#91000e',
    'on-header': '#ffffff',
    'on-header-muted': '#fbd9d4',
    'header-ring': '#ffffff',
    'header-field': '#fbd9d4',
    second: '#543000',
    heading: '#3e3088',
    'header-2': '#b32c00',
    strip: '#f9d8dc',
    'strip-2': '#cee3f3',
    layer: '#cad2e6',
    'layer-edge': '#81448a',
    band: ['#c8400a', '#f0a020', '#8a5ab8', '#f8e8c8'],
  },
  zones: {
    left: zone('#dee4ca', '#e4ebd1', '#eaf1d7', '#d7ddc3', '#c6ccb2', '#abb198', '#767b64'),
    middle: zone('#d9e2f3', '#e0e9fa', '#e6efff', '#d2dbeb', '#c1c9da', '#a6aebe', '#727989'),
    right: zone('#f1dbe9', '#f8e2f0', '#fee8f6', '#ead4e2', '#d8c3d1', '#bda8b6', '#867380'),
    bar: zone('#ede0cc', '#f4e6d3', '#faecd9', '#e6d9c5', '#d4c7b4', '#b9ac99', '#837766'),
  },
};

/**
 * Janmashtami (Festivals): Krishna's midnight: Yamuna blue, peacock feather and pitambar yellow. Dark, at the
 * night level. Moving: a peacock feather’s shimmer passes along the band.
 */
export const JANMASHTAMI: Appearance = {
  id: 'janmashtami',
  name: 'Janmashtami',
  base: 'dark',
  colours: {
    ink: '#022f49',
    panel: '#09354f',
    'panel-2': '#103a55',
    'panel-3': '#18415c',
    line: '#2f526b',
    'line-strong': '#496980',
    field: '#7d909e',
    fg: '#eaf1f6',
    muted: '#c3cdd5',
    faint: '#a2b0ba',
    accent: '#a8d8ff',
    'primary-hi': '#c1ffe9',
    primary: '#acf6dc',
    'primary-lo': '#9de7cd',
    'on-primary': '#04130e',
    'primary-edge': '#c1ffe9',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#005463',
    'on-header': '#ebf6f8',
    'on-header-muted': '#b7dbe4',
    'header-ring': '#ebf6f8',
    'header-field': '#b7dbe4',
    second: '#3ad5c5',
    heading: '#ffdd8f',
    'header-2': '#062465',
    strip: '#353a12',
    'strip-2': '#0a3c4f',
    layer: '#284459',
    'layer-edge': '#ffc59e',
    band: ['#102a6a', '#0a8a8a', '#3a9a3a', '#f0c020'],
  },
  zones: {
    left: zone('#05303d', '#0d3644', '#133b49', '#1b4250', '#2c5361', '#436a79', '#6b94a3'),
    middle: zone('#173121', '#1d3727', '#223c2b', '#294332', '#395442', '#4f6b58', '#779580'),
    right: zone('#3d2719', '#432d1e', '#483224', '#4f382a', '#61493a', '#796050', '#a28978'),
    bar: zone('#3d2435', '#432a3b', '#482f40', '#4f3646', '#614658', '#795d70', '#a38598'),
  },
};

/**
 * Sharad Purnima (Festivals): the full moon of Sharad Purnima: silver and moonlit blue. Dark, at the twilight
 * level. Moving: the full moon glows softly at the header’s end.
 */
export const SHARAD_PURNIMA: Appearance = {
  id: 'sharad-purnima',
  name: 'Sharad Purnima',
  base: 'dark',
  colours: {
    ink: '#343150',
    panel: '#393756',
    'panel-2': '#3e3b5b',
    'panel-3': '#444261',
    line: '#54526f',
    'line-strong': '#696883',
    field: '#9090a4',
    fg: '#f6f6fd',
    muted: '#d5d4e0',
    faint: '#b5b5c4',
    accent: '#c8d8ff',
    'primary-hi': '#ffffff',
    primary: '#fdffe2',
    'primary-lo': '#eef0d3',
    'on-primary': '#10100a',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#c9dfff',
    'on-header': '#212831',
    'on-header-muted': '#3c4656',
    'header-ring': '#212831',
    'header-field': '#3c4656',
    second: '#f6f3ff',
    heading: '#c7baec',
    'header-2': '#b0c1e2',
    strip: '#24454a',
    'strip-2': '#28463b',
    layer: '#403e58',
    'layer-edge': '#d9cec1',
    band: ['#3a4a6a', '#c8d0e8', '#ffffff', '#c8d0e8'],
  },
  zones: {
    left: zone('#412e40', '#473447', '#4c384b', '#533f51', '#634e62', '#796478', '#a18ba0'),
    middle: zone('#203932', '#263f38', '#29433c', '#304a42', '#405a52', '#557068', '#7b988e'),
    right: zone('#3a3143', '#40364a', '#443b4e', '#4b4155', '#5b5165', '#71667c', '#988ea4'),
    bar: zone('#2c3544', '#313a4a', '#363f4f', '#3c4555', '#4b5566', '#616b7d', '#8793a5'),
  },
};

/**
 * Dev Diwali (Festivals): rows of diyas along the river at dusk. Dark, at the night level. Moving: rows of
 * diyas glow along the band.
 */
export const DEV_DIWALI: Appearance = {
  id: 'dev-diwali',
  name: 'Dev Diwali',
  base: 'dark',
  colours: {
    ink: '#00313d',
    panel: '#053744',
    'panel-2': '#0c3c49',
    'panel-3': '#154350',
    line: '#2d5460',
    'line-strong': '#496a76',
    field: '#799199',
    fg: '#e9f2f5',
    muted: '#c0ced2',
    faint: '#9fb1b7',
    accent: '#a8d0ff',
    'primary-hi': '#ffe7ca',
    primary: '#fadab3',
    'primary-lo': '#ebcba5',
    'on-primary': '#140e07',
    'primary-edge': '#ffe7ca',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#321e03',
    'on-header': '#f9f3eb',
    'on-header-muted': '#e7d1b9',
    'header-ring': '#f9f3eb',
    'header-field': '#e7d1b9',
    second: '#ffe18c',
    heading: '#f9ffcf',
    'header-2': '#013050',
    strip: '#3a3254',
    'strip-2': '#313b15',
    layer: '#324023',
    'layer-edge': '#96d6ad',
    band: ['#1a3a5a', '#f0a030', '#ffd870', '#f0a030', '#1a3a5a'],
  },
  zones: {
    left: zone('#2e293f', '#342e45', '#39334a', '#403a52', '#514b64', '#67617b', '#8f8aa4'),
    middle: zone('#2e2d15', '#34331a', '#39371f', '#403e25', '#514f36', '#67664c', '#8f8f73'),
    right: zone('#222c3e', '#283244', '#2d3749', '#333e51', '#444f62', '#59667a', '#818ea3'),
    bar: zone('#3d2626', '#432c2b', '#483130', '#503736', '#624847', '#795e5d', '#a38785'),
  },
};

/**
 * Vasant Panchami (Festivals): spring's yellow mustard fields and marigolds. Light, at the paper level.
 */
export const VASANT_PANCHAMI: Appearance = {
  id: 'vasant-panchami',
  name: 'Vasant Panchami',
  base: 'light',
  colours: {
    ink: '#e9e2b4',
    panel: '#ede9ca',
    'panel-2': '#f3efd0',
    'panel-3': '#dfdbbd',
    line: '#cecaaf',
    'line-strong': '#b2ae98',
    field: '#7c7a69',
    fg: '#27261f',
    muted: '#47463a',
    faint: '#5c5a49',
    accent: '#1d4ed8',
    'primary-hi': '#ffb657',
    primary: '#fba728',
    'primary-lo': '#ec9903',
    'on-primary': '#180d02',
    'primary-edge': '#5e3a00',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#3c651b',
    'on-header': '#ffffff',
    'on-header-muted': '#cddec3',
    'header-ring': '#ffffff',
    'header-field': '#cddec3',
    second: '#3a3500',
    heading: '#04370a',
    'header-2': '#3c651b',
    strip: '#c6e8d3',
    'strip-2': '#eddfc6',
    layer: '#c5d7c1',
    'layer-edge': '#004a42',
    band: ['#f8d820', '#ffffff', '#f0a020', '#6a9a2a'],
  },
  zones: {
    left: zone('#e3e3c0', '#ebeac8', '#f1f0ce', '#dddcba', '#ccccaa', '#b0b08f', '#7c7b5c'),
    middle: zone('#f9dbd3', '#ffe2da', '#ffeae4', '#f1d4cc', '#e0c3bb', '#c4a8a1', '#8e736d'),
    right: zone('#dae5cc', '#e1ecd3', '#e7f2d8', '#d3dec5', '#c2cdb5', '#a7b29a', '#737c66'),
    bar: zone('#d0e4ee', '#d8ebf5', '#def1fb', '#cadde7', '#baccd7', '#9eb1ba', '#6a7c85'),
  },
};

/**
 * Annakut (Festivals): the Annakut's abundance: ghee, jaggery, marigold and banana leaf. Light, at the stone
 * level.
 */
export const ANNAKUT: Appearance = {
  id: 'annakut',
  name: 'Annakut',
  base: 'light',
  colours: {
    ink: '#fbd3b4',
    panel: '#f9ddc9',
    'panel-2': '#ffe4cf',
    'panel-3': '#ead0bc',
    line: '#d7c0ae',
    'line-strong': '#bba697',
    field: '#827368',
    fg: '#27211c',
    muted: '#4b4139',
    faint: '#625448',
    accent: '#1c4dd7',
    'primary-hi': '#72956d',
    primary: '#688a63',
    'primary-lo': '#64865f',
    'on-primary': '#0a1209',
    'primary-edge': '#60825b',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#744d0e',
    'on-header': '#ffffff',
    'on-header-muted': '#ffedd6',
    'header-ring': '#ffffff',
    'header-field': '#ffedd6',
    second: '#3e2e00',
    heading: '#5d301e',
    'header-2': '#935d01',
    strip: '#edd7c6',
    'strip-2': '#c7e2d2',
    layer: '#e1cfb9',
    'layer-edge': '#00616f',
    band: ['#e8a020', '#f8e0a0', '#c84a1a', '#5a9a2a', '#f8f0e0'],
  },
  zones: {
    left: zone('#f2d3d8', '#fadbdf', '#ffe2e6', '#ecced2', '#dbbdc1', '#c0a3a7', '#8a6e73'),
    middle: zone('#c6e1d1', '#cee9d9', '#d5efe0', '#c1dbcb', '#b1cbbb', '#96b0a1', '#647b6e'),
    right: zone('#e7d6e7', '#eeddef', '#f5e4f5', '#e0d0e1', '#d0bfd0', '#b5a5b6', '#807181'),
    bar: zone('#e2dbc5', '#eae2cc', '#f1e9d3', '#dcd5bf', '#cbc4ae', '#b1aa95', '#7d7562'),
  },
};

/**
 * Raksha Bandhan (Festivals): the rakhi's red thread and gold. Light, at the stone level.
 */
export const RAKSHA_BANDHAN: Appearance = {
  id: 'raksha-bandhan',
  name: 'Raksha Bandhan',
  base: 'light',
  colours: {
    ink: '#edd2ea',
    panel: '#efdded',
    'panel-2': '#f6e3f3',
    'panel-3': '#e2cfdf',
    line: '#d0bfcd',
    'line-strong': '#b4a6b2',
    field: '#7d737b',
    fg: '#262125',
    muted: '#494048',
    faint: '#60535f',
    accent: '#1c4dd7',
    'primary-hi': '#79111e',
    primary: '#6e0015',
    'primary-lo': '#5a000f',
    'on-primary': '#ffffff',
    'primary-edge': '#79111e',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#88012e',
    'on-header': '#ffffff',
    'on-header-muted': '#f2cfd2',
    'header-ring': '#ffffff',
    'header-field': '#f2cfd2',
    second: '#6b0058',
    heading: '#8b1836',
    'header-2': '#a13400',
    strip: '#dad9ef',
    'strip-2': '#cee0cb',
    layer: '#c8d6bf',
    'layer-edge': '#463920',
    band: ['#c8102e', '#f0c020', '#ffffff', '#f0c020', '#c8102e'],
  },
  zones: {
    left: zone('#dad8ed', '#e2e0f7', '#e9e6fd', '#d5d3e8', '#c4c2d7', '#aaa8bd', '#757487'),
    middle: zone('#cedfca', '#d6e8d2', '#dbeed7', '#c8dac4', '#b7c9b3', '#9eaf9a', '#6b7a67'),
    right: zone('#dcd8ea', '#e4e0f2', '#ebe6f8', '#d7d2e4', '#c6c2d3', '#aca8b9', '#787384'),
    bar: zone('#e6d5e7', '#eeddf0', '#f4e4f6', '#e0d0e1', '#cfbfd0', '#b5a6b7', '#807182'),
  },
};

/**
 * Ganesh Chaturthi (Festivals): vermilion, marigold, durva green and modak white. Light, at the paper level.
 */
export const GANESH_CHATURTHI: Appearance = {
  id: 'ganesh-chaturthi',
  name: 'Ganesh Chaturthi',
  base: 'light',
  colours: {
    ink: '#ffd7de',
    panel: '#fde1e6',
    'panel-2': '#ffe8ec',
    'panel-3': '#f0d3d8',
    line: '#dcc3c7',
    'line-strong': '#bea9ad',
    field: '#857578',
    fg: '#2b2425',
    muted: '#504244',
    faint: '#685558',
    accent: '#1d4ed8',
    'primary-hi': '#79280c',
    primary: '#6e1d00',
    'primary-lo': '#5b1600',
    'on-primary': '#ffffff',
    'primary-edge': '#79280c',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#004f1d',
    'on-header': '#eef6ef',
    'on-header-muted': '#c2dbc5',
    'header-ring': '#eef6ef',
    'header-field': '#c2dbc5',
    second: '#702500',
    heading: '#143805',
    'header-2': '#10601d',
    strip: '#f1d9ed',
    'strip-2': '#efdec7',
    layer: '#dad2b8',
    'layer-edge': '#293e23',
    band: ['#d84a1a', '#f8d020', '#3a8a2a', '#ffffff'],
  },
  zones: {
    left: zone('#f8dbd1', '#ffe2d8', '#ffeae2', '#f1d4cb', '#e0c3ba', '#c4a99f', '#8d736b'),
    middle: zone('#cee7d7', '#d5eede', '#daf4e3', '#c7e1d0', '#b6cfc0', '#9cb4a5', '#677e70'),
    right: zone('#f0dfc9', '#f7e6d0', '#fdebd5', '#e9d8c2', '#d8c7b1', '#bcac97', '#867663'),
    bar: zone('#efdce6', '#f6e3ed', '#fce9f3', '#e8d5df', '#d7c4ce', '#bca9b4', '#85747e'),
  },
};

/**
 * Guru Purnima (Festivals): saffron and white for the guru's day. Light, at the paper level.
 */
export const GURU_PURNIMA: Appearance = {
  id: 'guru-purnima',
  name: 'Guru Purnima',
  base: 'light',
  colours: {
    ink: '#f1ddd2',
    panel: '#f2e5de',
    'panel-2': '#f9ebe4',
    'panel-3': '#e5d8d1',
    line: '#d2c7c0',
    'line-strong': '#b6aca6',
    field: '#7f7874',
    fg: '#2b2521',
    muted: '#4f433d',
    faint: '#66564c',
    accent: '#1d4ed8',
    'primary-hi': '#2a2955',
    primary: '#22204b',
    'primary-lo': '#18153e',
    'on-primary': '#ffffff',
    'primary-edge': '#2a2955',
    ...LIGHT_STATES,
    warning: '#722700',
  },
  decoration: {
    header: '#d76012',
    'on-header': '#000000',
    'on-header-muted': '#21120a',
    'header-ring': '#000000',
    'header-field': '#21120a',
    second: '#440001',
    heading: '#410c0c',
    'header-2': '#f08214',
    strip: '#d7e5cb',
    'strip-2': '#cde5e8',
    layer: '#c7d3e6',
    'layer-edge': '#654173',
    band: ['#f0a030', '#ffffff', '#f0a030'],
  },
  zones: {
    left: zone('#f5dbde', '#fde1e4', '#ffe9eb', '#efd4d8', '#ddc3c5', '#c1a8aa', '#8b7376'),
    middle: zone('#dbe1ef', '#e2e8f6', '#e8eefc', '#d5dbe9', '#c4c9d6', '#a9aebb', '#757986'),
    right: zone('#ecddea', '#f3e3f0', '#f9eaf7', '#e6d6e3', '#d4c5d2', '#b9aab7', '#837582'),
    bar: zone('#dee3d4', '#e5eadb', '#ebf0e1', '#d8ddce', '#c7cbbc', '#abb0a2', '#777b6d'),
  },
};

/** The built-in appearances, in the menu’s order (after Follow the computer). */
export const BUILT_IN: readonly Appearance[] = [
  BLACK,
  WHITE,
  DHAJA,
  TIRANGA,
  SAFFRON,
  PEACOCK,
  MIDNIGHT_BLUE,
  SANDALWOOD,
  LOTUS,
  MARBLE,
  TULSI,
  DIWALI,
  HOLI,
  AARTI,
  MONSOON,
  SANDHYA,
  FOREST,
  NAVRATRI,
  NEEL,
  RATNA,
  PRABHAT,
  MEHNDI,
  HALDI,
  HIMALAYA,
  UTTARAYAN,
  MOGRA,
  DUSK_SLATE,
  DUSK_ROSE,
  DUSK_SAGE,
  DUSK_INDIGO,
  DUSK_AMBER,
  DUSK_TEAL,
  MANEK,
  PANNA,
  NEELAM,
  MOTI,
  PUKHRAJ,
  HEERA,
  GULMOHAR,
  KESUDA,
  CHAMPA,
  SAGAR,
  AKASH,
  CHANDNI,
  BANDHANI,
  PATOLA,
  AJRAKH,
  KALAMKARI,
  MADHUBANI,
  WARLI,
  SANDSTONE,
  TEAK,
  PITTAL,
  TAMRA,
  GOLD_LEAF,
  KESAR,
  JANMASHTAMI,
  SHARAD_PURNIMA,
  DEV_DIWALI,
  VASANT_PANCHAMI,
  ANNAKUT,
  RAKSHA_BANDHAN,
  GANESH_CHATURTHI,
  GURU_PURNIMA,
];

/** Each built-in appearance’s family, as the Appearance window groups them (Session 60, Q60-36). */
export const FAMILIES: Readonly<Record<string, string>> = {
  black: 'Plain',
  white: 'Plain',
  dhaja: 'Flags',
  tiranga: 'Flags',
  saffron: 'Mandir materials',
  peacock: 'Nature',
  'midnight-blue': 'Nature',
  sandalwood: 'Mandir materials',
  lotus: 'Nature',
  marble: 'Mandir materials',
  tulsi: 'Nature',
  diwali: 'Festivals',
  holi: 'Festivals',
  aarti: 'Festivals',
  monsoon: 'Nature',
  sandhya: 'Dusk',
  forest: 'Nature',
  navratri: 'Festivals',
  neel: 'Crafts and textiles',
  ratna: 'Jewels',
  prabhat: 'Nature',
  mehndi: 'Crafts and textiles',
  haldi: 'Crafts and textiles',
  himalaya: 'Nature',
  uttarayan: 'Festivals',
  mogra: 'Nature',
  'dusk-slate': 'Dusk',
  'dusk-rose': 'Dusk',
  'dusk-sage': 'Dusk',
  'dusk-indigo': 'Dusk',
  'dusk-amber': 'Dusk',
  'dusk-teal': 'Dusk',
  manek: 'Jewels',
  panna: 'Jewels',
  neelam: 'Jewels',
  moti: 'Jewels',
  pukhraj: 'Jewels',
  heera: 'Jewels',
  gulmohar: 'Nature',
  kesuda: 'Nature',
  champa: 'Nature',
  sagar: 'Nature',
  akash: 'Nature',
  chandni: 'Nature',
  bandhani: 'Crafts and textiles',
  patola: 'Crafts and textiles',
  ajrakh: 'Crafts and textiles',
  kalamkari: 'Crafts and textiles',
  madhubani: 'Crafts and textiles',
  warli: 'Crafts and textiles',
  sandstone: 'Mandir materials',
  teak: 'Mandir materials',
  pittal: 'Mandir materials',
  tamra: 'Mandir materials',
  'gold-leaf': 'Mandir materials',
  kesar: 'Mandir materials',
  janmashtami: 'Festivals',
  'sharad-purnima': 'Festivals',
  'dev-diwali': 'Festivals',
  'vasant-panchami': 'Festivals',
  annakut: 'Festivals',
  'raksha-bandhan': 'Festivals',
  'ganesh-chaturthi': 'Festivals',
  'guru-purnima': 'Festivals',
};

/** A moving appearance’s touch, in words (Session 60, Q60-36 (3)); every other one is still. */
export const MOVING: Readonly<Record<string, string>> = {
  peacock: 'the band shimmers like a peacock feather',
  diwali: 'a diya’s glow breathes at the header’s end; the band shimmers',
  holi: 'puffs of colour drift across the header',
  aarti: 'the aarti’s flame glows and breathes at the header’s end',
  monsoon: 'fine rain lines fall across the header',
  sandhya: 'the header’s sunset colours drift slowly',
  navratri: 'the band shimmers like the garba’s lights',
  prabhat: 'the header’s dawn colours drift slowly',
  uttarayan: 'a few kites float across the header',
  'dusk-slate': 'the header drifts slowly from slate to indigo and back',
  'dusk-rose': 'the header drifts slowly from rose to plum and back',
  'dusk-indigo': 'the header drifts slowly from indigo to violet and back',
  manek: 'a sparkle crosses the band now and then',
  panna: 'a sparkle crosses the band now and then',
  neelam: 'a sparkle crosses the band now and then',
  moti: 'a soft lustre passes along the band',
  heera: 'a glint sweeps the band and the header',
  gulmohar: 'a few flame-red petals drift down the header',
  kesuda: 'a few orange petals fall past the header',
  champa: 'a few white-and-gold petals drift across the header',
  sagar: 'waves: the band shimmers and the header’s blues roll slowly',
  akash: 'white clouds drift across the header',
  chandni: 'the moon glows softly at the header’s end',
  pittal: 'a glint of polished brass passes along the band',
  'gold-leaf': 'a glint of gold passes along the band',
  janmashtami: 'a peacock feather’s shimmer passes along the band',
  'sharad-purnima': 'the full moon glows softly at the header’s end',
  'dev-diwali': 'rows of diyas glow along the band',
};

/**
 * Each colourful built-in appearance’s zones as OKLCH hue and chroma (zones.ts): the colours written out above are
 * zonesOf(its colours, these), and src/main/contrast.test.ts checks they still are.
 */
export const ZONE_TINTS: Readonly<Record<string, Tints>> = {
  dhaja: { left: [318, 0.05], middle: [27, 0.05], right: [145, 0.04], bar: [54, 0.045] },
  tiranga: { left: [62, 0.03], middle: [140, 0.03], right: [265, 0.02], bar: [98, 0.035] },
  saffron: { left: [115, 0.05], middle: [325, 0.05], right: [40, 0.04], bar: [180, 0.04] },
  peacock: { left: [225, 0.04], middle: [325, 0.05], right: [124, 0.045], bar: [289, 0.05] },
  'midnight-blue': { left: [283, 0.05], middle: [305, 0.06], right: [280, 0.04], bar: [262, 0.05] },
  sandalwood: { left: [16, 0.03], middle: [157, 0.04], right: [200, 0.03], bar: [255, 0.025] },
  lotus: { left: [34, 0.03], middle: [341, 0.03], right: [160, 0.03], bar: [230, 0.025] },
  marble: { left: [190, 0.025], middle: [308, 0.025], right: [94, 0.03], bar: [224, 0.02] },
  tulsi: { left: [210, 0.045], middle: [172, 0.04], right: [192, 0.04], bar: [5, 0.05] },
  diwali: { left: [30, 0.05], middle: [227, 0.05], right: [58, 0.05], bar: [76, 0.045] },
  holi: { left: [260, 0.04], middle: [19, 0.03], right: [86, 0.05], bar: [115, 0.04] },
  aarti: { left: [51, 0.04], middle: [350, 0.03], right: [21, 0.025], bar: [164, 0.035] },
  monsoon: { left: [305, 0.04], middle: [205, 0.04], right: [191, 0.045], bar: [295, 0.05] },
  sandhya: { left: [310, 0.05], middle: [10, 0.05], right: [305, 0.05], bar: [221, 0.045] },
  forest: { left: [210, 0.045], middle: [162, 0.04], right: [16, 0.04], bar: [102, 0.04] },
  navratri: { left: [352, 0.05], middle: [244, 0.05], right: [133, 0.045], bar: [350, 0.045] },
  neel: { left: [215, 0.06], middle: [35, 0.05], right: [150, 0.04], bar: [217, 0.04] },
  ratna: { left: [226, 0.05], middle: [168, 0.05], right: [350, 0.05], bar: [101, 0.045] },
  prabhat: { left: [109, 0.03], middle: [310, 0.025], right: [194, 0.025], bar: [65, 0.04] },
  mehndi: { left: [158, 0.04], middle: [61, 0.03], right: [161, 0.035], bar: [20, 0.04] },
  haldi: { left: [131, 0.04], middle: [101, 0.05], right: [29, 0.025], bar: [99, 0.04] },
  himalaya: { left: [175, 0.025], middle: [312, 0.02], right: [152, 0.035], bar: [138, 0.035] },
  uttarayan: { left: [220, 0.025], middle: [108, 0.05], right: [342, 0.025], bar: [172, 0.04] },
  mogra: { left: [117, 0.035], middle: [38, 0.04], right: [329, 0.025], bar: [186, 0.035] },
  'dusk-slate': { left: [190, 0.036], middle: [324, 0.036], right: [157, 0.036], bar: [30, 0.036] },
  'dusk-rose': { left: [288, 0.036], middle: [255, 0.036], right: [34, 0.036], bar: [283, 0.036] },
  'dusk-sage': { left: [90, 0.036], middle: [50, 0.036], right: [255, 0.036], bar: [295, 0.036] },
  'dusk-indigo': { left: [340, 0.036], middle: [20, 0.036], right: [231, 0.036], bar: [153, 0.036] },
  'dusk-amber': { left: [10, 0.036], middle: [340, 0.036], right: [170, 0.036], bar: [260, 0.038] },
  'dusk-teal': { left: [255, 0.036], middle: [243, 0.036], right: [103, 0.036], bar: [200, 0.036] },
  manek: { left: [33, 0.05], middle: [270, 0.05], right: [342, 0.04], bar: [266, 0.04] },
  panna: { left: [102, 0.055], middle: [188, 0.045], right: [138, 0.045], bar: [20, 0.04] },
  neelam: { left: [258, 0.06], middle: [285, 0.05], right: [215, 0.05], bar: [60, 0.035] },
  moti: { left: [20, 0.02], middle: [310, 0.02], right: [21, 0.02], bar: [199, 0.02] },
  pukhraj: { left: [145, 0.045], middle: [115, 0.045], right: [50, 0.04], bar: [191, 0.035] },
  heera: { left: [172, 0.035], middle: [320, 0.035], right: [120, 0.035], bar: [273, 0.035] },
  gulmohar: { left: [100, 0.035], middle: [130, 0.03], right: [69, 0.035], bar: [334, 0.03] },
  kesuda: { left: [115, 0.035], middle: [330, 0.03], right: [68, 0.035], bar: [260, 0.025] },
  champa: { left: [15, 0.03], middle: [95, 0.035], right: [140, 0.03], bar: [340, 0.025] },
  sagar: { left: [152, 0.05], middle: [146, 0.045], right: [291, 0.05], bar: [134, 0.04] },
  akash: { left: [293, 0.03], middle: [145, 0.03], right: [21, 0.03], bar: [319, 0.025] },
  chandni: { left: [344, 0.025], middle: [247, 0.02], right: [312, 0.02], bar: [188, 0.02] },
  bandhani: { left: [351, 0.035], middle: [57, 0.04], right: [90, 0.035], bar: [13, 0.03] },
  patola: { left: [125, 0.045], middle: [29, 0.05], right: [123, 0.045], bar: [308, 0.04] },
  ajrakh: { left: [222, 0.04], middle: [14, 0.045], right: [233, 0.035], bar: [70, 0.03] },
  kalamkari: { left: [32, 0.035], middle: [100, 0.03], right: [308, 0.025], bar: [110, 0.03] },
  madhubani: { left: [139, 0.035], middle: [312, 0.03], right: [164, 0.035], bar: [285, 0.03] },
  warli: { left: [98, 0.05], middle: [117, 0.04], right: [55, 0.04], bar: [110, 0.035] },
  sandstone: { left: [340, 0.035], middle: [17, 0.03], right: [122, 0.03], bar: [218, 0.02] },
  teak: { left: [2, 0.045], middle: [114, 0.04], right: [12, 0.04], bar: [186, 0.035] },
  pittal: { left: [38, 0.045], middle: [121, 0.045], right: [240, 0.04], bar: [82, 0.04] },
  tamra: { left: [98, 0.05], middle: [310, 0.04], right: [249, 0.035], bar: [10, 0.04] },
  'gold-leaf': { left: [96, 0.04], middle: [79, 0.03], right: [154, 0.03], bar: [16, 0.025] },
  kesar: { left: [118, 0.035], middle: [265, 0.025], right: [338, 0.03], bar: [78, 0.03] },
  janmashtami: { left: [223, 0.05], middle: [155, 0.045], right: [55, 0.04], bar: [340, 0.045] },
  'sharad-purnima': { left: [328, 0.04], middle: [173, 0.035], right: [307, 0.035], bar: [260, 0.03] },
  'dev-diwali': { left: [295, 0.04], middle: [106, 0.04], right: [260, 0.035], bar: [22, 0.035] },
  'vasant-panchami': { left: [107, 0.045], middle: [34, 0.035], right: [126, 0.035], bar: [231, 0.025] },
  annakut: { left: [7, 0.035], middle: [160, 0.035], right: [325, 0.03], bar: [90, 0.03] },
  'raksha-bandhan': { left: [290, 0.03], middle: [140, 0.035], right: [297, 0.025], bar: [323, 0.03] },
  'ganesh-chaturthi': { left: [39, 0.035], middle: [158, 0.035], right: [73, 0.035], bar: [343, 0.025] },
  'guru-purnima': { left: [10, 0.03], middle: [270, 0.02], right: [330, 0.025], bar: [120, 0.02] },
};
/** A built-in appearance by its id. */
export const builtIn = (id: string): Appearance | undefined => BUILT_IN.find((a) => a.id === id);

/** What Follow the computer shows: Black when the computer is set dark, else White. */
export const followed = (dark: boolean): Appearance => (dark ? BLACK : WHITE);
