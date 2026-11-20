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
    ink: '#4d2a38',
    panel: '#52303d',
    'panel-2': '#583442',
    'panel-3': '#5e3b48',
    line: '#6d4c58',
    'line-strong': '#81626d',
    field: '#a38c94',
    fg: '#fcf4f6',
    muted: '#dfd2d6',
    faint: '#c3b1b8',
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
    second: '#ffed8c',
    heading: '#a9ed9c',
    'header-2': '#7a1238',
    strip: '#4d3859',
    'strip-2': '#3b3d61',
    layer: '#304068',
    'layer-edge': '#f4fff8',
    band: ['#d0202b', '#ffffff', '#f2b630', '#ffffff', '#d0202b'],
  },
  zones: {
    left: zone('#412d47', '#47334d', '#4b3851', '#523e59', '#634e69', '#78637f', '#a18ba8'),
    middle: zone('#35314e', '#3b3653', '#3f3b59', '#45415f', '#555170', '#6a6687', '#928fb0'),
    right: zone('#453021', '#4b3526', '#503a2b', '#574031', '#685041', '#7e6555', '#a78d7b'),
    bar: zone('#482c39', '#4e313e', '#533643', '#5a3c49', '#6b4c59', '#81616f', '#ab8997'),
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
    ink: '#522924',
    panel: '#592e2a',
    'panel-2': '#5e332e',
    'panel-3': '#653934',
    line: '#734b46',
    'line-strong': '#87625d',
    field: '#a58c89',
    fg: '#fdf4f3',
    muted: '#e1d2d0',
    faint: '#c4b2af',
    accent: '#ffc58a',
    'primary-hi': '#f9b228',
    primary: '#eda70d',
    'primary-lo': '#dc9a00',
    'on-primary': '#160e02',
    'primary-edge': '#f9b228',
    ...COMFORT_DARK_STATES,
    warning: '#fff176',
    'warning-bg': '#33290a',
    'warning-fg': '#ffe98a',
    danger: '#ff94bb',
    'danger-fg': '#ffc2d8',
    rec: '#ff9891',
  },
  decoration: {
    header: '#e0733a',
    'on-header': '#000000',
    'on-header-muted': '#322219',
    'header-ring': '#000000',
    'header-field': '#322219',
    second: '#fffcfd',
    heading: '#a4d38d',
    'header-2': '#d18d34',
    strip: '#41431a',
    'strip-2': '#2f4626',
    layer: '#5f343c',
    'layer-edge': '#fffced',
    band: ['#d8431c', '#f7923a', '#ffd166', '#f7923a', '#d8431c'],
  },
  zones: {
    left: zone('#333718', '#383c1d', '#3d4122', '#434728', '#535838', '#696d4c', '#909572'),
    middle: zone('#482b3d', '#4e3142', '#533647', '#5a3b4d', '#6b4c5e', '#826174', '#ab889b'),
    right: zone('#482e27', '#4e332c', '#533831', '#593e37', '#6a4f47', '#82645c', '#aa8b82'),
    bar: zone('#1a3a34', '#1f3f39', '#24443e', '#2a4a44', '#3b5b55', '#50716a', '#769991'),
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
    ink: '#003233',
    panel: '#003839',
    'panel-2': '#003e3f',
    'panel-3': '#094546',
    line: '#275657',
    'line-strong': '#446c6d',
    field: '#779292',
    fg: '#e8f2f2',
    muted: '#c0cfcf',
    faint: '#9eb2b2',
    accent: '#86d7ff',
    'primary-hi': '#1fa2b6',
    primary: '#0097ab',
    'primary-lo': '#068a9c',
    'on-primary': '#001317',
    'primary-edge': '#1fa2b6',
    ...COMFORT_DARK_STATES,
    success: '#a5d64c',
    'success-bg': '#1d2b0b',
    'success-fg': '#d6f2a6',
    danger: '#ff8786',
    rec: '#ff8784',
  },
  decoration: {
    header: '#004558',
    'on-header': '#ebf6fa',
    'on-header-muted': '#b8dae7',
    'header-ring': '#ebf6fa',
    'header-field': '#b8dae7',
    second: '#00c8b2',
    heading: '#aed8b1',
    'header-2': '#005046',
    strip: '#083d44',
    'strip-2': '#233856',
    layer: '#29406c',
    'layer-edge': '#fae4b9',
    band: ['#1f4fbf', '#16b3ac', '#3fa34d', '#e0b13a'],
  },
  zones: {
    left: zone('#153127', '#1a362c', '#203c31', '#274338', '#385449', '#4e6b5f', '#759486'),
    middle: zone('#1b2c44', '#20324b', '#253850', '#2c3e58', '#3d506a', '#526682', '#798fab'),
    right: zone('#262f16', '#2b341a', '#313a20', '#374127', '#485237', '#5e694d', '#869173'),
    bar: zone('#37253f', '#3c2b44', '#42304a', '#493751', '#5b4863', '#725e7b', '#9a86a4'),
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
    ink: '#212c46',
    panel: '#26314b',
    'panel-2': '#2b3651',
    'panel-3': '#323d58',
    line: '#444f69',
    'line-strong': '#5b657d',
    field: '#858da0',
    fg: '#edf0f7',
    muted: '#c7ccd6',
    faint: '#a7aebc',
    accent: '#9cc3ff',
    'primary-hi': '#688ea7',
    primary: '#5e839c',
    'primary-lo': '#5c829a',
    'on-primary': '#081116',
    'primary-edge': '#688ea7',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#001143',
    'on-header': '#eff4fc',
    'on-header-muted': '#c7d5f0',
    'header-ring': '#eff4fc',
    'header-field': '#c7d5f0',
    second: '#ffc1d8',
    heading: '#b2b9fb',
    'header-2': '#0b0046',
    strip: '#393254',
    'strip-2': '#0c3c49',
    layer: '#3b3c6b',
    'layer-edge': '#c0d8b0',
    band: ['#2a3f99', '#5aa2ff', '#c9d6ff', '#ffd27a'],
  },
  zones: {
    left: zone('#122f43', '#173448', '#1c394d', '#234055', '#355268', '#4a687e', '#7191a8'),
    middle: zone('#202b4b', '#253051', '#2a3556', '#303c5e', '#414e71', '#576488', '#7e8db3'),
    right: zone('#0f3037', '#15353c', '#1a3b42', '#224249', '#34545b', '#496a72', '#70939a'),
    bar: zone('#362640', '#3b2b45', '#41304b', '#483752', '#5a4864', '#715e7b', '#9a86a5'),
  },
};

/**
 * Sandalwood (Mandir materials): sandal paste and its warm creams, with the mandir's red and gold in the band.
 * Light, at the stone level.
 */
export const SANDALWOOD: Appearance = {
  id: 'sandalwood',
  name: 'Sandalwood',
  base: 'light',
  colours: {
    ink: '#f0d6bd',
    panel: '#f2dfcf',
    'panel-2': '#f8e6d5',
    'panel-3': '#e3d2c1',
    line: '#d1c2b3',
    'line-strong': '#b5a89b',
    field: '#7e746c',
    fg: '#27211c',
    muted: '#4a4138',
    faint: '#625448',
    accent: '#0b5e73',
    'primary-hi': '#10515d',
    primary: '#004753',
    'primary-lo': '#003a44',
    'on-primary': '#ffffff',
    'primary-edge': '#10515d',
    ...LIGHT_STATES,
    warning: '#ae4f00',
    danger: '#a51616',
    'danger-strong': '#a51616',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#fdb664',
    'on-header': '#2e261d',
    'on-header-muted': '#514334',
    'header-ring': '#2e261d',
    'header-field': '#514334',
    second: '#005e55',
    heading: '#186368',
    'header-2': '#feb798',
    strip: '#efd8b8',
    'strip-2': '#fdd1cb',
    layer: '#b4d9d4',
    'layer-edge': '#026870',
    band: ['#c81d25', '#f1dcb4', '#e8a317', '#f1dcb4', '#c81d25'],
  },
  zones: {
    left: zone('#e8d8c6', '#f0e0cd', '#f7e7d4', '#e2d3c1', '#d2c2b0', '#b7a896', '#827363'),
    middle: zone('#daddbf', '#e1e5c7', '#e8eccd', '#d4d8ba', '#c4c7a9', '#aaad90', '#75785d'),
    right: zone('#d7ddc8', '#dfe5cf', '#e5ecd6', '#d1d8c2', '#c1c7b2', '#a6ad98', '#727865'),
    bar: zone('#cae0d8', '#d2e7df', '#d8eee6', '#c4dad2', '#b5c9c2', '#9aafa7', '#667a73'),
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
    ink: '#f4d1e2',
    panel: '#f3dce7',
    'panel-2': '#fbe2ee',
    'panel-3': '#e6ceda',
    line: '#d4bec9',
    'line-strong': '#b7a5ae',
    field: '#7f7379',
    fg: '#272124',
    muted: '#4c3f45',
    faint: '#63525a',
    accent: '#1b4bd5',
    'primary-hi': '#b13668',
    primary: '#a52a5e',
    'primary-lo': '#961952',
    'on-primary': '#ffffff',
    'primary-edge': '#b13668',
    ...LIGHT_STATES,
    warning: '#946200',
    'warning-fg': '#5c3d00',
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#891f55',
    'on-header': '#fbf1f5',
    'on-header-muted': '#edccd7',
    'header-ring': '#fbf1f5',
    'header-field': '#edccd7',
    second: '#004c73',
    heading: '#892886',
    'header-2': '#741d6d',
    strip: '#f9d1df',
    'strip-2': '#e9d4f3',
    layer: '#badabf',
    'layer-edge': '#1f6a96',
    band: ['#e86a9a', '#f8c8d8', '#3c9a5f', '#f2d16b'],
  },
  zones: {
    left: zone('#eed4dd', '#f5dce4', '#fce2eb', '#e7ced7', '#d6bec6', '#bba4ac', '#877078'),
    middle: zone('#e3d6ea', '#ebdef1', '#f2e4f8', '#ddd0e3', '#ccc0d3', '#b2a6b8', '#7e7284'),
    right: zone('#cce0cf', '#d4e7d7', '#daeedd', '#c6dac9', '#b6c9b9', '#9caf9f', '#697a6c'),
    bar: zone('#cbdee9', '#d2e5f0', '#d9ecf7', '#c5d8e3', '#b5c7d2', '#9badb7', '#687883'),
  },
};

/**
 * Marble (Mandir materials): white mandir marble, cool and quiet, with gold and navy. Light, at the stone
 * level.
 */
export const MARBLE: Appearance = {
  id: 'marble',
  name: 'Marble',
  base: 'light',
  colours: {
    ink: '#cddcec',
    panel: '#dae3ee',
    'panel-2': '#e0eaf5',
    'panel-3': '#ccd6e1',
    line: '#bcc5ce',
    'line-strong': '#a3abb3',
    field: '#71777d',
    fg: '#1e2328',
    muted: '#3c434d',
    faint: '#4c5865',
    accent: '#085d9d',
    'primary-hi': '#1a3c7b',
    primary: '#113270',
    'primary-lo': '#052562',
    'on-primary': '#ffffff',
    'primary-edge': '#1a3c7b',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#28354e',
    'on-header': '#eff4fc',
    'on-header-muted': '#c7d5f0',
    'header-ring': '#eff4fc',
    'header-field': '#c7d5f0',
    second: '#7d2974',
    heading: '#315d82',
    'header-2': '#2e4069',
    strip: '#cddcf5',
    'strip-2': '#f2d3e1',
    layer: '#d6d4ae',
    'layer-edge': '#5474a1',
    band: ['#c9a227', '#ffffff', '#1b3566', '#ffffff', '#c9a227'],
  },
  zones: {
    left: zone('#dfd8e9', '#e7dff0', '#ede6f7', '#d9d2e3', '#c9c1d2', '#afa7b8', '#7b7383'),
    middle: zone('#d8d9ec', '#dfe1f4', '#e6e8fa', '#d2d4e6', '#c1c3d4', '#a7a9bb', '#747586'),
    right: zone('#dcdcc5', '#e4e4cd', '#ebebd4', '#d7d7c0', '#c6c6b0', '#acac96', '#787763'),
    bar: zone('#cddde5', '#d5e5ed', '#dcecf4', '#c8d8e0', '#b7c7cf', '#9eadb4', '#6b7880'),
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
    ink: '#12321e',
    panel: '#173823',
    'panel-2': '#1c3d27',
    'panel-3': '#24442e',
    line: '#385540',
    'line-strong': '#516c59',
    field: '#7f9284',
    fg: '#ebf2ec',
    muted: '#c4cfc6',
    faint: '#a3b1a7',
    accent: '#a9d8ff',
    'primary-hi': '#ffffff',
    primary: '#fffcf2',
    'primary-lo': '#f0ede3',
    'on-primary': '#100f0d',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    warning: '#f8b844',
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#36661e',
    'on-header': '#ffffff',
    'on-header-muted': '#cfe2c8',
    'header-ring': '#ffffff',
    'header-field': '#cfe2c8',
    second: '#c395ff',
    heading: '#b1a4e6',
    'header-2': '#186951',
    strip: '#353a11',
    'strip-2': '#46340d',
    layer: '#57345d',
    'layer-edge': '#85a9d8',
    band: ['#2e7d4f', '#7a4fb0', '#f6efd6', '#7a4fb0', '#2e7d4f'],
  },
  zones: {
    left: zone('#063131', '#0e3737', '#143c3c', '#1b4342', '#2d5554', '#456c6b', '#6c9593'),
    middle: zone('#372914', '#3d2f1a', '#42341e', '#493b25', '#5b4c36', '#72634c', '#9b8c73'),
    right: zone('#0d3034', '#14363a', '#193b3f', '#214246', '#325457', '#496b6f', '#709497'),
    bar: zone('#35263f', '#3c2b46', '#40304b', '#473752', '#594864', '#715f7d', '#9987a5'),
  },
};

/**
 * Diwali (Festivals): diyas and rangoli: plum night, marigold, gold and pink. Dark, at the twilight level.
 * Moving: a diya’s glow breathes at the header’s end; the band shimmers.
 */
export const DIWALI: Appearance = {
  id: 'diwali',
  name: 'Diwali',
  base: 'dark',
  colours: {
    ink: '#512839',
    panel: '#572d3e',
    'panel-2': '#5c3243',
    'panel-3': '#633849',
    line: '#724958',
    'line-strong': '#86606e',
    field: '#a38c94',
    fg: '#fcf4f6',
    muted: '#dfd2d6',
    faint: '#c3b1b8',
    accent: '#d9c4ff',
    'primary-hi': '#ffd2aa',
    primary: '#f4c69e',
    'primary-lo': '#e5b890',
    'on-primary': '#160d06',
    'primary-edge': '#ffd2aa',
    ...COMFORT_DARK_STATES,
    warning: '#fff176',
    'warning-bg': '#33300a',
    'warning-fg': '#fff3a6',
    danger: '#ff94bb',
    'danger-fg': '#ffc2d8',
    rec: '#ff9891',
  },
  decoration: {
    header: '#63257f',
    'on-header': '#f7f2fa',
    'on-header-muted': '#dfcfe9',
    'header-ring': '#f7f2fa',
    'header-field': '#dfcfe9',
    second: '#e2a7f2',
    heading: '#8dbcfc',
    'header-2': '#322b82',
    strip: '#2e4160',
    'strip-2': '#5b3822',
    layer: '#5e353b',
    'layer-edge': '#e6d8a3',
    band: ['#ff8f1f', '#ffc23d', '#e83e8c', '#ffc23d', '#ff8f1f'],
  },
  zones: {
    left: zone('#432d45', '#48324b', '#4d3750', '#543d56', '#644d67', '#7a637d', '#a38aa6'),
    middle: zone('#23364e', '#293b54', '#2d4059', '#334660', '#435671', '#586c87', '#7e94b1'),
    right: zone('#4d2b2f', '#533034', '#583539', '#5f3b3f', '#704b4f', '#876064', '#b0888b'),
    bar: zone('#3c3418', '#42391d', '#473e22', '#4d4428', '#5d5438', '#736a4d', '#9b9273'),
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
    ink: '#bde9ed',
    panel: '#d0edf0',
    'panel-2': '#d6f3f6',
    'panel-3': '#c3e0e3',
    line: '#b5cdd0',
    'line-strong': '#9cb2b4',
    field: '#6c7c7d',
    fg: '#1f2828',
    muted: '#3a484a',
    faint: '#475d60',
    accent: '#1b46a3',
    'primary-hi': '#945476',
    primary: '#894a6c',
    'primary-lo': '#7b3d5f',
    'on-primary': '#ffffff',
    'primary-edge': '#945476',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#006071',
    'on-header': '#f9feff',
    'on-header-muted': '#b7dbe4',
    'header-ring': '#f9feff',
    'header-field': '#b7dbe4',
    second: '#651688',
    heading: '#a1136f',
    'header-2': '#005088',
    strip: '#e7e1bb',
    'strip-2': '#cae8ca',
    layer: '#e9c9d7',
    'layer-edge': '#a0366c',
    band: ['#e0218a', '#ffd23f', '#2fb344', '#12b5c6', '#ff7a1a'],
  },
  zones: {
    left: zone('#c2e8ec', '#c8eff3', '#cef5f9', '#bce2e6', '#aad0d4', '#90b5b9', '#5b7f83'),
    middle: zone('#f2dbe8', '#f8e2ef', '#fee8f5', '#ebd5e1', '#d8c3cf', '#bea8b5', '#87737f'),
    right: zone('#f2dfbc', '#f9e6c3', '#ffecc9', '#ecd9b6', '#d9c7a5', '#beac8a', '#887657'),
    bar: zone('#d3e7cd', '#daeed4', '#e0f4da', '#cde1c7', '#bbceb5', '#a1b49b', '#6c7d67'),
  },
};

/**
 * Aarti (Festivals): the aarti's lamp: gold, saffron and crimson. Light, at the stone level. Moving: the
 * aarti’s flame glows and breathes at the header’s end.
 */
export const AARTI: Appearance = {
  id: 'aarti',
  name: 'Aarti',
  base: 'light',
  colours: {
    ink: '#e2dbb2',
    panel: '#e7e3c7',
    'panel-2': '#eeeace',
    'panel-3': '#dad5ba',
    line: '#c8c5ac',
    'line-strong': '#aeab96',
    field: '#797668',
    fg: '#24221c',
    muted: '#444337',
    faint: '#5a5746',
    accent: '#2f4f8f',
    'primary-hi': '#851f41',
    primary: '#7a1238',
    'primary-lo': '#6b002d',
    'on-primary': '#ffffff',
    'primary-edge': '#851f41',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#7e5000',
    'on-header': '#ffffff',
    'on-header-muted': '#e9d5bc',
    'header-ring': '#ffffff',
    'header-field': '#e9d5bc',
    second: '#2d1353',
    heading: '#7b0011',
    'header-2': '#7f3700',
    strip: '#fdd1d1',
    'strip-2': '#f5d1e8',
    layer: '#e3d0a5',
    'layer-edge': '#6772b2',
    band: ['#b3122e', '#e0a526', '#f26b1d', '#e0a526', '#b3122e'],
  },
  zones: {
    left: zone('#d4dec2', '#dce6ca', '#e3edd1', '#ced9bc', '#bec8ac', '#a4af93', '#707960'),
    middle: zone('#dadcc5', '#e2e4cd', '#e9ebd4', '#d5d6c0', '#c4c6b0', '#abac96', '#767763'),
    right: zone('#ead7cd', '#f2dfd5', '#f9e6dc', '#e4d1c7', '#d3c1b7', '#b9a79d', '#84726a'),
    bar: zone('#d9ddc3', '#e1e5ca', '#e8ecd1', '#d3d7bd', '#c3c7ad', '#a9ad94', '#747860'),
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
    ink: '#21383f',
    panel: '#273e45',
    'panel-2': '#2b424a',
    'panel-3': '#314950',
    line: '#435860',
    'line-strong': '#5a6e74',
    field: '#86949a',
    fg: '#eff8fb',
    muted: '#cad8dc',
    faint: '#a6b9bf',
    accent: '#8fd3ff',
    'primary-hi': '#d5b7e0',
    primary: '#caacd5',
    'primary-lo': '#bc9ec6',
    'on-primary': '#130d15',
    'primary-edge': '#d5b7e0',
    ...COMFORT_DARK_STATES,
    danger: '#ff9997',
    rec: '#ff9891',
  },
  decoration: {
    header: '#182a7c',
    'on-header': '#f0f4fc',
    'on-header-muted': '#c9d5f0',
    'header-ring': '#f0f4fc',
    'header-field': '#c9d5f0',
    second: '#00cbe2',
    heading: '#fefaa0',
    'header-2': '#004d5b',
    strip: '#4e3857',
    'strip-2': '#374528',
    layer: '#284738',
    'layer-edge': '#d2cc6b',
    band: ['#4a6fa5', '#2fb3a6', '#5fbf5f', '#ffe66d'],
  },
  zones: {
    left: zone('#203746', '#253d4d', '#294151', '#304858', '#3f5867', '#546e7f', '#7b96a7'),
    middle: zone('#1b3a33', '#214038', '#25443c', '#2c4b43', '#3b5a52', '#517168', '#77998f'),
    right: zone('#3c3418', '#423a1e', '#463e22', '#4d4529', '#5c5437', '#726a4d', '#9a9272'),
    bar: zone('#0f3946', '#163f4c', '#1b4350', '#224a57', '#325a68', '#48707e', '#6f98a6'),
  },
};

/**
 * Sandhya (Dusk): the evening sky from indigo through rose to gold. Dark, at the twilight level. Moving: the
 * header’s sunset colours drift slowly.
 */
export const SANDHYA: Appearance = {
  id: 'sandhya',
  name: 'Sandhya',
  base: 'dark',
  colours: {
    ink: '#333152',
    panel: '#393658',
    'panel-2': '#3d3b5d',
    'panel-3': '#444164',
    line: '#535272',
    'line-strong': '#696886',
    field: '#9090a4',
    fg: '#f6f6fd',
    muted: '#d5d4e0',
    faint: '#b5b5c4',
    accent: '#ffc2d6',
    'primary-hi': '#d8c5fe',
    primary: '#cdbaf2',
    'primary-lo': '#bface3',
    'on-primary': '#110d18',
    'primary-edge': '#d8c5fe',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#840065',
    'on-header': '#fff5fb',
    'on-header-muted': '#eacdde',
    'header-ring': '#fff5fb',
    'header-field': '#eacdde',
    second: '#57e9b9',
    heading: '#ffdeb0',
    'header-2': '#9f2a0a',
    strip: '#22435d',
    'strip-2': '#383e61',
    layer: '#333f66',
    'layer-edge': '#d3c97b',
    band: ['#3b2a8f', '#7a3fb8', '#e05a8a', '#ff8a5c', '#ffc04d'],
  },
  zones: {
    left: zone('#33314e', '#383753', '#3c3b59', '#43425f', '#535271', '#686888', '#8f8fb0'),
    middle: zone('#3c2f4a', '#423450', '#473954', '#4d3f5c', '#5e4f6d', '#736583', '#9b8cac'),
    right: zone('#432d45', '#48324b', '#4d3750', '#543d56', '#654d67', '#7b637d', '#a38aa6'),
    bar: zone('#32324c', '#373751', '#3c3c57', '#42425d', '#52526e', '#676885', '#8e90ae'),
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
    ink: '#292f17',
    panel: '#2e341c',
    'panel-2': '#333920',
    'panel-3': '#3a4027',
    line: '#4c513b',
    'line-strong': '#626853',
    field: '#8a8f7e',
    fg: '#eff1e9',
    muted: '#cacdc1',
    faint: '#abb0a0',
    accent: '#9fe0c0',
    'primary-hi': '#d3f2ab',
    primary: '#c8e6a0',
    'primary-lo': '#bad792',
    'on-primary': '#0c1204',
    'primary-edge': '#d3f2ab',
    ...COMFORT_DARK_STATES,
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#5a381a',
    'on-header': '#fbf2ec',
    'on-header-muted': '#ead0bb',
    'header-ring': '#fbf2ec',
    'header-field': '#ead0bb',
    second: '#70b2e8',
    heading: '#c9d792',
    'header-2': '#1b4d31',
    strip: '#133f2b',
    'strip-2': '#3c380f',
    layer: '#5a3835',
    'layer-edge': '#6fbcce',
    band: ['#2e6b4f', '#8db348', '#8a5a32', '#d9874a'],
  },
  zones: {
    left: zone('#08322f', '#0f3734', '#143c39', '#1c4340', '#2e5552', '#456c69', '#6c9590'),
    middle: zone('#192e3e', '#1d3343', '#223849', '#293f50', '#3b5163', '#51687a', '#7890a3'),
    right: zone('#3a2916', '#3f2e1b', '#44331f', '#4b3a26', '#5d4b37', '#75624d', '#9d8a73'),
    bar: zone('#302d15', '#35321a', '#3a371f', '#413e25', '#524f36', '#69664c', '#918e73'),
  },
};

/**
 * Navratri (Festivals): the garba's nine nights: bright chaniya-choli colours on deep plum. Dark, at the night
 * level. Moving: the band shimmers like the garba’s lights.
 */
export const NAVRATRI: Appearance = {
  id: 'navratri',
  name: 'Navratri',
  base: 'dark',
  colours: {
    ink: '#452128',
    panel: '#4b272e',
    'panel-2': '#512b33',
    'panel-3': '#59323a',
    line: '#69454b',
    'line-strong': '#7e5d62',
    field: '#9f878a',
    fg: '#f7eeef',
    muted: '#d7c8ca',
    faint: '#bca9ac',
    accent: '#ffd36b',
    'primary-hi': '#24bbe0',
    primary: '#00b0d4',
    'primary-lo': '#00a1c2',
    'on-primary': '#001218',
    'primary-edge': '#24bbe0',
    ...COMFORT_DARK_STATES,
    success: '#a5d64c',
    'success-bg': '#1d2b0b',
    'success-fg': '#d6f2a6',
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#923887',
    'on-header': '#ffffff',
    'on-header-muted': '#eed3e8',
    'header-ring': '#ffffff',
    'header-field': '#eed3e8',
    second: '#efd3f8',
    heading: '#fff0a8',
    'header-2': '#394ca0',
    strip: '#3d3153',
    'strip-2': '#3a3254',
    layer: '#3a3c6c',
    'layer-edge': '#efdd7b',
    band: ['#e0218a', '#ff8a1f', '#ffd23f', '#2fb344', '#2a5bd7'],
  },
  zones: {
    left: zone('#43231e', '#492924', '#4e2d28', '#56342f', '#694640', '#815c56', '#ab847d'),
    middle: zone('#282945', '#2d2f4c', '#323450', '#393b58', '#4a4c6b', '#606383', '#878bac'),
    right: zone('#08312d', '#0f3733', '#153c38', '#1d433f', '#2f5550', '#466c67', '#6c958f'),
    bar: zone('#3f2518', '#462b1e', '#4a3022', '#52372a', '#65483a', '#7d5f51', '#a68777'),
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
    ink: '#363053',
    panel: '#3b3659',
    'panel-2': '#403a5e',
    'panel-3': '#454165',
    line: '#555172',
    'line-strong': '#6b6786',
    field: '#9190a4',
    fg: '#f6f6fd',
    muted: '#d5d4df',
    faint: '#b6b4c4',
    accent: '#a9c8ff',
    'primary-hi': '#fff8ea',
    primary: '#ffebc2',
    'primary-lo': '#f0dcb4',
    'on-primary': '#130f07',
    'primary-edge': '#fff8ea',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#450e0c',
    'on-header': '#fcf2f0',
    'on-header-muted': '#efcdc8',
    'header-ring': '#fcf2f0',
    'header-field': '#efcdc8',
    second: '#93bbb6',
    heading: '#71dde3',
    'header-2': '#0f196a',
    strip: '#21435d',
    'strip-2': '#18464e',
    layer: '#4f3569',
    'layer-edge': '#d1c3a0',
    band: ['#2e3a9a', '#f3ead2', '#b8432f', '#d9a62e', '#2e3a9a'],
  },
  zones: {
    left: zone('#193651', '#1f3c58', '#23415c', '#294764', '#395774', '#4e6d8c', '#7596b5'),
    middle: zone('#4b2d21', '#523226', '#56372b', '#5e3d31', '#6e4d40', '#856255', '#af8a7b'),
    right: zone('#472f24', '#4d3529', '#52392e', '#584033', '#694f43', '#7f6558', '#a98c7e'),
    bar: zone('#243649', '#2a3c4f', '#2e4053', '#34475a', '#43566a', '#596c81', '#8094aa'),
  },
};

/**
 * Ratna (Jewels): gems on velvet: emerald, sapphire, ruby, gold and pearl. Dark, at the night level.
 */
export const RATNA: Appearance = {
  id: 'ratna',
  name: 'Ratna',
  base: 'dark',
  colours: {
    ink: '#35273a',
    panel: '#3a2d40',
    'panel-2': '#403145',
    'panel-3': '#47384d',
    line: '#574a5d',
    'line-strong': '#6d6172',
    field: '#938a97',
    fg: '#f3eff5',
    muted: '#d1c9d4',
    faint: '#b4abb8',
    accent: '#a8e6d0',
    'primary-hi': '#c5e7ba',
    primary: '#badbaf',
    'primary-lo': '#accca1',
    'on-primary': '#0b1209',
    'primary-edge': '#c5e7ba',
    ...COMFORT_DARK_STATES,
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#0f4a35',
    'on-header': '#ecf6f1',
    'on-header-muted': '#bcdccc',
    'header-ring': '#ecf6f1',
    'header-field': '#bcdccc',
    second: '#d6baf0',
    heading: '#92e3c5',
    'header-2': '#13306e',
    strip: '#532b35',
    'strip-2': '#403051',
    layer: '#1e432c',
    'layer-edge': '#d5e093',
    band: ['#1f8a5a', '#2a4fb8', '#b8143a', '#e8b84a', '#f4efe6'],
  },
  zones: {
    left: zone('#202b45', '#26314c', '#2a3650', '#313d58', '#414e6b', '#576583', '#7f8ead'),
    middle: zone('#13311f', '#193725', '#1e3c29', '#254330', '#375541', '#4d6c57', '#73957e'),
    right: zone('#43222a', '#482830', '#4e2c34', '#55343b', '#68444c', '#805b63', '#aa838b'),
    bar: zone('#3c2713', '#422d19', '#47321e', '#4e3924', '#614a35', '#78604a', '#a18971'),
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
    ink: '#f7dbd6',
    panel: '#f7e3e0',
    'panel-2': '#fdeae6',
    'panel-3': '#e9d6d2',
    line: '#d6c5c2',
    'line-strong': '#b9aba8',
    field: '#817775',
    fg: '#2c2422',
    muted: '#504340',
    faint: '#685551',
    accent: '#1d4ed8',
    'primary-hi': '#253f59',
    primary: '#1c364f',
    'primary-lo': '#112a43',
    'on-primary': '#ffffff',
    'primary-edge': '#253f59',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#973c10',
    'on-header': '#ffffff',
    'on-header-muted': '#f5d4c7',
    'header-ring': '#ffffff',
    'header-field': '#f5d4c7',
    second: '#913465',
    heading: '#8b4a4f',
    'header-2': '#845000',
    strip: '#dbe5bf',
    'strip-2': '#fdd9c2',
    layer: '#b6d9cf',
    'layer-edge': '#175e8c',
    band: ['#e8708a', '#ffb38a', '#ffd166', '#7fc4f0'],
  },
  zones: {
    left: zone('#e1e3cc', '#e8e9d3', '#eef0d9', '#dadcc5', '#c9cbb4', '#aeb09a', '#797a66'),
    middle: zone('#ebddeb', '#f2e3f2', '#f8eaf8', '#e4d6e4', '#d3c5d3', '#b7aab8', '#827583'),
    right: zone('#d0e5ee', '#d6ebf4', '#ddf2fb', '#c9dee6', '#b8ccd4', '#9eb2ba', '#697c84'),
    bar: zone('#fadbcb', '#ffe2d2', '#ffeae0', '#f3d4c5', '#e0c3b3', '#c5a99a', '#8e7365'),
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
    ink: '#c8e2bb',
    panel: '#d6e8cd',
    'panel-2': '#dceed3',
    'panel-3': '#c8dac0',
    line: '#b9c9b2',
    'line-strong': '#a0ae9a',
    field: '#6f796b',
    fg: '#20231e',
    muted: '#3e453a',
    faint: '#505a4b',
    accent: '#1c4dd7',
    'primary-hi': '#96876a',
    primary: '#8b7d60',
    'primary-lo': '#897b5d',
    'on-primary': '#120f09',
    'primary-edge': '#86775a',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#2a390e',
    'on-header': '#f1f5ec',
    'on-header-muted': '#ccd9bc',
    'header-ring': '#f1f5ec',
    'header-field': '#ccd9bc',
    second: '#003d1e',
    heading: '#4d1256',
    'header-2': '#542304',
    strip: '#c4e3c6',
    'strip-2': '#dfddb7',
    layer: '#ebcbbe',
    'layer-edge': '#005f68',
    band: ['#6b7a2a', '#9a4a2a', '#f3e7c9', '#c0613a'],
  },
  zones: {
    left: zone('#dedcbe', '#e7e4c6', '#edeacc', '#d9d6b8', '#c8c6a8', '#aeab8f', '#7a775c'),
    middle: zone('#efd5ce', '#f7ded6', '#fde4dc', '#e9d0c8', '#d8bfb8', '#bda59d', '#88716b'),
    right: zone('#bfe1e3', '#c7e9eb', '#ceeff1', '#badbdd', '#aacbcd', '#90b0b2', '#5d7b7e'),
    bar: zone('#ebd8be', '#f3e0c6', '#f9e6cc', '#e5d2b9', '#d4c2a9', '#baa88f', '#85735c'),
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
    ink: '#e7e3b6',
    panel: '#ece9cb',
    'panel-2': '#f2efd1',
    'panel-3': '#dfdbbe',
    line: '#cccab0',
    'line-strong': '#b1af98',
    field: '#7b7a6a',
    fg: '#27261f',
    muted: '#47463a',
    faint: '#5b5a49',
    accent: '#1d4ed8',
    'primary-hi': '#76487c',
    primary: '#6c3e72',
    'primary-lo': '#5f3265',
    'on-primary': '#ffffff',
    'primary-edge': '#76487c',
    ...LIGHT_STATES,
    warning: '#9a4a00',
    'warning-fg': '#5c3000',
  },
  decoration: {
    header: '#e7f157',
    'on-header': '#26281c',
    'on-header-muted': '#454734',
    'header-ring': '#26281c',
    'header-field': '#454734',
    second: '#594587',
    heading: '#1b3711',
    'header-2': '#f4e160',
    strip: '#e7e1bb',
    'strip-2': '#f7dcbd',
    layer: '#bfd9b9',
    'layer-edge': '#006789',
    band: ['#f2c230', '#ff9a1f', '#3a8f3a', '#ffffff'],
  },
  zones: {
    left: zone('#c2e9ea', '#c9eff1', '#cff5f7', '#bbe2e3', '#aad0d1', '#90b5b6', '#5c7f81'),
    middle: zone('#cde9ca', '#d4f0d1', '#d9f6d7', '#c6e2c4', '#b5d1b3', '#9bb598', '#677f65'),
    right: zone('#f3dcdc', '#f9e3e3', '#ffe9e9', '#ecd5d5', '#dac4c4', '#bfa9a9', '#887475'),
    bar: zone('#f6ddc7', '#fce4cd', '#ffebd8', '#eed6c0', '#ddc5af', '#c2aa95', '#8b7562'),
  },
};

/**
 * Himalaya (Nature): snow, ice and pine. Light, at the stone level.
 */
export const HIMALAYA: Appearance = {
  id: 'himalaya',
  name: 'Himalaya',
  base: 'light',
  colours: {
    ink: '#c1e0e4',
    panel: '#d1e6e9',
    'panel-2': '#d8edf0',
    'panel-3': '#c4d8dc',
    line: '#b6c7ca',
    'line-strong': '#9dadaf',
    field: '#6d7879',
    fg: '#1b2425',
    muted: '#374547',
    faint: '#455b5e',
    accent: '#1b4bd5',
    'primary-hi': '#357068',
    primary: '#2a665e',
    'primary-lo': '#1b5952',
    'on-primary': '#ffffff',
    'primary-edge': '#357068',
    ...LIGHT_STATES,
    warning: '#ab4d00',
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#89cbe0',
    'on-header': '#1b292d',
    'on-header-muted': '#324950',
    'header-ring': '#1b292d',
    'header-field': '#324950',
    second: '#003d47',
    heading: '#004444',
    'header-2': '#a8d5ca',
    strip: '#c1e0f0',
    'strip-2': '#cae2ca',
    layer: '#b2d9d8',
    'layer-edge': '#386189',
    band: ['#8fd0ec', '#ffffff', '#2f6b52', '#5a6b80'],
  },
  zones: {
    left: zone('#c9dee6', '#d1e6ef', '#d8edf6', '#c3d8e0', '#b4c7d0', '#9aaeb6', '#667881'),
    middle: zone('#dcd9e7', '#e4e0ef', '#ebe7f6', '#d6d3e1', '#c5c2d1', '#aca8b6', '#777481'),
    right: zone('#c5e1d3', '#cde9da', '#d3f0e1', '#bfdbcd', '#afcbbd', '#96b0a3', '#627b6f'),
    bar: zone('#c9e1cf', '#d1e8d6', '#d8efdd', '#c3dbc9', '#b2cab8', '#99b09e', '#667b6b'),
  },
};

/**
 * Uttarayan (Festivals): the kite festival's blue sky full of bright kites. Light, at the stone level. Moving:
 * a few kites float across the header.
 */
export const UTTARAYAN: Appearance = {
  id: 'uttarayan',
  name: 'Uttarayan',
  base: 'light',
  colours: {
    ink: '#c1dfee',
    panel: '#d2e5f0',
    'panel-2': '#d8ecf6',
    'panel-3': '#c4d8e1',
    line: '#b5c7cf',
    'line-strong': '#9eacb4',
    field: '#6d787d',
    fg: '#1d2327',
    muted: '#38454b',
    faint: '#485962',
    accent: '#1c4dd7',
    'primary-hi': '#ffe087',
    primary: '#ffd23f',
    'primary-lo': '#f0c328',
    'on-primary': '#140f02',
    'primary-edge': '#4c3e00',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#004782',
    'on-header': '#ffffff',
    'on-header-muted': '#c5daf1',
    'header-ring': '#ffffff',
    'header-field': '#c5daf1',
    second: '#035974',
    heading: '#0f5f7a',
    'header-2': '#006372',
    strip: '#bee1eb',
    'strip-2': '#b8e5d6',
    layer: '#ddd2a6',
    'layer-edge': '#884783',
    band: ['#e8402a', '#ffd23f', '#2fb344', '#d6238a', '#2a6fd6'],
  },
  zones: {
    left: zone('#cbdde9', '#d2e5f0', '#d9ecf7', '#c5d8e3', '#b5c7d2', '#9badb7', '#687883'),
    middle: zone('#e4dbb6', '#ece3bd', '#f3e9c3', '#dfd5b0', '#cec5a0', '#b3aa87', '#7f7655'),
    right: zone('#ead5dd', '#f2dde4', '#f9e4eb', '#e4d0d7', '#d3bfc6', '#b9a5ab', '#847178'),
    bar: zone('#c9e1c9', '#d1e9d1', '#d8efd8', '#c4dbc3', '#b4cab3', '#99b099', '#677b67'),
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
    ink: '#c3e2cc',
    panel: '#d3e7d9',
    'panel-2': '#d9eedf',
    'panel-3': '#c5dacb',
    line: '#b7c8bc',
    'line-strong': '#9eaea3',
    field: '#6e7971',
    fg: '#1d241f',
    muted: '#3a453e',
    faint: '#4b5b50',
    accent: '#1c4dd7',
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
    header: '#004f22',
    'on-header': '#eef6ef',
    'on-header-muted': '#c1dbc5',
    'header-ring': '#eef6ef',
    'header-field': '#c1dbc5',
    second: '#1f4f8a',
    heading: '#00645c',
    'header-2': '#004e49',
    strip: '#c6e3c6',
    'strip-2': '#b7e5db',
    layer: '#e1cfbf',
    'layer-edge': '#006d6c',
    band: ['#3a8f4a', '#ffffff', '#f3ecd0', '#d6457a'],
  },
  zones: {
    left: zone('#cce0cb', '#d3e8d3', '#daefda', '#c6dbc6', '#b6c9b5', '#9cb09c', '#697b68'),
    middle: zone('#e2dbbd', '#eae3c5', '#f1e9cb', '#ddd5b8', '#ccc4a7', '#b2ab8e', '#7e765c'),
    right: zone('#ead6dd', '#f2dde4', '#f9e4eb', '#e4d0d7', '#d3bfc5', '#b9a5ac', '#847178'),
    bar: zone('#c2e1da', '#c9e9e1', '#cff0e8', '#bcdcd4', '#abcbc3', '#92b1aa', '#5f7c76'),
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
    ink: '#283647',
    panel: '#2d3b4c',
    'panel-2': '#314052',
    'panel-3': '#384658',
    line: '#485667',
    'line-strong': '#5f6c7b',
    field: '#89939f',
    fg: '#f2f7fd',
    muted: '#ced6df',
    faint: '#acb7c4',
    accent: '#a8c4ff',
    'primary-hi': '#b0a6bd',
    primary: '#a59bb2',
    'primary-lo': '#978da4',
    'on-primary': '#100e13',
    'primary-edge': '#b0a6bd',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#5e5685',
    'on-header': '#ffffff',
    'on-header-muted': '#dcd9f6',
    'header-ring': '#ffffff',
    'header-field': '#dcd9f6',
    second: '#00cfcc',
    heading: '#cea7e8',
    'header-2': '#5e5685',
    strip: '#2d3b4c',
    'strip-2': '#2d3b4c',
    layer: '#27435f',
    'layer-edge': '#d1a8a4',
    band: ['#3e4a8f', '#7b5ea8', '#c9a46a'],
  },
  zones: {
    left: zone('#3b3144', '#403549', '#463a4e', '#4c4054', '#5c5065', '#72667c', '#9a8ea4'),
    middle: zone('#243745', '#293b4b', '#2d4150', '#344757', '#435767', '#596d7e', '#7f95a6'),
    right: zone('#1f3842', '#243d47', '#29424c', '#2e4852', '#3e5863', '#536e79', '#7a97a2'),
    bar: zone('#462f2b', '#4c3430', '#513835', '#573f3b', '#694e4a', '#806460', '#a88c87'),
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
    ink: '#432f37',
    panel: '#49353c',
    'panel-2': '#4e3940',
    'panel-3': '#553f47',
    line: '#645057',
    'line-strong': '#78666c',
    field: '#9c8e93',
    fg: '#fcf4f6',
    muted: '#dfd2d6',
    faint: '#c3b1b8',
    accent: '#a9d4ff',
    'primary-hi': '#5af4ff',
    primary: '#45e9f4',
    'primary-lo': '#2cdae5',
    'on-primary': '#001315',
    'primary-edge': '#5af4ff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#8b4857',
    'on-header': '#ffffff',
    'on-header-muted': '#f7d4d9',
    'header-ring': '#ffffff',
    'header-field': '#f7d4d9',
    second: '#deafe1',
    heading: '#fec5da',
    'header-2': '#8b4857',
    strip: '#49353c',
    'strip-2': '#49353c',
    layer: '#473b5d',
    'layer-edge': '#6bbea4',
    band: ['#7a3d63', '#b0607d', '#d9a07e'],
  },
  zones: {
    left: zone('#452e35', '#4b343a', '#50383f', '#573e45', '#684e55', '#7e636b', '#a78b92'),
    middle: zone('#393145', '#3f364b', '#433b4f', '#4a4156', '#5a5167', '#70667d', '#978ea5'),
    right: zone('#432e3a', '#4a3440', '#4e3845', '#543e4b', '#654f5b', '#7b6471', '#a48b98'),
    bar: zone('#2b3447', '#313a4e', '#353e52', '#3c4559', '#4b556a', '#606b80', '#8792a8'),
  },
};

/**
 * Dusk Sage (Dusk): a calm sage-green dusk: flat colour, soft words. Dark, at the twilight level.
 */
export const DUSK_SAGE: Appearance = {
  id: 'dusk-sage',
  name: 'Dusk Sage',
  base: 'dark',
  colours: {
    ink: '#263a25',
    panel: '#2b3f2a',
    'panel-2': '#30442e',
    'panel-3': '#354a34',
    line: '#475a46',
    'line-strong': '#5e6f5c',
    field: '#889687',
    fg: '#f2f8f1',
    muted: '#cfd8ce',
    faint: '#adb9ac',
    accent: '#a9d4ff',
    'primary-hi': '#cca7ad',
    primary: '#c19ca2',
    'primary-lo': '#b38e94',
    'on-primary': '#150d0e',
    'primary-edge': '#cca7ad',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#00221b',
    'on-header': '#ebf6f3',
    'on-header-muted': '#b8dcd2',
    'header-ring': '#ebf6f3',
    'header-field': '#b8dcd2',
    second: '#81fdd3',
    heading: '#98cdeb',
    'header-2': '#00221b',
    strip: '#2b3f2a',
    'strip-2': '#2b3f2a',
    layer: '#234556',
    'layer-edge': '#ecbaf0',
    band: ['#3f6f5a', '#7f9a62', '#c7b27a'],
  },
  zones: {
    left: zone('#213a31', '#263f36', '#2a443b', '#304a40', '#405a50', '#557066', '#7c998d'),
    middle: zone('#373620', '#3c3b24', '#414029', '#47452f', '#58563f', '#6d6b54', '#95947a'),
    right: zone('#283648', '#2d3b4d', '#324052', '#374658', '#475669', '#5b6c7f', '#8394a8'),
    bar: zone('#1f3a33', '#243f38', '#29443d', '#2f4a42', '#3e5a53', '#547068', '#7b9990'),
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
    ink: '#292b3c',
    panel: '#2f3042',
    'panel-2': '#333547',
    'panel-3': '#3b3c4f',
    line: '#4c4e5f',
    'line-strong': '#636474',
    field: '#8b8c99',
    fg: '#eff0f7',
    muted: '#cacbd6',
    faint: '#abadbc',
    accent: '#b8c8ff',
    'primary-hi': '#f7d9ed',
    primary: '#ebcee1',
    'primary-lo': '#dcc0d2',
    'on-primary': '#130d11',
    'primary-edge': '#f7d9ed',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#461771',
    'on-header': '#f6f2fb',
    'on-header-muted': '#dad0ec',
    'header-ring': '#f6f2fb',
    'header-field': '#dad0ec',
    second: '#9becd2',
    heading: '#eec9fc',
    'header-2': '#461771',
    strip: '#2f3042',
    'strip-2': '#2f3042',
    layer: '#324b38',
    'layer-edge': '#e0cd86',
    band: ['#2e2a6a', '#5a4ab0', '#e8b4c8'],
  },
  zones: {
    left: zone('#1a2e3c', '#1f3341', '#243846', '#2a404e', '#3c5160', '#526877', '#7990a0'),
    middle: zone('#3a2633', '#402b38', '#44303c', '#4c3744', '#5e4856', '#765e6c', '#9f8694'),
    right: zone('#212c3e', '#263244', '#2b3649', '#323e51', '#434f63', '#58667a', '#808ea3'),
    bar: zone('#212f1f', '#273524', '#2b3a29', '#324130', '#445341', '#596956', '#80927d'),
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
    ink: '#372a1a',
    panel: '#3d2f1f',
    'panel-2': '#413424',
    'panel-3': '#493b2b',
    line: '#5a4d3e',
    'line-strong': '#706356',
    field: '#958c81',
    fg: '#f5efe9',
    muted: '#d3cbc1',
    faint: '#b7ac9f',
    accent: '#a8d0ff',
    'primary-hi': '#a1d0ae',
    primary: '#96c5a3',
    'primary-lo': '#88b795',
    'on-primary': '#08120b',
    'primary-edge': '#a1d0ae',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#5c2908',
    'on-header': '#fbf2ed',
    'on-header-muted': '#edcfbf',
    'header-ring': '#fbf2ed',
    'header-field': '#edcfbf',
    second: '#ede48f',
    heading: '#fec3d6',
    'header-2': '#5c2908',
    strip: '#3d2f1f',
    'strip-2': '#3d2f1f',
    layer: '#1d483e',
    'layer-edge': '#f2fbff',
    band: ['#7a5220', '#c08a3a', '#e8c890'],
  },
  zones: {
    left: zone('#372a18', '#3c2f1c', '#413421', '#493b28', '#5b4d39', '#71634f', '#9b8b76'),
    middle: zone('#3d2622', '#432b27', '#48302c', '#503732', '#624944', '#795f59', '#a48781'),
    right: zone('#2a2e1a', '#2f331e', '#343823', '#3a3f2a', '#4c513b', '#626750', '#8a9178'),
    bar: zone('#182e3c', '#1d3442', '#223847', '#29404f', '#3b5261', '#506878', '#7791a1'),
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
    ink: '#123b3d',
    panel: '#184042',
    'panel-2': '#1d4547',
    'panel-3': '#234b4d',
    line: '#385b5d',
    'line-strong': '#517072',
    field: '#7e9698',
    fg: '#eef8f8',
    muted: '#c9d8d9',
    faint: '#a6babb',
    accent: '#a8d8ff',
    'primary-hi': '#cbdbc0',
    primary: '#c0d0b5',
    'primary-lo': '#b2c2a7',
    'on-primary': '#0d110b',
    'primary-edge': '#cbdbc0',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#336560',
    'on-header': '#ffffff',
    'on-header-muted': '#bee4df',
    'header-ring': '#ffffff',
    'header-field': '#bee4df',
    second: '#f1b8df',
    heading: '#a3e8f1',
    'header-2': '#336560',
    strip: '#184042',
    'strip-2': '#184042',
    layer: '#4f3958',
    'layer-edge': '#afb89f',
    band: ['#1f5560', '#3a8a8a', '#a8d8c8'],
  },
  zones: {
    left: zone('#1e3a35', '#233f3a', '#28443f', '#2e4a45', '#3d5a54', '#53706a', '#799891'),
    middle: zone('#293648', '#2e3b4d', '#324052', '#384558', '#48566a', '#5d6b7f', '#8393a8'),
    right: zone('#26392b', '#2b3e30', '#304335', '#35493a', '#465a4a', '#5a6f5f', '#819786'),
    bar: zone('#1e3941', '#233e46', '#27434b', '#2d4951', '#3d5962', '#526f78', '#79979f'),
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
    ink: '#43222a',
    panel: '#48282f',
    'panel-2': '#4e2d34',
    'panel-3': '#55343b',
    line: '#66464c',
    'line-strong': '#7b5e64',
    field: '#9f878b',
    fg: '#f7eeef',
    muted: '#d7c8cb',
    faint: '#bca9ac',
    accent: '#ffd0a0',
    'primary-hi': '#fff2fa',
    primary: '#ffe1f3',
    'primary-lo': '#f0d2e4',
    'on-primary': '#130d11',
    'primary-edge': '#fff2fa',
    ...COMFORT_DARK_STATES,
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#b40b5d',
    'on-header': '#ffffff',
    'on-header-muted': '#f5d2db',
    'header-ring': '#ffffff',
    'header-field': '#f5d2db',
    second: '#67d9ab',
    heading: '#c7baf5',
    'header-2': '#771a6f',
    strip: '#363355',
    'strip-2': '#542c26',
    layer: '#393f61',
    'layer-edge': '#e6d6a4',
    band: ['#9b111e', '#e0b84a', '#f4ead8', '#9b111e'],
  },
  zones: {
    left: zone('#42241a', '#48291f', '#4e2e24', '#56352b', '#68463b', '#815d52', '#aa8578'),
    middle: zone('#43231e', '#492823', '#4e2e28', '#56342f', '#69453f', '#815c56', '#ab847d'),
    right: zone('#3e261e', '#442b23', '#4a3028', '#51372f', '#644840', '#7b5f56', '#a5877d'),
    bar: zone('#34273b', '#392c41', '#3e3147', '#46384e', '#574960', '#6f6078', '#9688a0'),
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
    ink: '#213a28',
    panel: '#27402d',
    'panel-2': '#2c4432',
    'panel-3': '#324b38',
    line: '#445a48',
    'line-strong': '#5b705f',
    field: '#859689',
    fg: '#f1f8f2',
    muted: '#cdd8cf',
    faint: '#acb9ae',
    accent: '#9ff0d0',
    'primary-hi': '#f8fcff',
    primary: '#e2f2ff',
    'primary-lo': '#d3e3f0',
    'on-primary': '#0d1012',
    'primary-edge': '#f8fcff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9997',
    rec: '#ff9891',
  },
  decoration: {
    header: '#00532a',
    'on-header': '#edf6ef',
    'on-header-muted': '#c0dcc7',
    'header-ring': '#edf6ef',
    'header-field': '#c0dcc7',
    second: '#ffee78',
    heading: '#fad393',
    'header-2': '#00402e',
    strip: '#124656',
    'strip-2': '#513d19',
    layer: '#2c4731',
    'layer-edge': '#d9bea9',
    band: ['#0b6e4f', '#2fa36b', '#e8d48a'],
  },
  zones: {
    left: zone('#3a3510', '#403b17', '#443f1b', '#4b4622', '#5a5531', '#706c46', '#98936c'),
    middle: zone('#193847', '#1f3e4d', '#244252', '#2a4959', '#3a5869', '#506f80', '#7697a8'),
    right: zone('#34361a', '#3a3c20', '#3e4024', '#45472b', '#54573a', '#6a6d4f', '#919575'),
    bar: zone('#482d2d', '#4f3333', '#533737', '#5a3e3e', '#6b4d4d', '#826363', '#ab8a89'),
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
    ink: '#223554',
    panel: '#273b5a',
    'panel-2': '#2c3f5f',
    'panel-3': '#324666',
    line: '#435673',
    'line-strong': '#5b6c87',
    field: '#8793a5',
    fg: '#f2f7fd',
    muted: '#cfd6e0',
    faint: '#aeb7c4',
    accent: '#9cc3ff',
    'primary-hi': '#ffffff',
    primary: '#f8fdff',
    'primary-lo': '#e9eef0',
    'on-primary': '#0f1010',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9997',
    rec: '#ff9891',
  },
  decoration: {
    header: '#272fa9',
    'on-header': '#f1f4fc',
    'on-header-muted': '#cbd4f0',
    'header-ring': '#f1f4fc',
    'header-field': '#cbd4f0',
    second: '#fef6a4',
    heading: '#5cc9bd',
    'header-2': '#1b217f',
    strip: '#064847',
    'strip-2': '#58354b',
    layer: '#0f4755',
    'layer-edge': '#e8c870',
    band: ['#0f2a8a', '#3a6ad8', '#c8d8ff', '#e8c060'],
  },
  zones: {
    left: zone('#432c4b', '#493251', '#4e3655', '#553c5c', '#654c6d', '#7c6284', '#a489ac'),
    middle: zone('#3e2e49', '#443450', '#483854', '#4f3f5b', '#5f4f6b', '#756482', '#9d8cab'),
    right: zone('#1c3a28', '#22402d', '#264532', '#2d4c38', '#3c5c47', '#53725d', '#789a83'),
    bar: zone('#353621', '#3a3c27', '#3f402b', '#454732', '#545740', '#6a6d56', '#92947c'),
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
    ink: '#e3d6e5',
    panel: '#e7e0e8',
    'panel-2': '#eee6ef',
    'panel-3': '#d9d3db',
    line: '#c8c2c9',
    'line-strong': '#aea8af',
    field: '#787579',
    fg: '#252126',
    muted: '#484049',
    faint: '#5e5360',
    accent: '#3a4ab8',
    'primary-hi': '#593c5e',
    primary: '#4f3354',
    'primary-lo': '#432748',
    'on-primary': '#ffffff',
    'primary-edge': '#593c5e',
    ...LIGHT_STATES,
    warning: '#a84b00',
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#c2b6dd',
    'on-header': '#292530',
    'on-header-muted': '#484354',
    'header-ring': '#292530',
    'header-field': '#484354',
    second: '#8a1e3a',
    heading: '#8c3984',
    'header-2': '#e3b8cb',
    strip: '#e9d7d5',
    'strip-2': '#ddd9e6',
    layer: '#bbd7dc',
    'layer-edge': '#895152',
    band: ['#f4eef4', '#e0d8e8', '#c8c0d8', '#f8f0e8'],
  },
  zones: {
    left: zone('#e1d7e3', '#e9dfec', '#f0e6f2', '#dcd2de', '#cac1cd', '#b0a7b3', '#7c737f'),
    middle: zone('#ddd8e6', '#e5e0ef', '#ebe7f5', '#d7d3e1', '#c6c2d0', '#aca8b5', '#787481'),
    right: zone('#e8d6d6', '#f1dedd', '#f7e5e4', '#e3d1d0', '#d2c0bf', '#b8a6a6', '#827272'),
    bar: zone('#cfded4', '#d7e6dc', '#deece2', '#cad9cf', '#b9c8be', '#a0aea4', '#6c7971'),
  },
};

/**
 * Pukhraj (Jewels): yellow sapphire (pukhraj): honey and topaz. Dark, at the night level.
 */
export const PUKHRAJ: Appearance = {
  id: 'pukhraj',
  name: 'Pukhraj',
  base: 'dark',
  colours: {
    ink: '#2d2e11',
    panel: '#323316',
    'panel-2': '#37381b',
    'panel-3': '#3e3f23',
    line: '#4f5136',
    'line-strong': '#65674f',
    field: '#8d8f7c',
    fg: '#f0f1e9',
    muted: '#cccdc1',
    faint: '#adaf9f',
    accent: '#a8d8ff',
    'primary-hi': '#ffffff',
    primary: '#f8fdff',
    'primary-lo': '#e9eef0',
    'on-primary': '#0f1010',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    warning: '#ffc561',
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#685c0f',
    'on-header': '#ffffff',
    'on-header-muted': '#e1ddbe',
    'header-ring': '#ffffff',
    'header-field': '#e1ddbe',
    second: '#f3fffc',
    heading: '#81ffdb',
    'header-2': '#4f4400',
    strip: '#542b2e',
    'strip-2': '#502c3d',
    layer: '#2e425b',
    'layer-edge': '#c4ecfb',
    band: ['#e8b820', '#f4d470', '#8a6410'],
  },
  zones: {
    left: zone('#1e311b', '#233620', '#283b25', '#2f422c', '#41543d', '#566a52', '#7e947a'),
    middle: zone('#362b10', '#3b3015', '#40351a', '#483b20', '#5a4d32', '#716347', '#9a8c6f'),
    right: zone('#22301c', '#273521', '#2c3a26', '#33412c', '#44533e', '#5a6953', '#82937a'),
    bar: zone('#14312e', '#1a3633', '#1f3b38', '#26423f', '#385451', '#4d6a67', '#75948f'),
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
    ink: '#0f3038',
    panel: '#15363d',
    'panel-2': '#1a3b42',
    'panel-3': '#21424a',
    line: '#36535a',
    'line-strong': '#506a70',
    field: '#7d9096',
    fg: '#e9f2f4',
    muted: '#c0ced2',
    faint: '#9eb1b6',
    accent: '#c0d8ff',
    'primary-hi': '#ffffff',
    primary: '#f8fdff',
    'primary-lo': '#e9eef0',
    'on-primary': '#0f1010',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8584',
    rec: '#ff8882',
  },
  decoration: {
    header: '#00192a',
    'on-header': '#ecf5fb',
    'on-header-muted': '#bed8ec',
    'header-ring': '#ecf5fb',
    'header-field': '#bed8ec',
    second: '#f6fdff',
    heading: '#b4faf5',
    'header-2': '#080441',
    strip: '#0e3e39',
    'strip-2': '#153c4a',
    layer: '#37405c',
    'layer-edge': '#d5e1dc',
    band: ['#a8e8ff', '#ffc8f0', '#fff0a8', '#c8b8ff', '#ffffff'],
  },
  zones: {
    left: zone('#2d293d', '#322f43', '#373448', '#3e3a4f', '#4f4c61', '#666379', '#8e8aa2'),
    middle: zone('#31283b', '#362e41', '#3b3346', '#42394d', '#534b5f', '#6a6277', '#9289a0'),
    right: zone('#292e1a', '#2e331f', '#333824', '#3a3f2b', '#4b513c', '#626852', '#899078'),
    bar: zone('#352738', '#3b2c3d', '#403142', '#47384a', '#59495b', '#716073', '#99889b'),
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
    ink: '#f6d3c3',
    panel: '#f6ddd3',
    'panel-2': '#fce4d9',
    'panel-3': '#e8d0c5',
    line: '#d5c0b7',
    'line-strong': '#b9a69e',
    field: '#80746e',
    fg: '#27211e',
    muted: '#4c403a',
    faint: '#64534b',
    accent: '#1c4dd7',
    'primary-hi': '#50796f',
    primary: '#466f65',
    'primary-lo': '#396258',
    'on-primary': '#ffffff',
    'primary-edge': '#50796f',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#800015',
    'on-header': '#ffffff',
    'on-header-muted': '#f3d0cd',
    'header-ring': '#ffffff',
    'header-field': '#f3d0cd',
    second: '#343100',
    heading: '#00636c',
    'header-2': '#ab2900',
    strip: '#ebd9bf',
    'strip-2': '#f1d6c3',
    layer: '#bbd8cc',
    'layer-edge': '#008775',
    band: ['#d8401a', '#f08a2a', '#f8c840', '#3a8a3a'],
  },
  zones: {
    left: zone('#edd3e3', '#f5dbeb', '#fbe2f2', '#e7cedd', '#d6becd', '#bca3b2', '#86707e'),
    middle: zone('#c7e0d5', '#cfe8dd', '#d5efe4', '#c2dbd0', '#b1cabf', '#98b0a5', '#657b72'),
    right: zone('#d0dfc7', '#d8e7cf', '#dfeed6', '#cbdac2', '#bac9b2', '#a0af98', '#6d7a66'),
    bar: zone('#efd5d2', '#f7dcda', '#fde3e0', '#e9cfcc', '#d9bfbc', '#bea4a2', '#88716f'),
  },
};

/**
 * Kesuda (Nature): kesuda (palash) in flower: orange blossoms on dark branches. Light, at the stone level.
 * Moving: a few orange petals fall past the header.
 */
export const KESUDA: Appearance = {
  id: 'kesuda',
  name: 'Kesuda',
  base: 'light',
  colours: {
    ink: '#fdd0c7',
    panel: '#fadcd6',
    'panel-2': '#ffe3dd',
    'panel-3': '#eccec8',
    line: '#d9beb9',
    'line-strong': '#bca5a0',
    field: '#83726f',
    fg: '#28211f',
    muted: '#4d403d',
    faint: '#66524f',
    accent: '#1c4dd7',
    'primary-hi': '#136071',
    primary: '#005667',
    'primary-lo': '#004958',
    'on-primary': '#ffffff',
    'primary-edge': '#136071',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#1f0900',
    'on-header': '#fbf2ec',
    'on-header-muted': '#eccfbe',
    'header-ring': '#fbf2ec',
    'header-field': '#eccfbe',
    second: '#1a3400',
    heading: '#7e486b',
    'header-2': '#351707',
    strip: '#d3e0c3',
    'strip-2': '#e8d5ed',
    layer: '#bbd7d7',
    'layer-edge': '#126568',
    band: ['#f06a0a', '#ff9a2a', '#2a1a10'],
  },
  zones: {
    left: zone('#ead8c2', '#f2e0ca', '#f9e7d1', '#e4d2bc', '#d4c1ad', '#b9a893', '#837360'),
    middle: zone('#e9d5e3', '#f1ddeb', '#f8e4f2', '#e3cfdd', '#d3becd', '#b8a5b3', '#83707e'),
    right: zone('#e6d9c1', '#efe1c9', '#f5e8cf', '#e1d3bc', '#d0c3ab', '#b5a992', '#81745f'),
    bar: zone('#cdddea', '#d4e5f2', '#dbecf9', '#c7d7e4', '#b7c6d3', '#9dacb9', '#697783'),
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
    ink: '#fadad6',
    panel: '#f9e3e0',
    'panel-2': '#ffe9e6',
    'panel-3': '#ebd6d3',
    line: '#d8c4c3',
    'line-strong': '#baaaa8',
    field: '#827775',
    fg: '#2c2423',
    muted: '#504341',
    faint: '#685553',
    accent: '#1d4ed8',
    'primary-hi': '#71967b',
    primary: '#678b71',
    'primary-lo': '#62866c',
    'on-primary': '#0a120c',
    'primary-edge': '#61866b',
    ...LIGHT_STATES,
    warning: '#a54900',
  },
  decoration: {
    header: '#dcb0b3',
    'on-header': '#312424',
    'on-header-muted': '#564042',
    'header-ring': '#312424',
    'header-field': '#564042',
    second: '#053900',
    heading: '#82283b',
    'header-2': '#dcb0b3',
    strip: '#ecdbee',
    'strip-2': '#c7e8d7',
    layer: '#c1d7c6',
    'layer-edge': '#00a0b6',
    band: ['#fff8f0', '#f8d870', '#f4b8c8', '#4a8a3a'],
  },
  zones: {
    left: zone('#eee0cc', '#f4e6d2', '#faecd8', '#e7d9c6', '#d5c7b4', '#b9ac99', '#847766'),
    middle: zone('#ede0c8', '#f3e7ce', '#f9edd4', '#e6dac1', '#d4c8b0', '#b8ad95', '#847862'),
    right: zone('#cae7e6', '#d1eeed', '#d7f4f3', '#c4e1e0', '#b2cece', '#97b3b2', '#647e7e'),
    bar: zone('#e7deef', '#eee5f6', '#f4ebfc', '#e1d8e8', '#cfc5d6', '#b3abbb', '#7f7686'),
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
    ink: '#003042',
    panel: '#003648',
    'panel-2': '#003b50',
    'panel-3': '#074358',
    line: '#255467',
    'line-strong': '#436b7d',
    field: '#7a919b',
    fg: '#eaf2f5',
    muted: '#c1ced4',
    faint: '#a0b0b9',
    accent: '#ffe0b0',
    'primary-hi': '#d3fff8',
    primary: '#a0fdf1',
    'primary-lo': '#91eee2',
    'on-primary': '#011311',
    'primary-edge': '#d3fff8',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#004474',
    'on-header': '#ffffff',
    'on-header-muted': '#c4dcf2',
    'header-ring': '#ffffff',
    'header-field': '#c4dcf2',
    second: '#edfeaa',
    heading: '#94cea3',
    'header-2': '#006473',
    strip: '#233d1f',
    'strip-2': '#313b14',
    layer: '#363f21',
    'layer-edge': '#f4dfc1',
    band: ['#0a4a78', '#1a8aa8', '#a8e8e8', '#e8d8b0'],
  },
  zones: {
    left: zone('#1e2c45', '#23314b', '#283650', '#2f3e58', '#3f4f6b', '#566683', '#7d8fad'),
    middle: zone('#0c3129', '#13372e', '#193c33', '#20443b', '#32554b', '#486c62', '#70958a'),
    right: zone('#122e42', '#173448', '#1c384d', '#244055', '#355167', '#4b6980', '#7391a9'),
    bar: zone('#143128', '#19362d', '#1e3b32', '#26433a', '#36544a', '#4d6c62', '#749589'),
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
    ink: '#c6e5fb',
    panel: '#d6eafa',
    'panel-2': '#ddf1ff',
    'panel-3': '#c8ddec',
    line: '#b9cbd9',
    'line-strong': '#a0b0bb',
    field: '#707a83',
    fg: '#20272b',
    muted: '#3c474e',
    faint: '#4c5c67',
    accent: '#1d4ed8',
    'primary-hi': '#ffa68e',
    primary: '#ff9477',
    'primary-lo': '#ef8669',
    'on-primary': '#1b0a06',
    'primary-edge': '#4d1500',
    ...LIGHT_STATES,
    warning: '#7b2d00',
  },
  decoration: {
    header: '#4896e4',
    'on-header': '#000000',
    'on-header-muted': '#1b2835',
    'header-ring': '#000000',
    'header-field': '#1b2835',
    second: '#0a4a8a',
    heading: '#1a4a7a',
    'header-2': '#6cb6ff',
    strip: '#cbe4f5',
    'strip-2': '#c4e7e7',
    layer: '#e2cebf',
    'layer-edge': '#0a4a8a',
    band: ['#3a8ad8', '#a8d8f8', '#ffffff', '#f0c040'],
  },
  zones: {
    left: zone('#d0e4f3', '#d6eafa', '#def1ff', '#c9ddec', '#b8ccdb', '#9eb1bf', '#697b89'),
    middle: zone('#cbe6ed', '#d1ecf4', '#d8f3fa', '#c4dfe6', '#b3cdd5', '#99b2b9', '#647c83'),
    right: zone('#f0decd', '#f6e5d3', '#fdecda', '#e9d8c6', '#d7c6b5', '#bcab9a', '#857667'),
    bar: zone('#dfe0f2', '#e5e6f9', '#ecedff', '#d8d9eb', '#c7c7da', '#acadbe', '#777788'),
  },
};

/**
 * Chandni (Nature): moonlight (chandni): silver and night blue. Light, at the paper level. Moving: the moon
 * glows softly at the header’s end.
 */
export const CHANDNI: Appearance = {
  id: 'chandni',
  name: 'Chandni',
  base: 'light',
  colours: {
    ink: '#e1dff1',
    panel: '#e7e7f1',
    'panel-2': '#ededf7',
    'panel-3': '#dad9e3',
    line: '#c8c8d1',
    'line-strong': '#adadb4',
    field: '#79787e',
    fg: '#26252c',
    muted: '#454550',
    faint: '#595868',
    accent: '#3a4ab8',
    'primary-hi': '#48677f',
    primary: '#3e5d75',
    'primary-lo': '#325068',
    'on-primary': '#ffffff',
    'primary-edge': '#48677f',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#020c36',
    'on-header': '#eff4fc',
    'on-header-muted': '#c7d5f0',
    'header-ring': '#eff4fc',
    'header-field': '#c7d5f0',
    second: '#0d5d67',
    heading: '#2b1c4a',
    'header-2': '#0d164f',
    strip: '#e6dded',
    'strip-2': '#cde4ea',
    layer: '#c2d4e4',
    'layer-edge': '#007a8a',
    band: ['#1a2050', '#c8c8e8', '#f8f8ff'],
  },
  zones: {
    left: zone('#e6deef', '#ece5f6', '#f2ebfc', '#dfd7e8', '#cdc6d7', '#b2abbb', '#7d7585'),
    middle: zone('#d3e4e9', '#daebf0', '#dff1f7', '#ccdde3', '#bbccd1', '#a0b1b6', '#6c7b80'),
    right: zone('#ebdde8', '#f2e4ef', '#f8eaf5', '#e4d7e1', '#d2c6d0', '#b7aab4', '#81757f'),
    bar: zone('#d2e5e5', '#d9ecec', '#dff2f2', '#cbdede', '#bacdcd', '#a0b1b2', '#6b7c7c'),
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
    ink: '#f5dae8',
    panel: '#f5e3ec',
    'panel-2': '#fbe9f2',
    'panel-3': '#e8d5df',
    line: '#d4c5cd',
    'line-strong': '#b8aab1',
    field: '#80777b',
    fg: '#2a2427',
    muted: '#4e4349',
    faint: '#66555e',
    accent: '#1d4ed8',
    'primary-hi': '#16705f',
    primary: '#006655',
    'primary-lo': '#005849',
    'on-primary': '#ffffff',
    'primary-edge': '#16705f',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#43012b',
    'on-header': '#fbf1f5',
    'on-header-muted': '#ecccdb',
    'header-ring': '#fbf1f5',
    'header-field': '#ecccdb',
    second: '#492e80',
    heading: '#7f030f',
    'header-2': '#810045',
    strip: '#efdec7',
    'strip-2': '#d9e5c7',
    layer: '#b9d8d1',
    'layer-edge': '#5d795b',
    band: ['#c8102e', '#ffffff', '#f2c230', '#ffffff', '#1f8a3a'],
  },
  zones: {
    left: zone('#f9dbd5', '#ffe2dc', '#ffe9e6', '#f2d4ce', '#e0c3bd', '#c5a7a2', '#8e736f'),
    middle: zone('#fbdbcf', '#ffe2d7', '#ffeae2', '#f4d4c8', '#e3c3b7', '#c7a79c', '#907369'),
    right: zone('#cae8db', '#d1efe2', '#d7f5e8', '#c3e1d4', '#b3d0c3', '#98b4a8', '#657f74'),
    bar: zone('#e9ddf1', '#f0e4f8', '#f6eafe', '#e2d6e9', '#d1c5d8', '#b5aabd', '#817587'),
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
    ink: '#2a3923',
    panel: '#2f3e28',
    'panel-2': '#34432d',
    'panel-3': '#3a4933',
    line: '#4a5944',
    'line-strong': '#616f5c',
    field: '#8a9586',
    fg: '#f3f8f1',
    muted: '#d0d8cd',
    faint: '#afb9ab',
    accent: '#a8d8ff',
    'primary-hi': '#ffffff',
    primary: '#fff6c0',
    'primary-lo': '#f0e7b2',
    'on-primary': '#121005',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#ad2448',
    'on-header': '#ffffff',
    'on-header-muted': '#f7d4d7',
    'header-ring': '#ffffff',
    'header-field': '#f7d4d7',
    second: '#ffc2da',
    heading: '#f2fdae',
    'header-2': '#33673c',
    strip: '#5e3532',
    'strip-2': '#29472a',
    layer: '#2a4359',
    'layer-edge': '#f0e0a0',
    band: ['#b01e2e', '#1f7a4a', '#f2c230', '#ffffff', '#2a2a6a'],
  },
  zones: {
    left: zone('#273924', '#2b3e28', '#30432d', '#364933', '#465a42', '#5c7058', '#82987e'),
    middle: zone('#4d2c28', '#52312d', '#573631', '#5e3c37', '#6f4c47', '#87625d', '#b08983'),
    right: zone('#43311a', '#49361f', '#4e3b24', '#54412a', '#655139', '#7b684e', '#a48f74'),
    bar: zone('#422e40', '#473345', '#4c384b', '#523e51', '#634e61', '#7a6478', '#a28b9f'),
  },
};

/**
 * Ajrakh (Crafts and textiles): ajrakh block print: indigo and madder red on black and white; colours only.
 * Dark, at the twilight level.
 */
export const AJRAKH: Appearance = {
  id: 'ajrakh',
  name: 'Ajrakh',
  base: 'dark',
  colours: {
    ink: '#2f3447',
    panel: '#343a4d',
    'panel-2': '#393e52',
    'panel-3': '#3f4459',
    line: '#4f5567',
    'line-strong': '#656a7b',
    field: '#8d929f',
    fg: '#f3f6fd',
    muted: '#d1d5e0',
    faint: '#b1b6c5',
    accent: '#a8c0ff',
    'primary-hi': '#c7dfff',
    primary: '#b4d4ff',
    'primary-lo': '#a6c5f0',
    'on-primary': '#091018',
    'primary-edge': '#c7dfff',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#a2391d',
    'on-header': '#ffffff',
    'on-header-muted': '#f6d4ca',
    'header-ring': '#ffffff',
    'header-field': '#f6d4ca',
    second: '#ffd4b9',
    heading: '#e5dca7',
    'header-2': '#2c3881',
    strip: '#4c3f16',
    'strip-2': '#2b4160',
    layer: '#573844',
    'layer-edge': '#e8e0d0',
    band: ['#1a2a6a', '#a8281a', '#f4ead8', '#1a1a1a'],
  },
  zones: {
    left: zone('#203746', '#253d4d', '#294151', '#2f4757', '#405869', '#546d7e', '#7b96a7'),
    middle: zone('#45301c', '#4c3622', '#503a25', '#56402b', '#67513b', '#7d6650', '#a78e76'),
    right: zone('#203742', '#263d48', '#2a414d', '#304854', '#405864', '#556e7a', '#7c96a3'),
    bar: zone('#413126', '#48372c', '#4c3b30', '#524136', '#635246', '#79675a', '#a28f81'),
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
    ink: '#e6d9bd',
    panel: '#ebe1cf',
    'panel-2': '#f1e8d5',
    'panel-3': '#dcd4c1',
    line: '#cbc4b3',
    'line-strong': '#b0a99c',
    field: '#7a766c',
    fg: '#25221b',
    muted: '#474237',
    faint: '#5d5646',
    accent: '#1c4dd7',
    'primary-hi': '#021869',
    primary: '#000b5e',
    'primary-lo': '#00004c',
    'on-primary': '#ffffff',
    'primary-edge': '#021869',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#331604',
    'on-header': '#fbf2ed',
    'on-header-muted': '#eccfbe',
    'header-ring': '#fbf2ed',
    'header-field': '#eccfbe',
    second: '#8d3350',
    heading: '#3e1e00',
    'header-2': '#692214',
    strip: '#e9d9bf',
    'strip-2': '#f3d4d2',
    layer: '#c4d4e5',
    'layer-edge': '#1d4883',
    band: ['#2a3a7a', '#a84a1a', '#d8a830', '#2a2018'],
  },
  zones: {
    left: zone('#f2d4ce', '#fadcd6', '#ffe3de', '#eccec9', '#dcbeb9', '#c1a39f', '#8b706c'),
    middle: zone('#dedbc4', '#e6e3cc', '#edead3', '#d9d6bf', '#c9c5af', '#aeab95', '#7a7662'),
    right: zone('#cedcea', '#d6e4f2', '#ddebf9', '#c9d6e5', '#b9c6d4', '#9eacb9', '#6b7785'),
    bar: zone('#c4e0dc', '#cce8e4', '#d2efeb', '#bfdbd7', '#afcac6', '#95afac', '#627b78'),
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
    ink: '#e8e1c5',
    panel: '#ece8d5',
    'panel-2': '#f2eedb',
    'panel-3': '#dfdac8',
    line: '#cdc9b8',
    'line-strong': '#b1aea0',
    field: '#7b796f',
    fg: '#27261f',
    muted: '#49463a',
    faint: '#5e5949',
    accent: '#1d4ed8',
    'primary-hi': '#699372',
    primary: '#5f8868',
    'primary-lo': '#5d8766',
    'on-primary': '#09120b',
    'primary-edge': '#5e8767',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#1a3a9a',
    'on-header': '#eff4fc',
    'on-header-muted': '#c8d5f0',
    'header-ring': '#eff4fc',
    'header-field': '#c8d5f0',
    second: '#9c0056',
    heading: '#354977',
    'header-2': '#2e0d19',
    strip: '#f7d9e1',
    'strip-2': '#cce7d0',
    layer: '#e8cad2',
    'layer-edge': '#a25771',
    band: ['#d82020', '#f8c820', '#1a8a3a', '#1a3a9a', '#e83a8a'],
  },
  zones: {
    left: zone('#e8e1c7', '#efe8ce', '#f5eed4', '#e1dbc1', '#d0c9b0', '#b5ae95', '#7f7861'),
    middle: zone('#f4dbe1', '#fce1e8', '#ffe8ee', '#edd4da', '#dcc3c9', '#c0a8ae', '#897379'),
    right: zone('#d0e7d4', '#d7eeda', '#ddf4e0', '#c9e0cd', '#b8cfbc', '#9eb4a1', '#697e6d'),
    bar: zone('#cde5f1', '#d4ecf8', '#daf2fe', '#c6deea', '#b5cdd8', '#9bb2bd', '#667c87'),
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
    ink: '#432505',
    panel: '#482b0b',
    'panel-2': '#4e3011',
    'panel-3': '#553718',
    line: '#65492e',
    'line-strong': '#7b6048',
    field: '#9b8a7b',
    fg: '#f5efe9',
    muted: '#d4cac1',
    faint: '#b9aca0',
    accent: '#ffd0a8',
    'primary-hi': '#ffffff',
    primary: '#f0fff3',
    'primary-lo': '#e1f0e4',
    'on-primary': '#0d100e',
    'primary-edge': '#ffffff',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#8c2b00',
    'on-header': '#fcf2ee',
    'on-header-muted': '#eecec3',
    'header-ring': '#fcf2ee',
    'header-field': '#eecec3',
    second: '#d7b0be',
    heading: '#aed2a7',
    'header-2': '#8c2b00',
    strip: '#482b0b',
    'strip-2': '#482b0b',
    layer: '#393718',
    'layer-edge': '#e9f0df',
    band: ['#8a3a1a', '#f8f0e0', '#c88a3a'],
  },
  zones: {
    left: zone('#3e2336', '#43293c', '#492e42', '#503548', '#62465a', '#7a5c71', '#a4849a'),
    middle: zone('#292e17', '#2e341d', '#343922', '#3a4028', '#4b5139', '#61684f', '#899175'),
    right: zone('#382638', '#3d2b3e', '#433043', '#4a374a', '#5c485c', '#735e73', '#9c879c'),
    bar: zone('#342b17', '#3a301d', '#3f3522', '#473c28', '#584d39', '#6f644e', '#978c75'),
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
    ink: '#f9d4b0',
    panel: '#f7dec6',
    'panel-2': '#fee5cd',
    'panel-3': '#ead0b9',
    line: '#d7c0ac',
    'line-strong': '#baa795',
    field: '#817467',
    fg: '#27211c',
    muted: '#4a4138',
    faint: '#625448',
    accent: '#1b4bd5',
    'primary-hi': '#5e919f',
    primary: '#548694',
    'primary-lo': '#528491',
    'on-primary': '#071114',
    'primary-edge': '#4e818e',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#973e54',
    'on-header': '#ffffff',
    'on-header-muted': '#f6d2d7',
    'header-ring': '#ffffff',
    'header-field': '#f6d2d7',
    second: '#76397f',
    heading: '#2c2c00',
    'header-2': '#76323e',
    strip: '#ead5e7',
    'strip-2': '#edd4e4',
    layer: '#bbd7db',
    'layer-edge': '#4a5c7d',
    band: ['#c87a5a', '#e8c0a0', '#8a4030'],
  },
  zones: {
    left: zone('#efd6c6', '#f6decd', '#fee5d4', '#e9d0c0', '#d8c0b0', '#bda696', '#877263'),
    middle: zone('#e6d6e8', '#eeddef', '#f5e4f6', '#e0d0e1', '#cfbfd1', '#b5a6b7', '#807182'),
    right: zone('#edd6ca', '#f5ded2', '#fce5d9', '#e7d0c5', '#d6c0b4', '#bca69b', '#867268'),
    bar: zone('#d7dae8', '#dfe2f0', '#e6e9f7', '#d1d4e2', '#c1c4d2', '#a7aab7', '#737582'),
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
    ink: '#47301c',
    panel: '#4d3521',
    'panel-2': '#513a25',
    'panel-3': '#58402b',
    line: '#67513e',
    'line-strong': '#7b6756',
    field: '#9f8f81',
    fg: '#fbf5ef',
    muted: '#ded4cb',
    faint: '#c1b4a9',
    accent: '#a8d8ff',
    'primary-hi': '#c3ecfc',
    primary: '#b8e0f0',
    'primary-lo': '#aad1e1',
    'on-primary': '#091114',
    'primary-edge': '#c3ecfc',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#221000',
    'on-header': '#faf3ec',
    'on-header-muted': '#e8d1ba',
    'header-ring': '#faf3ec',
    'header-field': '#e8d1ba',
    second: '#ffd8a0',
    heading: '#f4d1ac',
    'header-2': '#0b0200',
    strip: '#583a1e',
    'strip-2': '#5e352f',
    layer: '#2c4731',
    'layer-edge': '#e8d0a8',
    band: ['#5a3418', '#a8702a', '#e8c890'],
  },
  zones: {
    left: zone('#46301d', '#4c3522', '#503a26', '#57402c', '#68503c', '#7e6650', '#a88d77'),
    middle: zone('#3b341c', '#403a21', '#453e26', '#4b442c', '#5c553c', '#716a50', '#999276'),
    right: zone('#482e2a', '#4e332f', '#533833', '#5a3e39', '#6b4e49', '#82635e', '#aa8b85'),
    bar: zone('#27392b', '#2c3e30', '#304334', '#37493a', '#465a4a', '#5c6f5f', '#839786'),
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
    ink: '#423218',
    panel: '#48371e',
    'panel-2': '#4d3c23',
    'panel-3': '#534329',
    line: '#62533b',
    'line-strong': '#776953',
    field: '#9c9080',
    fg: '#faf6ef',
    muted: '#dcd4ca',
    faint: '#beb5a7',
    accent: '#a8e0d0',
    'primary-hi': '#74a699',
    primary: '#699b8e',
    'primary-lo': '#5c8d81',
    'on-primary': '#07120f',
    'primary-edge': '#74a699',
    ...COMFORT_DARK_STATES,
    danger: '#ff9997',
    rec: '#ff9891',
  },
  decoration: {
    header: '#785700',
    'on-header': '#ffffff',
    'on-header-muted': '#e8dabd',
    'header-ring': '#ffffff',
    'header-field': '#e8dabd',
    second: '#faffe7',
    heading: '#6ed5bc',
    'header-2': '#583800',
    strip: '#164939',
    'strip-2': '#5c3726',
    layer: '#254836',
    'layer-edge': '#f2e5a4',
    band: ['#b8901a', '#e8c860', '#3fb8a0'],
  },
  zones: {
    left: zone('#46301d', '#4c3522', '#513a27', '#58402d', '#69503d', '#7f6651', '#a88d77'),
    middle: zone('#3f3318', '#45381e', '#4a3d23', '#514329', '#615338', '#78694d', '#9f9173'),
    right: zone('#203747', '#263c4c', '#2b4152', '#314859', '#405869', '#556e7f', '#7c95a8'),
    bar: zone('#453020', '#4a3525', '#4f3a2a', '#564130', '#66513f', '#7d6654', '#a68d7b'),
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
    ink: '#542820',
    panel: '#5a2e25',
    'panel-2': '#60322a',
    'panel-3': '#663930',
    line: '#754a41',
    'line-strong': '#886159',
    field: '#a48d88',
    fg: '#fdf4f3',
    muted: '#e0d3d0',
    faint: '#c4b2ae',
    accent: '#a8d8ff',
    'primary-hi': '#fff6d2',
    primary: '#fdeaa1',
    'primary-lo': '#eedb93',
    'on-primary': '#130f02',
    'primary-edge': '#fff6d2',
    ...COMFORT_DARK_STATES,
    warning: '#f5b541',
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#7f5213',
    'on-header': '#ffffff',
    'on-header-muted': '#eed8bf',
    'header-ring': '#ffffff',
    'header-field': '#eed8bf',
    second: '#8ecea9',
    heading: '#fef7c0',
    'header-2': '#613a00',
    strip: '#5d3728',
    'strip-2': '#533753',
    layer: '#244556',
    'layer-edge': '#acc597',
    band: ['#b8582a', '#e8905a', '#5aa898'],
  },
  zones: {
    left: zone('#4b2d21', '#523227', '#57372b', '#5e3d32', '#6e4d41', '#866256', '#af8a7c'),
    middle: zone('#472d36', '#4d333b', '#523740', '#593d46', '#6a4d56', '#80626c', '#a98a94'),
    right: zone('#1c393a', '#223f3f', '#264344', '#2d4a4b', '#3d5a5b', '#51706f', '#799898'),
    bar: zone('#44301f', '#4a3625', '#4f3a29', '#56412f', '#66513e', '#7d6654', '#a58e7a'),
  },
};

/**
 * Gold Leaf (Mandir materials): gold leaf (varakh) on cream, with maroon. Light, at the paper level. Moving: a
 * glint of gold passes along the band.
 */
export const GOLD_LEAF: Appearance = {
  id: 'gold-leaf',
  name: 'Gold Leaf',
  base: 'light',
  colours: {
    ink: '#e0e4bd',
    panel: '#e6eacf',
    'panel-2': '#ecf0d6',
    'panel-3': '#d9ddc3',
    line: '#c8cbb4',
    'line-strong': '#adb09c',
    field: '#797a6c',
    fg: '#262620',
    muted: '#45473b',
    faint: '#585b4a',
    accent: '#1d4ed8',
    'primary-hi': '#6b433f',
    primary: '#613a36',
    'primary-lo': '#542e2b',
    'on-primary': '#ffffff',
    'primary-edge': '#6b433f',
    ...LIGHT_STATES,
    warning: '#752900',
  },
  decoration: {
    header: '#a2a839',
    'on-header': '#000000',
    'on-header-muted': '#272816',
    'header-ring': '#000000',
    'header-field': '#272816',
    second: '#1a2200',
    heading: '#844c5f',
    'header-2': '#939826',
    strip: '#fbd8d7',
    'strip-2': '#f5d9e5',
    layer: '#dad2b8',
    'layer-edge': '#979e78',
    band: ['#d8b048', '#f8ecc0', '#a8801a'],
  },
  zones: {
    left: zone('#e5e2c4', '#ece9ca', '#f2efd0', '#dfdcbe', '#cecaac', '#b3af93', '#7d795e'),
    middle: zone('#f3ddd0', '#fae4d7', '#ffeade', '#edd7ca', '#dbc5b9', '#c0aa9e', '#89746a'),
    right: zone('#e7e1cb', '#eee8d2', '#f4eed7', '#e1dbc5', '#cfc9b3', '#b5ae99', '#7f7865'),
    bar: zone('#eddce9', '#f3e3f0', '#f9e9f6', '#e6d6e3', '#d4c5d1', '#b9aab6', '#837480'),
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
    ink: '#eae1bf',
    panel: '#ede8d1',
    'panel-2': '#f3eed7',
    'panel-3': '#e0dbc4',
    line: '#cec9b5',
    'line-strong': '#b2ae9d',
    field: '#7c796d',
    fg: '#27261f',
    muted: '#49463a',
    faint: '#5e5949',
    accent: '#1d4ed8',
    'primary-hi': '#871470',
    primary: '#7c0066',
    'primary-lo': '#690056',
    'on-primary': '#ffffff',
    'primary-edge': '#871470',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#7e002f',
    'on-header': '#fff5f6',
    'on-header-muted': '#efccd0',
    'header-ring': '#fff5f6',
    'header-field': '#efccd0',
    second: '#900000',
    heading: '#5a2a6a',
    'header-2': '#ac002e',
    strip: '#d6e5cc',
    'strip-2': '#cce4f2',
    layer: '#e6cbd0',
    'layer-edge': '#6e4b9b',
    band: ['#c8400a', '#f0a020', '#8a5ab8', '#f8e8c8'],
  },
  zones: {
    left: zone('#f9dadb', '#ffe1e2', '#ffe9e9', '#f3d4d5', '#e0c2c3', '#c4a7a8', '#8e7274'),
    middle: zone('#d5e3f2', '#dce9f9', '#e2efff', '#cfdcec', '#becbd9', '#a3b0be', '#6e7a88'),
    right: zone('#eedcec', '#f6e2f3', '#fce8f9', '#e8d6e6', '#d6c4d4', '#baa9b8', '#847482'),
    bar: zone('#cce7de', '#d3eee5', '#d9f4ea', '#c7e1d8', '#b5cfc6', '#9bb4ab', '#667e76'),
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
    ink: '#112f42',
    panel: '#173448',
    'panel-2': '#1c394d',
    'panel-3': '#234155',
    line: '#375264',
    'line-strong': '#50687a',
    field: '#7d909d',
    fg: '#eaf1f6',
    muted: '#c3cdd5',
    faint: '#a1b0ba',
    accent: '#a8d8ff',
    'primary-hi': '#fffdf6',
    primary: '#fff2c0',
    'primary-lo': '#f0e3b2',
    'on-primary': '#120f06',
    'primary-edge': '#fffdf6',
    ...COMFORT_DARK_STATES,
    danger: '#ff8786',
    rec: '#ff8882',
  },
  decoration: {
    header: '#206572',
    'on-header': '#ffffff',
    'on-header-muted': '#bce2ea',
    'header-ring': '#ffffff',
    'header-field': '#bce2ea',
    second: '#61ddb7',
    heading: '#f3f68d',
    'header-2': '#1b3572',
    strip: '#003f35',
    'strip-2': '#233856',
    layer: '#1e483d',
    'layer-edge': '#f0d870',
    band: ['#102a6a', '#0a8a8a', '#3a9a3a', '#f0c020'],
  },
  zones: {
    left: zone('#003139', '#06363e', '#0c3b43', '#16434b', '#29555d', '#406b73', '#68959d'),
    middle: zone('#1d311b', '#233621', '#273b25', '#2f422c', '#3f543d', '#556a53', '#7d947a'),
    right: zone('#352b14', '#3a3018', '#40341d', '#483c25', '#594d35', '#70634b', '#998c72'),
    bar: zone('#232b43', '#283049', '#2d354e', '#353d57', '#454e69', '#5b6480', '#838daa'),
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
    ink: '#363151',
    panel: '#3a3656',
    'panel-2': '#3f3b5b',
    'panel-3': '#454162',
    line: '#555171',
    'line-strong': '#6b6884',
    field: '#9290a4',
    fg: '#f6f6fd',
    muted: '#d5d4df',
    faint: '#b6b4c4',
    accent: '#c8d8ff',
    'primary-hi': '#fffefe',
    primary: '#ffeeec',
    'primary-lo': '#f0dfdd',
    'on-primary': '#120e0e',
    'primary-edge': '#fffefe',
    ...COMFORT_DARK_STATES,
    danger: '#ff9795',
    rec: '#ff9891',
  },
  decoration: {
    header: '#345d78',
    'on-header': '#ffffff',
    'on-header-muted': '#bedaed',
    'header-ring': '#ffffff',
    'header-field': '#bedaed',
    second: '#fbfcff',
    heading: '#ffd8ef',
    'header-2': '#0e3e59',
    strip: '#503a49',
    'strip-2': '#2b4638',
    layer: '#1f474b',
    'layer-edge': '#def0e8',
    band: ['#3a4a6a', '#c8d0e8', '#ffffff', '#c8d0e8'],
  },
  zones: {
    left: zone('#422f41', '#473346', '#4c384b', '#523e51', '#634e62', '#7a6478', '#a28ca0'),
    middle: zone('#1d393e', '#223e43', '#274349', '#2d494f', '#3d595f', '#527075', '#79989d'),
    right: zone('#432f3b', '#483440', '#4d3945', '#543e4b', '#644e5b', '#7b6472', '#a48c99'),
    bar: zone('#21393b', '#253e3f', '#2a4345', '#31494b', '#40595b', '#566f71', '#7d9799'),
  },
};

/**
 * Dev Diwali (Festivals): rows of diyas along the river at dusk. Dark, at the twilight level. Moving: rows of
 * diyas glow along the band.
 */
export const DEV_DIWALI: Appearance = {
  id: 'dev-diwali',
  name: 'Dev Diwali',
  base: 'dark',
  colours: {
    ink: '#1c374d',
    panel: '#213d53',
    'panel-2': '#264258',
    'panel-3': '#2c485f',
    line: '#3f586d',
    'line-strong': '#566d81',
    field: '#8294a3',
    fg: '#f0f7fc',
    muted: '#cdd7df',
    faint: '#abb8c3',
    accent: '#a8d0ff',
    'primary-hi': '#fce3da',
    primary: '#f0d8cf',
    'primary-lo': '#e1c9c1',
    'on-primary': '#130e0c',
    'primary-edge': '#fce3da',
    ...COMFORT_DARK_STATES,
    danger: '#ff9997',
    rec: '#ff9891',
  },
  decoration: {
    header: '#262b46',
    'on-header': '#f1f4fc',
    'on-header-muted': '#cdd4f0',
    'header-ring': '#f1f4fc',
    'header-field': '#cdd4f0',
    second: '#d4aec7',
    heading: '#ffe8c0',
    'header-2': '#272300',
    strip: '#0b4943',
    'strip-2': '#5a3824',
    layer: '#563b26',
    'layer-edge': '#ffdaa3',
    band: ['#1a3a5a', '#f0a030', '#ffd870', '#f0a030', '#1a3a5a'],
  },
  zones: {
    left: zone('#2f334a', '#353950', '#3a3e55', '#40445b', '#50546c', '#646983', '#8b91ab'),
    middle: zone('#482d35', '#4d333b', '#523840', '#593d45', '#6a4d56', '#80626b', '#a98a92'),
    right: zone('#1e3841', '#243e47', '#29434c', '#2f4952', '#3f5962', '#536e78', '#7a97a0'),
    bar: zone('#462e33', '#4c3438', '#51393d', '#573f43', '#684e53', '#7e6368', '#a78b90'),
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
    'primary-hi': '#ffe5d3',
    primary: '#ffd6b9',
    'primary-lo': '#f0c7ab',
    'on-primary': '#150d08',
    'primary-edge': '#907969',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#4b5e00',
    'on-header': '#f9fdf4',
    'on-header-muted': '#cfd8bc',
    'header-ring': '#f9fdf4',
    'header-field': '#cfd8bc',
    second: '#433400',
    heading: '#283604',
    'header-2': '#4b5e00',
    strip: '#f4ddc1',
    'strip-2': '#e1e2c7',
    layer: '#c5d7c1',
    'layer-edge': '#303f21',
    band: ['#f8d820', '#ffffff', '#f0a020', '#6a9a2a'],
  },
  zones: {
    left: zone('#e7e2c0', '#eee9c7', '#f4efcd', '#e0dbba', '#d0caa9', '#b4af8e', '#7f7a5c'),
    middle: zone('#f4ddcb', '#fbe4d2', '#ffebdb', '#edd6c4', '#dcc6b4', '#bfaa98', '#8a7565'),
    right: zone('#d4e6d0', '#dbeed7', '#e1f4dd', '#cedfca', '#bdceb9', '#a1b39e', '#6d7e6a'),
    bar: zone('#cfe5ec', '#d6ecf3', '#dcf2f9', '#c8dee5', '#b7cdd4', '#9db1b8', '#697c83'),
  },
};

/**
 * Annakut (Festivals): the Annakut's abundance: ghee, jaggery, marigold and banana leaf. Light, at the paper
 * level.
 */
export const ANNAKUT: Appearance = {
  id: 'annakut',
  name: 'Annakut',
  base: 'light',
  colours: {
    ink: '#ffdac1',
    panel: '#ffe2ce',
    'panel-2': '#ffeadb',
    'panel-3': '#f2d5c1',
    line: '#dec4b2',
    'line-strong': '#c0aa9b',
    field: '#85766b',
    fg: '#2b2520',
    muted: '#4e443c',
    faint: '#66564c',
    accent: '#1d4ed8',
    'primary-hi': '#233d1f',
    primary: '#1a3416',
    'primary-lo': '#0f290b',
    'on-primary': '#ffffff',
    'primary-edge': '#233d1f',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#5e4223',
    'on-header': '#ffffff',
    'on-header-muted': '#ead4bd',
    'header-ring': '#ffffff',
    'header-field': '#ead4bd',
    second: '#153800',
    heading: '#263305',
    'header-2': '#77522e',
    strip: '#f4d9e6',
    'strip-2': '#c8e7da',
    layer: '#b7d8da',
    'layer-edge': '#005366',
    band: ['#e8a020', '#f8e0a0', '#c84a1a', '#5a9a2a', '#f8f0e0'],
  },
  zones: {
    left: zone('#e0e4c9', '#e6eacf', '#edf1d6', '#d9ddc2', '#c8ccb2', '#adb197', '#787a63'),
    middle: zone('#f8dbd2', '#ffe2d7', '#ffeae2', '#f1d5cb', '#e0c3b9', '#c4a99f', '#8d736b'),
    right: zone('#eedcec', '#f5e2f2', '#fce8f9', '#e8d5e5', '#d6c4d4', '#bba9b8', '#847382'),
    bar: zone('#cbe6eb', '#d1edf2', '#d7f3f8', '#c4e0e5', '#b2ced3', '#98b3b7', '#647d82'),
  },
};

/**
 * Raksha Bandhan (Festivals): the rakhi's red thread and gold. Light, at the paper level.
 */
export const RAKSHA_BANDHAN: Appearance = {
  id: 'raksha-bandhan',
  name: 'Raksha Bandhan',
  base: 'light',
  colours: {
    ink: '#f5d8f7',
    panel: '#f6e1f6',
    'panel-2': '#fce8fc',
    'panel-3': '#e8d4e8',
    line: '#d5c3d6',
    'line-strong': '#b8a9b8',
    field: '#807681',
    fg: '#29242a',
    muted: '#4b434c',
    faint: '#625663',
    accent: '#1d4ed8',
    'primary-hi': '#c5a388',
    primary: '#ba987d',
    'primary-lo': '#ac8a70',
    'on-primary': '#150e08',
    'primary-edge': '#98775e',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#8c0b1c',
    'on-header': '#ffffff',
    'on-header-muted': '#f8d5d2',
    'header-ring': '#ffffff',
    'header-field': '#f8d5d2',
    second: '#9a0050',
    heading: '#47003d',
    'header-2': '#994400',
    strip: '#e6dcf4',
    'strip-2': '#eedec7',
    layer: '#e8cbc8',
    'layer-edge': '#7f276f',
    band: ['#c8102e', '#f0c020', '#ffffff', '#f0c020', '#c8102e'],
  },
  zones: {
    left: zone('#e9ddf1', '#f0e3f7', '#f6eafe', '#e2d6e9', '#d1c5d8', '#b5aabd', '#807587'),
    middle: zone('#dce5cb', '#e2ebd1', '#e8f2d8', '#d5dec4', '#c3ccb3', '#a8b198', '#747c66'),
    right: zone('#ebddeb', '#f2e3f2', '#f8eaf9', '#e4d6e4', '#d2c5d3', '#b7aab8', '#827583'),
    bar: zone('#ecdcef', '#f2e3f5', '#f9e9fc', '#e5d5e8', '#d2c4d6', '#b7a9bb', '#827485'),
  },
};

/**
 * Ganesh Chaturthi (Festivals): vermilion, marigold, durva green and modak white. Light, at the stone level.
 */
export const GANESH_CHATURTHI: Appearance = {
  id: 'ganesh-chaturthi',
  name: 'Ganesh Chaturthi',
  base: 'light',
  colours: {
    ink: '#fbd0d1',
    panel: '#f9dbdd',
    'panel-2': '#ffe2e3',
    'panel-3': '#eacecf',
    line: '#d7bebf',
    'line-strong': '#bba5a5',
    field: '#827273',
    fg: '#282121',
    muted: '#4d3f40',
    faint: '#655252',
    accent: '#1c4dd7',
    'primary-hi': '#752523',
    primary: '#6a1a1a',
    'primary-lo': '#5c0a0e',
    'on-primary': '#ffffff',
    'primary-edge': '#752523',
    ...LIGHT_STATES,
    danger: '#b51518',
    rec: '#b11c1d',
  },
  decoration: {
    header: '#125b25',
    'on-header': '#ffffff',
    'on-header-muted': '#c8e2ca',
    'header-ring': '#ffffff',
    'header-field': '#c8e2ca',
    second: '#92303f',
    heading: '#123407',
    'header-2': '#236926',
    strip: '#f3d4d3',
    'strip-2': '#eed7c5',
    layer: '#e8ccc1',
    'layer-edge': '#293e23',
    band: ['#d84a1a', '#f8d020', '#3a8a2a', '#ffffff'],
  },
  zones: {
    left: zone('#ead4e7', '#f2dcef', '#f9e3f6', '#e4cfe2', '#d3bed0', '#b9a4b6', '#837081'),
    middle: zone('#c4e1d3', '#cce9db', '#d3f0e2', '#bfdbcd', '#afcbbd', '#95b1a4', '#627b70'),
    right: zone('#d3dfc6', '#dbe6ce', '#e1edd4', '#cdd9c0', '#bcc8b0', '#a3ae96', '#6f7964'),
    bar: zone('#ebd6d2', '#f4ded9', '#fbe4e0', '#e6d0cc', '#d5bfbc', '#baa6a2', '#85716e'),
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
    ink: '#e9e0cf',
    panel: '#ece7db',
    'panel-2': '#f3ede2',
    'panel-3': '#dfdace',
    line: '#cdc8be',
    'line-strong': '#b2ada5',
    field: '#7b7972',
    fg: '#29261f',
    muted: '#4a453a',
    faint: '#605949',
    accent: '#1d4ed8',
    'primary-hi': '#26477d',
    primary: '#1d3d72',
    'primary-lo': '#113165',
    'on-primary': '#ffffff',
    'primary-edge': '#26477d',
    ...LIGHT_STATES,
    warning: '#752900',
  },
  decoration: {
    header: '#dc7c39',
    'on-header': '#000000',
    'on-header-muted': '#36261c',
    'header-ring': '#000000',
    'header-field': '#36261c',
    second: '#481500',
    heading: '#3f1900',
    'header-2': '#f49c45',
    strip: '#d3e6cf',
    'strip-2': '#d8e1f2',
    layer: '#c2d4e4',
    'layer-edge': '#03436b',
    band: ['#f0a030', '#ffffff', '#f0a030'],
  },
  zones: {
    left: zone('#f6dbdc', '#fde1e2', '#ffe9e9', '#efd4d6', '#ddc3c4', '#c1a8a9', '#8b7375'),
    middle: zone('#d8e2ee', '#dfe9f5', '#e5effb', '#d3dbe8', '#c1cad6', '#a6afbb', '#717985'),
    right: zone('#f2dcdb', '#f9e3e2', '#ffe9e8', '#ecd6d5', '#dac4c3', '#bea9a8', '#887474'),
    bar: zone('#d3e4e9', '#d9ebef', '#dff1f5', '#ccdee2', '#baccd0', '#9fb1b5', '#6b7c80'),
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
  dhaja: { left: [318, 0.05], middle: [290, 0.05], right: [56, 0.04], bar: [352, 0.045] },
  tiranga: { left: [62, 0.03], middle: [140, 0.03], right: [265, 0.02], bar: [98, 0.035] },
  saffron: { left: [115, 0.05], middle: [344, 0.05], right: [36, 0.04], bar: [180, 0.04] },
  peacock: { left: [167, 0.04], middle: [256, 0.05], right: [125, 0.045], bar: [315, 0.05] },
  'midnight-blue': { left: [240, 0.05], middle: [268, 0.06], right: [213, 0.04], bar: [313, 0.05] },
  sandalwood: { left: [71, 0.03], middle: [112, 0.04], right: [121, 0.03], bar: [172, 0.025] },
  lotus: { left: [355, 0.03], middle: [315, 0.03], right: [150, 0.03], bar: [235, 0.025] },
  marble: { left: [306, 0.025], middle: [281, 0.025], right: [106, 0.03], bar: [231, 0.02] },
  tulsi: { left: [193, 0.045], middle: [79, 0.04], right: [204, 0.04], bar: [312, 0.05] },
  diwali: { left: [323, 0.05], middle: [256, 0.05], right: [13, 0.05], bar: [94, 0.045] },
  holi: { left: [205, 0.04], middle: [342, 0.03], right: [82, 0.05], bar: [138, 0.04] },
  aarti: { left: [124, 0.04], middle: [110, 0.03], right: [48, 0.025], bar: [114, 0.035] },
  monsoon: { left: [237, 0.04], middle: [175, 0.04], right: [95, 0.045], bar: [221, 0.05] },
  sandhya: { left: [285, 0.05], middle: [307, 0.05], right: [323, 0.05], bar: [283, 0.045] },
  forest: { left: [188, 0.045], middle: [241, 0.04], right: [71, 0.04], bar: [104, 0.04] },
  navratri: { left: [30, 0.05], middle: [280, 0.05], right: [185, 0.045], bar: [48, 0.045] },
  neel: { left: [248, 0.06], middle: [42, 0.05], right: [47, 0.04], bar: [249, 0.04] },
  ratna: { left: [265, 0.05], middle: [155, 0.05], right: [5, 0.05], bar: [65, 0.045] },
  prabhat: { left: [110, 0.03], middle: [325, 0.025], right: [226, 0.025], bar: [49, 0.04] },
  mehndi: { left: [103, 0.04], middle: [37, 0.03], right: [202, 0.035], bar: [75, 0.04] },
  haldi: { left: [200, 0.04], middle: [143, 0.05], right: [17, 0.025], bar: [64, 0.04] },
  himalaya: { left: [226, 0.025], middle: [296, 0.02], right: [164, 0.035], bar: [153, 0.035] },
  uttarayan: { left: [235, 0.025], middle: [95, 0.05], right: [355, 0.025], bar: [145, 0.04] },
  mogra: { left: [145, 0.035], middle: [95, 0.04], right: [355, 0.025], bar: [180, 0.035] },
  'dusk-slate': { left: [310, 0.036], middle: [243, 0.036], right: [224, 0.036], bar: [29, 0.036] },
  'dusk-rose': { left: [1, 0.036], middle: [304, 0.036], right: [344, 0.036], bar: [264, 0.036] },
  'dusk-sage': { left: [169, 0.036], middle: [104, 0.036], right: [253, 0.036], bar: [175, 0.036] },
  'dusk-indigo': { left: [238, 0.036], middle: [342, 0.036], right: [259, 0.036], bar: [141, 0.036] },
  'dusk-amber': { left: [77, 0.036], middle: [32, 0.036], right: [119, 0.036], bar: [237, 0.038] },
  'dusk-teal': { left: [180, 0.036], middle: [256, 0.036], right: [152, 0.036], bar: [218, 0.036] },
  manek: { left: [39, 0.05], middle: [30, 0.05], right: [39, 0.04], bar: [312, 0.04] },
  panna: { left: [102, 0.055], middle: [232, 0.045], right: [113, 0.045], bar: [20, 0.04] },
  neelam: { left: [318, 0.06], middle: [310, 0.05], right: [155, 0.05], bar: [112, 0.035] },
  moti: { left: [320, 0.02], middle: [300, 0.02], right: [21, 0.02], bar: [157, 0.02] },
  pukhraj: { left: [141, 0.045], middle: [86, 0.045], right: [136, 0.04], bar: [186, 0.035] },
  heera: { left: [292, 0.035], middle: [304, 0.035], right: [120, 0.035], bar: [322, 0.035] },
  gulmohar: { left: [340, 0.035], middle: [168, 0.03], right: [134, 0.035], bar: [25, 0.03] },
  kesuda: { left: [71, 0.035], middle: [336, 0.03], right: [82, 0.035], bar: [243, 0.025] },
  champa: { left: [75, 0.03], middle: [84, 0.035], right: [196, 0.03], bar: [310, 0.025] },
  sagar: { left: [261, 0.05], middle: [174, 0.045], right: [242, 0.05], bar: [171, 0.04] },
  akash: { left: [242, 0.03], middle: [217, 0.03], right: [67, 0.03], bar: [284, 0.025] },
  chandni: { left: [306, 0.025], middle: [219, 0.02], right: [332, 0.02], bar: [200, 0.02] },
  bandhani: { left: [30, 0.035], middle: [40, 0.04], right: [168, 0.035], bar: [313, 0.03] },
  patola: { left: [141, 0.045], middle: [28, 0.05], right: [73, 0.045], bar: [329, 0.04] },
  ajrakh: { left: [237, 0.04], middle: [65, 0.045], right: [229, 0.035], bar: [57, 0.03] },
  kalamkari: { left: [29, 0.035], middle: [99, 0.03], right: [250, 0.025], bar: [187, 0.03] },
  madhubani: { left: [95, 0.035], middle: [0, 0.03], right: [150, 0.035], bar: [230, 0.03] },
  warli: { left: [338, 0.05], middle: [120, 0.04], right: [326, 0.04], bar: [84, 0.035] },
  sandstone: { left: [55, 0.035], middle: [323, 0.03], right: [48, 0.03], bar: [277, 0.02] },
  teak: { left: [62, 0.045], middle: [95, 0.04], right: [30, 0.04], bar: [150, 0.035] },
  pittal: { left: [60, 0.045], middle: [84, 0.045], right: [240, 0.04], bar: [60, 0.04] },
  tamra: { left: [41, 0.05], middle: [358, 0.04], right: [196, 0.035], bar: [62, 0.04] },
  'gold-leaf': { left: [101, 0.04], middle: [50, 0.03], right: [93, 0.03], bar: [332, 0.025] },
  kesar: { left: [15, 0.035], middle: [252, 0.025], right: [330, 0.03], bar: [173, 0.03] },
  janmashtami: { left: [210, 0.05], middle: [142, 0.045], right: [85, 0.04], bar: [269, 0.045] },
  'sharad-purnima': { left: [328, 0.04], middle: [210, 0.035], right: [343, 0.035], bar: [202, 0.03] },
  'dev-diwali': { left: [276, 0.04], middle: [0, 0.04], right: [220, 0.035], bar: [6, 0.035] },
  'vasant-panchami': { left: [100, 0.045], middle: [60, 0.035], right: [140, 0.035], bar: [220, 0.025] },
  annakut: { left: [113, 0.035], middle: [40, 0.035], right: [330, 0.03], bar: [210, 0.03] },
  'raksha-bandhan': { left: [313, 0.03], middle: [123, 0.035], right: [324, 0.025], bar: [320, 0.03] },
  'ganesh-chaturthi': { left: [330, 0.035], middle: [165, 0.035], right: [128, 0.035], bar: [30, 0.025] },
  'guru-purnima': { left: [15, 0.03], middle: [257, 0.02], right: [19, 0.025], bar: [215, 0.02] },
};
/** A built-in appearance by its id. */
export const builtIn = (id: string): Appearance | undefined => BUILT_IN.find((a) => a.id === id);

/** What Follow the computer shows: Black when the computer is set dark, else White. */
export const followed = (dark: boolean): Appearance => (dark ? BLACK : WHITE);
