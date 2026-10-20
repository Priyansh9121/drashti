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
  zones: plainZones(BLACK_COLOURS),
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
 * The colourful appearances (Session 40), each with one clear colour for the next thing to do and states that
 * never clash with it (rules.ts). Made with the licensed design skills' ideas (the skills review): a palette from
 * the subject's own things, designed light and dark rather than inverted. Session 42 made them more than one
 * colour (the user found them "very static ... just one colour"): surfaces that carry their hue, a header of their
 * own with a band under it, a second colour for what marks, and coloured headings, every one measured by the rules.
 * Session 44 gave each real colour (Priyansh: still "mostly one or two colours"): four hues at least across its places,
 * the header (a gradient now), the left column, the middle, the right column and the layer bar (each a zone with
 * surfaces of its own, zones.ts), the panels' title strips (a gradient), the band and the layer buttons, and made
 * twelve more, each a clearly different combination (src/main/contrast.test.ts measures both).
 */

/**
 * Dhaja: the mandir flag's colours (Session 42), colours only: the flag's shape, its disc and the logo it
 * carries are never drawn. The flag has five stripes, three red and two white, and a white disc ringed red
 * (Flags of the World); the logo on it is in red and gold. Dark maroon surfaces; the header the flag's red
 * deepening to wine, its words warm white; the band red and white stripes with the logo's gold between them.
 * Its zones (Session 44): the left column maroon, the middle wine, the right column the logo's gold,
 * darkened, and the layer bar bronze; the title strips maroon into wine, a lit layer button wine and an unlit
 * one's edge gold. Red belongs to LIVE, so the flag's red stays in the header, the band and the deep
 * surfaces: the next thing to do is white, marks the logo's gold, softened, and headings a warm peach. Named
 * for the flag (dhaja), not for any organisation, so it can be used anywhere.
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
    'header-2': '#7a1238',
    strip: '#4b1d1e',
    'strip-2': '#471e33',
    layer: '#3f162d',
    'layer-edge': '#c1a057',
    band: ['#d0202b', '#ffffff', '#f2b630', '#ffffff', '#d0202b'],
  },
  zones: {
    left: zone('#200104', '#29060a', '#340f12', '#421b1e', '#4a2325', '#613839', '#b98989'),
    middle: zone('#1e0112', '#260719', '#310f22', '#3e1c2f', '#472336', '#5d384b', '#b4899e'),
    right: zone('#120a00', '#1b1100', '#241a03', '#30260f', '#382d16', '#4d422b', '#a09479'),
    bar: zone('#1a0600', '#230c02', '#2d1508', '#3a2113', '#42291b', '#583d2f', '#ae8f7e'),
  },
};

/**
 * Tiranga: India's flag colours (Session 42), colours only: no Ashoka Chakra and no flag shape, which the
 * Flag Code of India keeps for the flag itself. The commonly published shades: saffron #FF9933, white, India
 * green #138808 and the wheel's navy #000080. Light, the flag's white for panels; the header the wheel's navy
 * deepening to indigo; the band saffron, white and green. Its zones (Session 44): the left column a whisper
 * of saffron, the middle of green, the right column of the wheel's navy and the layer bar the cream of khadi;
 * the title strips saffron into khadi's gold, a lit layer button green and an unlit one's edge navy. The next
 * thing to do in saffron, kept apart from a warning (a deep amber-brown here) and with a navy edge; marks and
 * headings in navy. Green stays in the band and the surfaces, apart from success's green.
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
    'header-2': '#1a1a6e',
    strip: '#ffdec2',
    'strip-2': '#ede4b7',
    layer: '#cde7c7',
    'layer-edge': '#2a498e',
    band: ['#ff9933', '#ffffff', '#138808'],
  },
  zones: {
    left: zone('#f5e2d2', '#feebdb', '#fff4eb', '#f1dece', '#e0cebe', '#c2afa0', '#746356'),
    middle: zone('#e0f0dd', '#e9f9e6', '#f7fff5', '#dcecd9', '#cbdbc8', '#adbca9', '#5f6d5d'),
    right: zone('#dfe5f3', '#e8eefc', '#f2f6ff', '#dbe1ef', '#cad1de', '#acb3c0', '#616672'),
    bar: zone('#ebe6cb', '#f4efd4', '#fcf7dc', '#e7e2c7', '#d6d1b7', '#b8b39a', '#6b6650'),
  },
};

/**
 * Saffron: bhagwa, warm and dark. Deep saffron-brown surfaces; the header a burnt saffron deepening to
 * turmeric-brown; the band kesar red, saffron and turmeric; the next thing to do in saffron, headings in it
 * too, and marks in the cream of a sadhu's cloth. Its zones (Session 44) run through the warm colours: the
 * left column saffron, the middle kesar red, the right column turmeric and the layer bar the olive of neem
 * leaves; the title strips saffron into turmeric, a lit layer button saffron and an unlit one's edge
 * turmeric. Its warning is a clear yellow, never taken for the saffron.
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
    'header-2': '#8f4c08',
    strip: '#4b1e00',
    'strip-2': '#3a2900',
    layer: '#3c1d00',
    'layer-edge': '#c1a04c',
    band: ['#d8431c', '#f7923a', '#ffd166', '#f7923a', '#d8431c'],
  },
  zones: {
    left: zone('#1a0800', '#230d00', '#2e1604', '#3b220f', '#442917', '#5b3e2b', '#c09f89'),
    middle: zone('#220203', '#2a0608', '#351011', '#431c1c', '#4b2423', '#623937', '#cb9996'),
    right: zone('#130b00', '#1a1200', '#241b04', '#30260f', '#382e17', '#4d432b', '#b0a489'),
    bar: zone('#0a0e00', '#111501', '#191e08', '#252a13', '#2c311a', '#41472f', '#a1a98d'),
  },
};

/**
 * Peacock: deep teal surfaces; the header the deep blue-green of its neck; the band the feather's eye, royal
 * blue, teal, green and gold; the next thing to do in the peacock's teal, marks in a light sky blue and
 * headings in a pale teal. Its zones (Session 44), the feather's colours: the left column teal, the middle
 * royal blue, the right column green and the layer bar its violet sheen; the title strips teal into blue, a
 * lit layer button royal blue and an unlit one's edge the eye's gold. Its success is a lime green, apart from
 * the teal.
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
    'header-2': '#0a5550',
    strip: '#003838',
    'strip-2': '#153153',
    layer: '#04244a',
    'layer-edge': '#cba553',
    band: ['#1f4fbf', '#16b3ac', '#3fa34d', '#e0b13a'],
  },
  zones: {
    left: zone('#001415', '#001c1d', '#0a2727', '#173434', '#203d3d', '#375555', '#8aaaa9'),
    middle: zone('#040c28', '#081330', '#101c3a', '#1b2948', '#233150', '#364567', '#8091b7'),
    right: zone('#001204', '#031908', '#0b2211', '#172e1c', '#1f3624', '#334b38', '#7c9881'),
    bar: zone('#13062b', '#190d32', '#22173c', '#2e234a', '#362b52', '#4a3f69', '#958bba'),
  },
};

/**
 * Midnight Blue: the night sky. Deep navy surfaces and an indigo header deepening to violet; the band night
 * blue, sky blue, starlight and a star's gold; the next thing to do in a clear sky blue, marks in starlight
 * and headings in a pale blue. Its zones (Session 44), the night from dusk to its darkest: the left column
 * navy, the middle indigo, the right column a slate teal and the layer bar a deep violet; the title strips
 * navy into indigo, a lit layer button indigo and an unlit one's edge a star's gold.
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
    'header-2': '#2a1b6e',
    strip: '#112c4e',
    'strip-2': '#2b264e',
    layer: '#201f4b',
    'layer-edge': '#d5b36a',
    band: ['#2a3f99', '#5aa2ff', '#c9d6ff', '#ffd27a'],
  },
  zones: {
    left: zone('#000c21', '#031329', '#0a1c33', '#162940', '#1e3048', '#32455f', '#788eaa'),
    middle: zone('#0e052a', '#140c32', '#1d163c', '#28224a', '#2f2a52', '#433f69', '#8a88b7'),
    right: zone('#000f15', '#00171f', '#072129', '#142e36', '#1d363f', '#324c55', '#7c99a2'),
    bar: zone('#1b021f', '#230728', '#2d1031', '#3a1d3e', '#422447', '#58395d', '#a381a8'),
  },
};

/**
 * Sandalwood: light and warm, the colour of chandan. The header in chandan paste turning to a soft peach, its
 * words in dark wood; the band the tilak's kumkum, chandan and haldi; the next thing to do in a deep blue-
 * green, marks in a deep blue and headings in deep teal. Its zones (Session 44): the left column chandan, the
 * middle haldi, the right column a pale tulsi green and the layer bar a pale river blue; the title strips
 * chandan into haldi, a lit layer button river blue and an unlit one's edge a deeper blue.
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
    'header-2': '#f5c2a2',
    strip: '#f6d8bc',
    'strip-2': '#e9dfb2',
    layer: '#c0e6eb',
    'layer-edge': '#2a7f88',
    band: ['#c81d25', '#f1dcb4', '#e8a317', '#f1dcb4', '#c81d25'],
  },
  zones: {
    left: zone('#f0decd', '#feecdb', '#fff6ed', '#e8d6c5', '#dfcebd', '#c2b0a0', '#736355'),
    middle: zone('#ede7c9', '#fbf5d6', '#fffdf1', '#e5dec0', '#dcd6b8', '#beb89b', '#6e694e'),
    right: zone('#d6e5d3', '#e3f3e0', '#ecfce8', '#cdddca', '#c5d5c2', '#a9b7a5', '#5c6a59'),
    bar: zone('#cde4e8', '#daf2f6', '#e3fafe', '#c5dce0', '#bdd4d8', '#a0b6bb', '#55696d'),
  },
};

/**
 * Lotus: light, the lotus's soft pink. The header the deep pink of its heart deepening to magenta; the band
 * petal pink, blush, the leaf's green and the pollen's gold; the next thing to do in deep pink, headings in
 * it too, and marks in the blue of the water. Its zones (Session 44): the left column petal pink, the middle
 * a lilac, the right column the leaf's green and the layer bar the water's blue; the title strips pink into
 * lilac, a lit layer button leaf green and an unlit one's edge the water's blue.
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
    'header-2': '#7a1d6a',
    strip: '#fad1e0',
    'strip-2': '#ebd5f5',
    layer: '#c8e8cd',
    'layer-edge': '#1f6a96',
    band: ['#e86a9a', '#f8c8d8', '#3c9a5f', '#f2d16b'],
  },
  zones: {
    left: zone('#f3dae2', '#ffeaf1', '#fff5f8', '#ead1d9', '#e2c9d1', '#c4acb4', '#755f67'),
    middle: zone('#eee0f4', '#faf1ff', '#fefcff', '#e5d8eb', '#ddcfe3', '#beb1c4', '#6f6375'),
    right: zone('#d2e6d5', '#e1f5e4', '#e9fdec', '#c9ddcc', '#c1d5c4', '#a4b7a7', '#59695b'),
    bar: zone('#d0e3ee', '#dff2fd', '#eef9ff', '#c8dae5', '#c0d2de', '#a3b5bf', '#576771'),
  },
};

/**
 * Marble: light, the mandir's cool white marble, faintly veined blue. The header a slate navy turning blue;
 * the band the kalash's gold, marble white and navy; the next thing to do in a deep navy, marks and headings
 * in blues of it. Its zones (Session 44): the left column the marble's blue, the middle a lilac grey, the
 * right column the kalash's gold and the layer bar a pale teal; the title strips blue into lilac, a lit layer
 * button gold and an unlit one's edge navy.
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
    'header-2': '#2c3e6b',
    strip: '#cbe1f8',
    'strip-2': '#dcdbf8',
    layer: '#ebddb9',
    'layer-edge': '#486491',
    band: ['#c9a227', '#ffffff', '#1b3566', '#ffffff', '#c9a227'],
  },
  zones: {
    left: zone('#d5e2f1', '#e2f0fe', '#eff7ff', '#ccdae9', '#c4d2e0', '#a7b5c3', '#5b6774'),
    middle: zone('#e6e5f8', '#f4f4ff', '#fdfdff', '#ddddef', '#d5d4e7', '#b7b6c8', '#686778'),
    right: zone('#eae1cc', '#f7efd9', '#fff7e1', '#e1d9c3', '#d8d1bb', '#bbb39f', '#6d6553'),
    bar: zone('#d1e4e7', '#dff2f5', '#e7fafd', '#c9dcdf', '#c1d4d7', '#a4b6b9', '#58686b'),
  },
};

/**
 * Tulsi: dark, the tulsi plant's deep green. The header its darkest leaf turning teal; the band green leaves,
 * Krishna tulsi's purple and the ivory of its flowers; the next thing to do in ivory, marks and headings in
 * that purple, lightened. Its zones (Session 44): the left column the leaf's green, the middle the stem's
 * olive, the right column a teal green and the layer bar Krishna tulsi's purple; the title strips green into
 * olive, a lit layer button purple and an unlit one's edge lavender.
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
    'header-2': '#1a4a42',
    strip: '#073316',
    'strip-2': '#2a2e04',
    layer: '#301a46',
    'layer-edge': '#b2a0d6',
    band: ['#2e7d4f', '#7a4fb0', '#f6efd6', '#7a4fb0', '#2e7d4f'],
  },
  zones: {
    left: zone('#001204', '#031909', '#0b2211', '#182f1d', '#1f3624', '#334b38', '#79947d'),
    middle: zone('#0d0f00', '#141602', '#1d1f08', '#292c15', '#30331b', '#45482f', '#8b9074'),
    right: zone('#00120f', '#001a17', '#082420', '#16312d', '#1e3935', '#334f4a', '#7c9b95'),
    bar: zone('#170527', '#1e0b30', '#27153a', '#342247', '#3b2950', '#503e66', '#9985b2'),
  },
};

/**
 * Diwali: the festival of lights at night (Session 42). Deep plum night surfaces and a plum header deepening
 * to indigo, the header's name in a diya's gold; the band marigold, diya gold and rangoli pink; the next
 * thing to do in marigold, marks and headings in lamplit lavender. Its zones (Session 44): the left column
 * plum, the middle the night's indigo, the right column rangoli rose and the layer bar a lamp's amber; the
 * title strips plum into rose, a lit layer button amber and an unlit one's edge diya gold. Its warning is a
 * clear lemon and its danger a rose, apart from the marigold. Ideas: the design skills' palette from the
 * subject's own things, and 21st.dev's Cosmic Indigo and Honey Glow Gold themes (colours only).
 */
export const DIWALI: Appearance = {
  id: 'diwali',
  name: 'Diwali',
  base: 'dark',
  colours: {
    ink: '#1b011a',
    panel: '#220820',
    'panel-2': '#2c112a',
    'panel-3': '#3a1c37',
    line: '#41243f',
    'line-strong': '#573954',
    field: '#9e829b',
    fg: '#fcf4fb',
    muted: '#dbccd9',
    faint: '#b9a7b7',
    accent: '#d9c4ff',
    'primary-hi': '#ff9a3c',
    primary: '#ff8c26',
    'primary-lo': '#f27c12',
    'on-primary': '#1e0c00',
    'primary-edge': '#ff9433',
    ...DARK_STATES,
    warning: '#fff176',
    'warning-bg': '#33300a',
    'warning-fg': '#fff3a6',
    danger: '#ff8fb8',
    'danger-fg': '#ffc2d8',
  },
  decoration: {
    header: '#4a1446',
    'on-header': '#ffd98a',
    'on-header-muted': '#f6e3c8',
    'header-ring': '#ffd98a',
    'header-field': '#f6e3c8',
    second: '#d9c4ff',
    heading: '#e2cfff',
    'header-2': '#2e1650',
    strip: '#441d41',
    'strip-2': '#4d1a2b',
    layer: '#3b1c04',
    'layer-edge': '#deb95c',
    band: ['#ff8f1f', '#ffc23d', '#e83e8c', '#ffc23d', '#ff8f1f'],
  },
  zones: {
    left: zone('#1c001b', '#240523', '#2e0e2d', '#3c1a39', '#432241', '#5a3657', '#a67ea1'),
    middle: zone('#0d0428', '#130c30', '#1c153b', '#272149', '#2d2950', '#423e67', '#8886b5'),
    right: zone('#20000a', '#2b0212', '#360b1b', '#441726', '#4c1f2e', '#643442', '#b27c8a'),
    bar: zone('#180600', '#220c00', '#2d1503', '#3a200e', '#422815', '#593c29', '#a5846f'),
  },
};

/**
 * Holi: the festival of colours (Session 42). Light, a pale aqua like water after the colours; the header a
 * deep turquoise turning blue; the band five gulal colours, magenta, yellow, green, turquoise and orange; the
 * next thing to do in gulal magenta, headings in it too, and marks in a deep blue. Its zones (Session 44),
 * gulal everywhere: the left column aqua, the middle pink, the right column yellow and the layer bar green;
 * the title strips yellow into green, a lit layer button pink and an unlit one's edge magenta. Ideas: the
 * design skills, and 21st.dev's Neon Magenta theme (its magenta with cyan and yellow; colours only).
 */
export const HOLI: Appearance = {
  id: 'holi',
  name: 'Holi',
  base: 'light',
  colours: {
    ink: '#c8eff1',
    panel: '#e0fbfc',
    'panel-2': '#f5ffff',
    'panel-3': '#bde7e9',
    line: '#b8dee0',
    'line-strong': '#9ac0c1',
    field: '#4d7072',
    fg: '#0d1516',
    muted: '#314445',
    faint: '#476061',
    accent: '#1b46a3',
    'primary-hi': '#a3127a',
    primary: '#a1136f',
    'primary-lo': '#880e5d',
    'on-primary': '#ffffff',
    'primary-edge': '#a1136f',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#0b5f73',
    'on-header': '#f2fdff',
    'on-header-muted': '#c8eef5',
    'header-ring': '#f2fdff',
    'header-field': '#c8eef5',
    second: '#1b46a3',
    heading: '#a1136f',
    'header-2': '#174f86',
    strip: '#e8e0aa',
    'strip-2': '#c6e9c6',
    layer: '#f4d4e2',
    'layer-edge': '#9e366f',
    band: ['#e0218a', '#ffd23f', '#2fb344', '#12b5c6', '#ff7a1a'],
  },
  zones: {
    left: zone('#c8eff1', '#d7fdff', '#f5ffff', '#c0e7e8', '#b8dee0', '#9ac0c1', '#4d7072'),
    middle: zone('#f3dae5', '#ffe9f2', '#fff2f7', '#ead2dc', '#e2cad4', '#c4adb7', '#75616a'),
    right: zone('#eee9c3', '#fdf7d0', '#fffef3', '#e6e1bb', '#ded8b2', '#c0ba95', '#706a49'),
    bar: zone('#d7eed6', '#e5fce4', '#f8fff7', '#cee6ce', '#c6dec6', '#a9bfa8', '#5b6f5b'),
  },
};

/**
 * Aarti: the lamp offered at the end of a sabha (Session 42). Light, the warm gold of ghee light on brass;
 * the header deep brass turning to the flame's brown, its name in cream; the band kumkum crimson, gold and
 * the flame; the next thing to do in a deep crimson, kept well apart from LIVE's red for everyone, with marks
 * and headings in it too. Its zones (Session 44): the left column ghee gold, the middle the flame's peach,
 * the right column kumkum rose and the layer bar polished brass; the title strips gold into flame, a lit
 * layer button gold and an unlit one's edge the evening's blue. Ideas: the design skills, and 21st.dev's Red
 * Dark theme (a crimson with a gold beside it; colours only).
 */
export const AARTI: Appearance = {
  id: 'aarti',
  name: 'Aarti',
  base: 'light',
  colours: {
    ink: '#f7e4bd',
    panel: '#fff3db',
    'panel-2': '#fffcf6',
    'panel-3': '#f1dcb1',
    line: '#e7d4ad',
    'line-strong': '#c8b590',
    field: '#766747',
    fg: '#16130e',
    muted: '#463f31',
    faint: '#635a48',
    accent: '#2f4f8f',
    'primary-hi': '#8a1a42',
    primary: '#7a1238',
    'primary-lo': '#650c2d',
    'on-primary': '#ffffff',
    'primary-edge': '#7a1238',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#7a4f08',
    'on-header': '#fff3d1',
    'on-header-muted': '#ffe2a0',
    'header-ring': '#fff3d1',
    'header-field': '#ffe2a0',
    second: '#6a1035',
    heading: '#7a1238',
    'header-2': '#7a3a10',
    strip: '#f0dcb1',
    'strip-2': '#fbd5c1',
    layer: '#f0dcb1',
    'layer-edge': '#43629c',
    band: ['#b3122e', '#e0a526', '#f26b1d', '#e0a526', '#b3122e'],
  },
  zones: {
    left: zone('#f2e5c8', '#fff3db', '#fffcf6', '#ebddc1', '#e2d5b9', '#c3b69a', '#74674f'),
    middle: zone('#f3ddd0', '#ffebe0', '#fff5ef', '#ebd5c8', '#e3cdc1', '#c4afa3', '#766258'),
    right: zone('#f1dbdb', '#ffe9e9', '#fff3f3', '#ead3d4', '#e1cbcc', '#c3adae', '#746162'),
    bar: zone('#e4e9ce', '#f2f7dc', '#fbffe5', '#dce1c7', '#d4d9bf', '#b5baa0', '#676a54'),
  },
};

/**
 * Monsoon (Session 44): the rains. Dark slate-blue surfaces; the header a storm's indigo turning to rain
 * teal; the band slate, rain teal, wet leaves' green and lightning's yellow; the next thing to do in a
 * cloud's white-blue, marks in rain teal and headings in a pale tint of it. Its zones: the left column slate
 * blue, the middle rain teal, the right column the leaves' green and the layer bar the storm's indigo; the
 * title strips slate into teal, a lit layer button teal and an unlit one's edge lightning yellow. Ideas: the
 * design skills, and 21st.dev's Ocean Breeze and Aurora Circuit themes (colours only).
 */
export const MONSOON: Appearance = {
  id: 'monsoon',
  name: 'Monsoon',
  base: 'dark',
  colours: {
    ink: '#010d16',
    panel: '#04151e',
    'panel-2': '#0d1e28',
    'panel-3': '#172933',
    line: '#1f303b',
    'line-strong': '#344752',
    field: '#758996',
    fg: '#f1f8fd',
    muted: '#c5d3dc',
    faint: '#a2b0b9',
    accent: '#8fd3ff',
    'primary-hi': '#d7e7ff',
    primary: '#c4dcff',
    'primary-lo': '#b6cdf0',
    'on-primary': '#080e16',
    'primary-edge': '#d7e7ff',
    ...DARK_STATES,
  },
  decoration: {
    header: '#23306b',
    'on-header': '#f4f7ff',
    'on-header-muted': '#cdd7f3',
    'header-ring': '#f4f7ff',
    'header-field': '#cdd7f3',
    second: '#5fd6c8',
    heading: '#a8e8e0',
    'header-2': '#0f4d5c',
    strip: '#0d2e48',
    'strip-2': '#003234',
    layer: '#002a2c',
    'layer-edge': '#ddcc6b',
    band: ['#4a6fa5', '#2fb3a6', '#5fbf5f', '#ffe66d'],
  },
  zones: {
    left: zone('#000c1b', '#031424', '#0a1d2d', '#152839', '#1c2f40', '#324658', '#72899d'),
    middle: zone('#000f11', '#00181a', '#052224', '#102d2f', '#183537', '#304d4f', '#749395'),
    right: zone('#000f04', '#001709', '#062111', '#112c1c', '#193323', '#2f4a39', '#708e79'),
    bar: zone('#090725', '#100f2e', '#181838', '#222344', '#292b4c', '#3f4165', '#7f84ab'),
  },
};

/**
 * Sandhya (Session 44): the evening sky. Dark violet surfaces; the header a rose glow turning to the last
 * amber light; the band indigo, violet, rose, coral and amber; the next thing to do in a soft lilac, marks in
 * an evening blue and headings in a pale rose. Its zones: the left column indigo, the middle violet, the
 * right column rose and the layer bar a dusk blue; the title strips violet into rose, a lit layer button dusk
 * blue and an unlit one's edge amber. Ideas: the design skills, and 21st.dev's Sunset Horizon theme (its
 * coral and peach; colours only).
 */
export const SANDHYA: Appearance = {
  id: 'sandhya',
  name: 'Sandhya',
  base: 'dark',
  colours: {
    ink: '#0f051d',
    panel: '#160c25',
    'panel-2': '#1f162f',
    'panel-3': '#2a203b',
    line: '#322843',
    'line-strong': '#483e5b',
    field: '#898296',
    fg: '#f8f5fd',
    muted: '#d3cedd',
    faint: '#b0abb9',
    accent: '#ffc2d6',
    'primary-hi': '#dfd1ff',
    primary: '#d6c2ff',
    'primary-lo': '#c7b4f0',
    'on-primary': '#0e0b15',
    'primary-edge': '#dfd1ff',
    ...DARK_STATES,
  },
  decoration: {
    header: '#7a1f4f',
    'on-header': '#fff3f8',
    'on-header-muted': '#eecdda',
    'header-ring': '#fff3f8',
    'header-field': '#eecdda',
    second: '#9fd0ff',
    heading: '#ffd0e0',
    'header-2': '#8a3d14',
    strip: '#3a204b',
    'strip-2': '#481a37',
    layer: '#032645',
    'layer-edge': '#e9c67d',
    band: ['#3b2a8f', '#7a3fb8', '#e05a8a', '#ff8a5c', '#ffc04d'],
  },
  zones: {
    left: zone('#080428', '#0e0b30', '#16163b', '#202047', '#272950', '#3d3f69', '#7e82b0'),
    middle: zone('#150121', '#1c072a', '#261135', '#311b40', '#392349', '#503961', '#947ca7'),
    right: zone('#1c0012', '#26031a', '#320c24', '#3e162f', '#471f37', '#5f354e', '#a87792'),
    bar: zone('#000a1b', '#001126', '#061b31', '#10263c', '#182e45', '#2d445c', '#6e88a2'),
  },
};

/**
 * Forest (Session 44): a forest floor. Dark green surfaces; the header the bark's brown turning to the
 * forest's green; the band pine, moss, bark and the copper of fallen leaves; the next thing to do in a fresh
 * moss, marks in the sky's blue through the leaves and headings in a pale green. Its zones: the left column
 * forest green, the middle a pine teal, the right column bark and the layer bar moss; the title strips green
 * into moss, a lit layer button bark and an unlit one's edge the sky's blue. Ideas: the design skills, and
 * 21st.dev's Forest Copper theme (colours only).
 */
export const FOREST: Appearance = {
  id: 'forest',
  name: 'Forest',
  base: 'dark',
  colours: {
    ink: '#080e01',
    panel: '#0f1504',
    'panel-2': '#181f0c',
    'panel-3': '#222916',
    line: '#2a311d',
    'line-strong': '#3f4733',
    field: '#828a76',
    fg: '#f5f8f1',
    muted: '#ced3c5',
    faint: '#abb0a3',
    accent: '#9fe0c0',
    'primary-hi': '#d3f2ab',
    primary: '#c8e6a0',
    'primary-lo': '#bad792',
    'on-primary': '#0b0f06',
    'primary-edge': '#d3f2ab',
    ...DARK_STATES,
  },
  decoration: {
    header: '#4a2f17',
    'on-header': '#fff5ed',
    'on-header-muted': '#ecd2be',
    'header-ring': '#fff5ed',
    'header-field': '#ecd2be',
    second: '#9fd0ff',
    heading: '#cfe8b0',
    'header-2': '#173f2a',
    strip: '#10321a',
    'strip-2': '#282f08',
    layer: '#371f0a',
    'layer-edge': '#7cced2',
    band: ['#2e6b4f', '#8db348', '#8a5a32', '#d9874a'],
  },
  zones: {
    left: zone('#000f03', '#021707', '#0a2110', '#142b19', '#1c3321', '#314936', '#738e77'),
    middle: zone('#00100e', '#001816', '#06231f', '#112d2a', '#1a3633', '#314d4a', '#769590'),
    right: zone('#180800', '#200e02', '#2b1808', '#362212', '#3e2a1a', '#553f2f', '#9a8370'),
    bar: zone('#0a0d00', '#101401', '#191e08', '#232911', '#2b3019', '#40472e', '#838b70'),
  },
};

/**
 * Navratri (Session 44): nine nights of garba. Near-black surfaces with a trace of magenta; the header a
 * chaniya choli's magenta turning royal blue; the band magenta, orange, yellow, green and blue; the next
 * thing to do in a bright turquoise, marks in a pale pink and headings in a pale yellow. Its zones: the left
 * column magenta, the middle royal blue, the right column green and the layer bar orange; the title strips
 * magenta into violet, a lit layer button royal blue and an unlit one's edge yellow. Its success is a lime
 * green, apart from the turquoise.
 */
export const NAVRATRI: Appearance = {
  id: 'navratri',
  name: 'Navratri',
  base: 'dark',
  colours: {
    ink: '#160510',
    panel: '#1e0b18',
    'panel-2': '#281422',
    'panel-3': '#341f2d',
    line: '#3b2634',
    'line-strong': '#533b4a',
    field: '#937f8c',
    fg: '#fcf4f9',
    muted: '#dbccd5',
    faint: '#b7a9b2',
    accent: '#ffd36b',
    'primary-hi': '#4fe2f4',
    primary: '#3fd6e8',
    'primary-lo': '#27c7d9',
    'on-primary': '#031012',
    'primary-edge': '#4fe2f4',
    ...DARK_STATES,
    success: '#a5d64c',
    'success-bg': '#1d2b0b',
    'success-fg': '#d6f2a6',
  },
  decoration: {
    header: '#910080',
    'on-header': '#fef3fb',
    'on-header-muted': '#e9cee2',
    'header-ring': '#fef3fb',
    'header-field': '#e9cee2',
    second: '#ffd0e8',
    heading: '#fff0a8',
    'header-2': '#1d2a8a',
    strip: '#4c1738',
    'strip-2': '#362154',
    layer: '#11224b',
    'layer-edge': '#e3ca69',
    band: ['#e0218a', '#ff8a1f', '#ffd23f', '#2fb344', '#2a5bd7'],
  },
  zones: {
    left: zone('#1d0012', '#27031b', '#320b24', '#3f1730', '#471e37', '#5f344d', '#a77791'),
    middle: zone('#010728', '#040e31', '#0b183b', '#152448', '#1c2b50', '#304168', '#7085b0'),
    right: zone('#000d02', '#011506', '#081f0e', '#132a18', '#1a311f', '#2f4734', '#718c75'),
    bar: zone('#190500', '#230a00', '#2e1304', '#3a1e0e', '#412515', '#593b2b', '#9f7e6b'),
  },
};

/**
 * Neel (Session 44): indigo-dyed cloth with a block print. Deep indigo surfaces; the header the madder's
 * brown turning to indigo; the band indigo, the cloth's cream, madder red and mustard; the next thing to do
 * in the cloth's warm cream, marks in a pale teal and headings in a pale indigo. Its zones: the left column
 * indigo, the middle madder, the right column mustard and the layer bar a teal; the title strips indigo into
 * blue, a lit layer button indigo and an unlit one's edge mustard.
 */
export const NEEL: Appearance = {
  id: 'neel',
  name: 'Neel',
  base: 'dark',
  colours: {
    ink: '#060820',
    panel: '#0d1028',
    'panel-2': '#151933',
    'panel-3': '#1f243f',
    line: '#262c47',
    'line-strong': '#3c425f',
    field: '#818599',
    fg: '#f5f6fe',
    muted: '#cdd0df',
    faint: '#aaadbb',
    accent: '#a9c8ff',
    'primary-hi': '#fff6e9',
    primary: '#ffe8c8',
    'primary-lo': '#f0d9ba',
    'on-primary': '#120c04',
    'primary-edge': '#fff6e9',
    ...DARK_STATES,
  },
  decoration: {
    header: '#4a1a14',
    'on-header': '#fff4f2',
    'on-header-muted': '#f1cec8',
    'header-ring': '#fff4f2',
    'header-field': '#f1cec8',
    second: '#7fd6d0',
    heading: '#c3c8ff',
    'header-2': '#1f2470',
    strip: '#22275a',
    'strip-2': '#0a2d4d',
    layer: '#1b1f51',
    'layer-edge': '#d7bb70',
    band: ['#2e3a9a', '#f3ead2', '#b8432f', '#d9a62e', '#2e3a9a'],
  },
  zones: {
    left: zone('#06042d', '#0c0c36', '#131640', '#1d214d', '#242956', '#38406f', '#7983b8'),
    middle: zone('#1f0101', '#290504', '#330f0c', '#401a16', '#49221e', '#623833', '#a97b74'),
    right: zone('#0f0900', '#191100', '#221a03', '#2d250d', '#352c15', '#4c422a', '#8f866b'),
    bar: zone('#000e10', '#001718', '#032122', '#0f2c2e', '#173436', '#2f4c4e', '#739394'),
  },
};

/**
 * Ratna (Session 44): jewels on black velvet. Near-black surfaces; the header an emerald turning sapphire;
 * the band emerald, sapphire, ruby, topaz and pearl; the next thing to do in aquamarine, marks in a pale pink
 * and headings in a pale mint. Its zones: the left column sapphire, the middle emerald, the right column ruby
 * and the layer bar topaz; the title strips ruby into amethyst, a lit layer button emerald and an unlit one's
 * edge topaz gold.
 */
export const RATNA: Appearance = {
  id: 'ratna',
  name: 'Ratna',
  base: 'dark',
  colours: {
    ink: '#0e0718',
    panel: '#150f20',
    'panel-2': '#1e182a',
    'panel-3': '#292335',
    line: '#302a3d',
    'line-strong': '#464054',
    field: '#898296',
    fg: '#f8f5fd',
    muted: '#d3cedd',
    faint: '#b0abb9',
    accent: '#a8e6d0',
    'primary-hi': '#b3fcec',
    primary: '#a8f0e0',
    'primary-lo': '#99e1d1',
    'on-primary': '#04100d',
    'primary-edge': '#b3fcec',
    ...DARK_STATES,
  },
  decoration: {
    header: '#0f4a35',
    'on-header': '#eefaf4',
    'on-header-muted': '#c0e0d1',
    'header-ring': '#eefaf4',
    'header-field': '#c0e0d1',
    second: '#ffd0e8',
    heading: '#9ff0c8',
    'header-2': '#13306e',
    strip: '#4d1929',
    'strip-2': '#38224e',
    layer: '#032b16',
    'layer-edge': '#e9c67d',
    band: ['#1f8a5a', '#2a4fb8', '#b8143a', '#e8b84a', '#f4efe6'],
  },
  zones: {
    left: zone('#010628', '#040f32', '#0b193c', '#152449', '#1c2b50', '#314269', '#7186b1'),
    middle: zone('#000d04', '#001608', '#02200f', '#0d2b19', '#143320', '#2b4936', '#6c8d76'),
    right: zone('#1f0008', '#2b0210', '#360b19', '#431723', '#4b1e2b', '#643440', '#ad7782'),
    bar: zone('#140700', '#1f0d00', '#2a1603', '#35220d', '#3d2814', '#543f2a', '#998169'),
  },
};

/**
 * Prabhat (Session 44): first light. Light, warm rose-peach surfaces; the header a rose-brown dawn turning
 * gold; the band rose, peach, the sun's gold and the morning sky; the next thing to do in a deep blue-green,
 * marks in a deep blue and headings in deep teal. Its zones: the left column peach, the middle rose, the
 * right column the morning sky and the layer bar the sun's gold; the title strips peach into gold, a lit
 * layer button sky blue and an unlit one's edge a deeper blue. Ideas: the design skills' colors.csv (a sky
 * blue with the sun's amber).
 */
export const PRABHAT: Appearance = {
  id: 'prabhat',
  name: 'Prabhat',
  base: 'light',
  colours: {
    ink: '#f7e0df',
    panel: '#fff2f2',
    'panel-2': '#fffcfc',
    'panel-3': '#edd6d5',
    line: '#e6d0cf',
    'line-strong': '#c7b1b1',
    field: '#776363',
    fg: '#181212',
    muted: '#4a3c3b',
    faint: '#665756',
    accent: '#1d4ed8',
    'primary-hi': '#1d6485',
    primary: '#0e5a7a',
    'primary-lo': '#004d6b',
    'on-primary': '#ffffff',
    'primary-edge': '#1d6485',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#8d453b',
    'on-header': '#fff4f2',
    'on-header-muted': '#f3d0ca',
    'header-ring': '#fff4f2',
    'header-field': '#f3d0ca',
    second: '#1f4f8a',
    heading: '#0f5f7a',
    'header-2': '#8f4a12',
    strip: '#fbd5c1',
    'strip-2': '#edddb1',
    layer: '#c5e3f5',
    'layer-edge': '#136b94',
    band: ['#e8708a', '#ffb38a', '#ffd166', '#7fc4f0'],
  },
  zones: {
    left: zone('#f3ddd0', '#ffeee4', '#fff7f2', '#ead3c7', '#e3cdc1', '#c4afa3', '#756157'),
    middle: zone('#f2dcde', '#ffedef', '#fff7f7', '#e9d2d5', '#e2ccce', '#c3aeb0', '#746164'),
    right: zone('#d2e4ef', '#e1f4ff', '#f1faff', '#c8dae5', '#c2d4df', '#a4b6c0', '#586872'),
    bar: zone('#efe5c8', '#fff5d8', '#fffdf6', '#e5dbbe', '#dfd5b8', '#c0b69a', '#70674d'),
  },
};

/**
 * Mehndi (Session 44): henna on the hands. Light, olive-cream surfaces; the header the paste's olive turning
 * to the stain's terracotta; the band olive, henna, cream and terracotta; the next thing to do in a deep
 * blue-green, marks in a deep blue and headings in deep teal, so the henna's browns stay in the decoration,
 * apart from LIVE's red for everyone. Its zones: the left column olive, the middle terracotta, the right
 * column sage and the layer bar cream; the title strips olive into cream, a lit layer button terracotta and
 * an unlit one's edge blue. Ideas: the design skills' colors.csv (a warm terracotta with a fresh green).
 */
export const MEHNDI: Appearance = {
  id: 'mehndi',
  name: 'Mehndi',
  base: 'light',
  colours: {
    ink: '#e4ead0',
    panel: '#f4f8e6',
    'panel-2': '#fcfef5',
    'panel-3': '#dae0c6',
    line: '#d3d9c0',
    'line-strong': '#b5bba2',
    field: '#676c58',
    fg: '#13140f',
    muted: '#3f4135',
    faint: '#5a5d50',
    accent: '#1d4ed8',
    'primary-hi': '#1d6485',
    primary: '#0e5a7a',
    'primary-lo': '#004d6b',
    'on-primary': '#ffffff',
    'primary-edge': '#1d6485',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#3f4a12',
    'on-header': '#f5f8ed',
    'on-header-muted': '#d4dcbf',
    'header-ring': '#f5f8ed',
    'header-field': '#d4dcbf',
    second: '#1f4f8a',
    heading: '#0f5f7a',
    'header-2': '#6e2f14',
    strip: '#e0e2b5',
    'strip-2': '#f3dab2',
    layer: '#f6d6c9',
    'layer-edge': '#006789',
    band: ['#6b7a2a', '#9a4a2a', '#f3e7c9', '#c0613a'],
  },
  zones: {
    left: zone('#e8eacb', '#f7f9da', '#fdffe7', '#dee0c1', '#d7d9bb', '#b9bb9d', '#6a6b51'),
    middle: zone('#f6dfd4', '#ffefe7', '#fff7f3', '#ecd5ca', '#e5cec3', '#c7b1a7', '#78635b'),
    right: zone('#d0eee2', '#defdf1', '#f7fffc', '#c6e4d8', '#bfddd1', '#a2bfb3', '#556f66'),
    bar: zone('#f6e5ca', '#fff5e3', '#fffdf8', '#ecdbc0', '#e5d4ba', '#c6b79d', '#766750'),
  },
};

/**
 * Haldi (Session 44): the turmeric ceremony. Light, bright cream-yellow surfaces; the header turmeric turning
 * to a light marigold, its words in dark brown; the band turmeric, marigold, mango leaves and white; the next
 * thing to do in a deep plum, the yellow's opposite, marks in a deep blue and headings in deep teal. Its
 * zones: the left column mango-leaf green, the middle turmeric, the right column rose petals and the layer
 * bar marigold; the title strips turmeric into marigold, a lit layer button green and an unlit one's edge
 * blue. Its warning is a deeper amber, to read on the yellow header.
 */
export const HALDI: Appearance = {
  id: 'haldi',
  name: 'Haldi',
  base: 'light',
  colours: {
    ink: '#eee7c9',
    panel: '#fbf6e1',
    'panel-2': '#fffdf4',
    'panel-3': '#e4ddbf',
    line: '#ded6b9',
    'line-strong': '#bfb89b',
    field: '#6e6956',
    fg: '#15140f',
    muted: '#434034',
    faint: '#5e5b4e',
    accent: '#1d4ed8',
    'primary-hi': '#642579',
    primary: '#5a1a6e',
    'primary-lo': '#4d0961',
    'on-primary': '#ffffff',
    'primary-edge': '#642579',
    ...LIGHT_STATES,
    warning: '#9a4a00',
    'warning-fg': '#5c3000',
  },
  decoration: {
    header: '#f5cf45',
    'on-header': '#1f1a09',
    'on-header-muted': '#352d15',
    'header-ring': '#1f1a09',
    'header-field': '#352d15',
    second: '#1f4f8a',
    heading: '#0f5f7a',
    'header-2': '#f7c25c',
    strip: '#eae0a2',
    'strip-2': '#fdd7ac',
    layer: '#cde7c7',
    'layer-edge': '#006789',
    band: ['#f2c230', '#ff9a1f', '#3a8f3a', '#ffffff'],
  },
  zones: {
    left: zone('#d8edd3', '#e7fce2', '#f8fff6', '#cee3ca', '#c7dcc3', '#aabea5', '#5c6d58'),
    middle: zone('#ede8c2', '#fdf7d0', '#fffef3', '#e3deb8', '#ddd7b1', '#beb994', '#6f6948'),
    right: zone('#f4dee0', '#ffeeef', '#fff7f7', '#ead4d6', '#e3cdcf', '#c5b0b2', '#756265'),
    bar: zone('#f8dec9', '#ffefe2', '#fff7f1', '#efd4c0', '#e7ceb9', '#c9b09c', '#796251'),
  },
};

/**
 * Himalaya (Session 44): snow and glacier ice. Light, icy blue-white surfaces; the header a glacier's blue
 * turning to ice green, its words in dark slate; the band glacier, snow, pine and the rock's slate; the next
 * thing to do in a deep blue-green, marks in deep teal and headings in slate. Its zones: the left column ice
 * blue, the middle a lilac snow shadow, the right column the pines' green and the layer bar a glacier teal;
 * the title strips ice blue into glacier teal, a lit layer button glacier teal and an unlit one's edge slate
 * blue.
 */
export const HIMALAYA: Appearance = {
  id: 'himalaya',
  name: 'Himalaya',
  base: 'light',
  colours: {
    ink: '#d6eaf4',
    panel: '#ebf8ff',
    'panel-2': '#fafdff',
    'panel-3': '#cce0ea',
    line: '#c6d9e3',
    'line-strong': '#a8bbc5',
    field: '#5b6c75',
    fg: '#0f1517',
    muted: '#354248',
    faint: '#505d64',
    accent: '#1d4ed8',
    'primary-hi': '#1d6485',
    primary: '#0e5a7a',
    'primary-lo': '#004d6b',
    'on-primary': '#ffffff',
    'primary-edge': '#1d6485',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#99d5ed',
    'on-header': '#091e25',
    'on-header-muted': '#15323d',
    'header-ring': '#091e25',
    'header-field': '#15323d',
    second: '#005873',
    heading: '#1f4a6a',
    'header-2': '#b4e0d8',
    strip: '#c4e4f4',
    'strip-2': '#c0e7e6',
    layer: '#c0e7e6',
    'layer-edge': '#386189',
    band: ['#8fd0ec', '#ffffff', '#2f6b52', '#5a6b80'],
  },
  zones: {
    left: zone('#d2e6f0', '#e1f5ff', '#effaff', '#c9dce6', '#c2d6df', '#a5b8c1', '#596a72'),
    middle: zone('#dfe3f1', '#eef2ff', '#f6f8ff', '#d5d9e7', '#ced2e0', '#b1b5c2', '#646773'),
    right: zone('#d3edde', '#e2fded', '#f6fff9', '#c9e3d4', '#c2ddcd', '#a5beaf', '#576e61'),
    bar: zone('#cceeed', '#dbfdfc', '#f3ffff', '#c2e4e3', '#bbdddc', '#9ebfbe', '#506f6e'),
  },
};

/**
 * Uttarayan (Session 44): a clear January sky full of kites. Light, sky-blue surfaces; the header a deep sky
 * turning teal; the band kite red, yellow, green, magenta and blue; the next thing to do in kite yellow with
 * a navy edge, marks and headings in deep teal. Its zones: the left column the sky, the middle the sun's
 * yellow, the right column a kite's rose and the layer bar green; the title strips sky into turquoise, a lit
 * layer button yellow and an unlit one's edge magenta. Ideas: the design skills' colors.csv (a sky blue with
 * the sun's amber).
 */
export const UTTARAYAN: Appearance = {
  id: 'uttarayan',
  name: 'Uttarayan',
  base: 'light',
  colours: {
    ink: '#dae9f2',
    panel: '#edf8fe',
    'panel-2': '#fafdff',
    'panel-3': '#d0dfe8',
    line: '#cad8e1',
    'line-strong': '#acbac3',
    field: '#5e6b73',
    fg: '#101518',
    muted: '#364249',
    faint: '#505d65',
    accent: '#1d4ed8',
    'primary-hi': '#ffe087',
    primary: '#ffd23f',
    'primary-lo': '#f0c328',
    'on-primary': '#100d04',
    'primary-edge': '#1a2a8c',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#0f4f8a',
    'on-header': '#f1f8ff',
    'on-header-muted': '#cbe1f9',
    'header-ring': '#f1f8ff',
    'header-field': '#cbe1f9',
    second: '#035974',
    heading: '#0f5f7a',
    'header-2': '#0f6b7a',
    strip: '#c5e3f5',
    'strip-2': '#b8e9eb',
    layer: '#eadeb2',
    'layer-edge': '#884783',
    band: ['#e8402a', '#ffd23f', '#2fb344', '#d6238a', '#2a6fd6'],
  },
  zones: {
    left: zone('#d3e6f1', '#e4f5ff', '#f1faff', '#c9dce7', '#c2d5e0', '#a6b8c2', '#596973'),
    middle: zone('#f1e7c1', '#fff7d6', '#fffdf3', '#e7ddb8', '#e0d6b1', '#c2b894', '#716947'),
    right: zone('#f3dde5', '#ffeef3', '#fff6f9', '#e8d4db', '#e1cdd4', '#c4b0b6', '#756269'),
    bar: zone('#d6edd5', '#e5fde5', '#f7fff6', '#cce3cb', '#c5ddc5', '#a7bea7', '#5a6e5a'),
  },
};

/**
 * Mogra (Session 44): a jasmine garland. Light, green-white surfaces; the header the leaves' deep green
 * turning teal; the band leaves, jasmine white, cream and a rose tied in; the next thing to do in a deep
 * rose, marks in a deep blue and headings in deep teal. Its zones: the left column the leaves' green, the
 * middle cream, the right column the rose and the layer bar a mint teal; the title strips green into mint, a
 * lit layer button rose and an unlit one's edge blue.
 */
export const MOGRA: Appearance = {
  id: 'mogra',
  name: 'Mogra',
  base: 'light',
  colours: {
    ink: '#deeade',
    panel: '#f0f8f0',
    'panel-2': '#fafefa',
    'panel-3': '#d5e0d4',
    line: '#cedace',
    'line-strong': '#b0bbb0',
    field: '#626c62',
    fg: '#111511',
    muted: '#394339',
    faint: '#545e54',
    accent: '#1d4ed8',
    'primary-hi': '#752554',
    primary: '#6a1a4a',
    'primary-lo': '#5c0a3e',
    'on-primary': '#ffffff',
    'primary-edge': '#752554',
    ...LIGHT_STATES,
  },
  decoration: {
    header: '#1f5a32',
    'on-header': '#f0faf2',
    'on-header-muted': '#c5dfca',
    'header-ring': '#f0faf2',
    'header-field': '#c5dfca',
    second: '#1f4f8a',
    heading: '#0f5f7a',
    'header-2': '#1a5a55',
    strip: '#cae7ca',
    'strip-2': '#bbe9df',
    layer: '#efd6df',
    'layer-edge': '#006789',
    band: ['#3a8f4a', '#ffffff', '#f3ecd0', '#d6457a'],
  },
  zones: {
    left: zone('#d8edd8', '#e7fce7', '#f8fff7', '#cee3ce', '#c8ddc8', '#aabeaa', '#5c6e5c'),
    middle: zone('#efe7c9', '#fef7d8', '#fffdf6', '#e5dec0', '#dfd7ba', '#c0b99c', '#70694f'),
    right: zone('#f3dee5', '#ffedf3', '#fff7f9', '#e8d4db', '#e2ced5', '#c4b0b6', '#756269'),
    bar: zone('#cdeee6', '#dcfdf5', '#f6fffd', '#c4e4dc', '#beded6', '#9fbfb7', '#526f69'),
  },
};

/** The built-in appearances, in the menu's order (after Follow the computer). */
export const BUILT_IN: readonly Appearance[] = [
  BLACK,
  WHITE,
  // Session 43 (Priyansh): the two with a meaning first, after White.
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
  // Session 44: twelve more, each a clearly different combination.
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
];

/**
 * Each colourful built-in appearance's zones as OKLCH hue, chroma and a factor of luminance (zones.ts): the colours
 * written out above are zonesOf(its colours, these), and src/main/contrast.test.ts checks they still are.
 */
export const ZONE_TINTS: Readonly<Record<string, Tints>> = {
  dhaja: { left: [18, 0.06], middle: [348, 0.06], right: [85, 0.04], bar: [50, 0.045] },
  tiranga: { left: [62, 0.03, 0.94], middle: [140, 0.03], right: [265, 0.02, 0.94], bar: [98, 0.035, 0.94] },
  saffron: { left: [55, 0.05], middle: [22, 0.06], right: [88, 0.04], bar: [120, 0.04] },
  peacock: { left: [195, 0.035, 1.3], middle: [265, 0.06], right: [150, 0.045], bar: [295, 0.07] },
  'midnight-blue': { left: [255, 0.05], middle: [287, 0.07], right: [220, 0.035, 1.12], bar: [322, 0.07] },
  sandalwood: {
    left: [65, 0.03, 0.95],
    middle: [97, 0.04],
    right: [140, 0.03, 0.95],
    bar: [210, 0.025, 0.94],
  },
  lotus: {
    left: [355, 0.03, 0.955],
    middle: [315, 0.03],
    right: [150, 0.03, 0.96],
    bar: [235, 0.025, 0.955],
  },
  marble: { left: [250, 0.025, 0.94], middle: [287, 0.025], right: [90, 0.03, 0.95], bar: [210, 0.02, 0.94] },
  tulsi: { left: [150, 0.045], middle: [115, 0.04], right: [182, 0.035, 1.12], bar: [305, 0.07] },
  diwali: { left: [330, 0.07], middle: [287, 0.07], right: [2, 0.07], bar: [55, 0.05] },
  holi: { left: [200, 0.04], middle: [350, 0.03, 0.93], right: [100, 0.05], bar: [145, 0.04] },
  aarti: { left: [85, 0.04], middle: [50, 0.03, 0.95], right: [15, 0.025, 0.94], bar: [115, 0.035] },
  monsoon: { left: [245, 0.04], middle: [200, 0.035, 1.12], right: [155, 0.045], bar: [280, 0.06] },
  sandhya: { left: [280, 0.07], middle: [310, 0.07], right: [345, 0.07], bar: [250, 0.05] },
  forest: { left: [150, 0.045], middle: [185, 0.035, 1.12], right: [60, 0.04], bar: [120, 0.04] },
  navratri: { left: [345, 0.07], middle: [265, 0.07], right: [150, 0.045], bar: [50, 0.05] },
  neel: { left: [275, 0.08], middle: [28, 0.06], right: [90, 0.04], bar: [200, 0.035, 1.12] },
  ratna: { left: [265, 0.07], middle: [155, 0.05], right: [5, 0.07], bar: [65, 0.045] },
  prabhat: { left: [50, 0.03, 0.96], middle: [10, 0.025, 0.96], right: [235, 0.025, 0.96], bar: [90, 0.04] },
  mehndi: { left: [110, 0.04], middle: [45, 0.03, 0.96], right: [170, 0.035], bar: [80, 0.04] },
  haldi: { left: [140, 0.04], middle: [100, 0.05], right: [10, 0.025, 0.96], bar: [60, 0.04, 0.96] },
  himalaya: { left: [230, 0.025, 0.96], middle: [275, 0.02, 0.96], right: [160, 0.035], bar: [195, 0.035] },
  uttarayan: { left: [235, 0.025, 0.96], middle: [95, 0.05], right: [355, 0.025, 0.96], bar: [145, 0.04] },
  mogra: { left: [145, 0.035], middle: [95, 0.04], right: [355, 0.025, 0.96], bar: [180, 0.035] },
};

/** A built-in appearance by its id. */
export const builtIn = (id: string): Appearance | undefined => BUILT_IN.find((a) => a.id === id);

/** What Follow the computer shows: Black when the computer is set dark, else White. */
export const followed = (dark: boolean): Appearance => (dark ? BLACK : WHITE);
