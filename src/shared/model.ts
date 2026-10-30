/**
 * Content types shared by the database, the show engine and every renderer.
 * Everything here is plain, JSON-serializable data.
 */

import type { DeckSlide } from './deck';

/**
 * Languages: English, Gujarati, Hindi (Devanagari), Roman transliteration,
 * and Sanskrit in either of its scripts (Session 12, for Shastra texts):
 * Devanagari ('sa') or Gujarati script ('sa-gu'). Sanskrit is two languages
 * so that each screen group's Look chooses the script its audience reads,
 * as it chooses any language. Script alone cannot tell Sanskrit from Hindi
 * or Gujarati, so a line is Sanskrit only when it was marked so.
 */
export type Lang = 'en' | 'gu' | 'hi' | 'translit' | 'sa' | 'sa-gu';
export const LANGS: readonly Lang[] = ['en', 'gu', 'hi', 'translit', 'sa', 'sa-gu'];

/**
 * The languages written in Gujarati or Devanagari letters (Sessions 31–36, I18N-2): drawn upright with no
 * letter-spacing whatever a file stored (their joined letters break apart when slanted or spaced).
 * Transliteration keeps its italic.
 */
export const INDIC_LANGS: readonly Lang[] = ['gu', 'hi', 'sa', 'sa-gu'];
export const isIndic = (lang: Lang | null | undefined): boolean => lang != null && INDIC_LANGS.includes(lang);

/** The line height new text gets (Sessions 31–36, I18N-2): room for Gujarati and Hindi marks above and below. */
export const NEW_TEXT_LINE_HEIGHT = 1.35;

/**
 * What a transliteration is of (Sessions 31–36, I18N-4), for its `lang` tag: gu-Latn, hi-Latn or sa-Latn
 * (Sanskrit in either script).
 */
export type TranslitSource = 'gu' | 'hi' | 'sa';

/** A kirtan's language tracks (Edit words by language, the Kirtan dialog): the four kirtans are written in. */
export type KirtanLang = Exclude<Lang, 'sa' | 'sa-gu'>;
export const KIRTAN_LANGS: readonly KirtanLang[] = ['en', 'gu', 'hi', 'translit'];

/** Sanskrit, in Devanagari or in Gujarati script. */
export const isSanskrit = (lang: Lang | null | undefined): boolean => lang === 'sa' || lang === 'sa-gu';

/** A rectangle in slide coordinates (pixels of the slide's design size). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/** A drop shadow, in slide pixels. */
export interface Shadow {
  /** "#rrggbb", or "#rrggbbaa" to see through it. */
  color: string;
  /** How soft it is: the blur radius. */
  blur: number;
  /** How far it falls to the right and down (negative: left and up). */
  x: number;
  y: number;
}

/** A line around letters, or along a shape's edge. */
export interface Outline {
  /** "#rrggbb" or "#rrggbbaa". */
  color: string;
  /** Thickness in slide pixels. */
  width: number;
}

/**
 * A text shadow: true is Drashti's own soft shadow, which grows with the
 * text (as every slide had before Session 7); a Shadow sets its colour, blur
 * and offset; false is none.
 */
export type TextShadow = boolean | Shadow;

/** A glow round letters (Session 55, Part 17a): light of a colour spreading out all round them, as far as `size`. */
export interface Glow {
  /** "#rrggbb", or "#rrggbbaa" to see through it. */
  color: string;
  /** How far it spreads (its blur), in slide pixels. */
  size: number;
}

/**
 * A line's mark when it is one of a list (Session 55, Part 17a): a bullet (a dot, a ring, a square, a dash or an
 * arrow), or a number: 1. 2. 3., in Gujarati digits (૧. ૨. ૩.), in Devanagari digits (१. २. ३.), a. b. c., A. B. C.
 * or i. ii. iii.
 */
export const BULLET_MARKS = ['disc', 'circle', 'square', 'dash', 'arrow'] as const;
export const NUMBER_MARKS = ['1', 'gu', 'hi', 'a', 'A', 'i'] as const;
export type BulletMark = (typeof BULLET_MARKS)[number];
export type NumberMark = (typeof NUMBER_MARKS)[number];
export type ListMark = BulletMark | NumberMark;
export const LIST_MARKS = [...BULLET_MARKS, ...NUMBER_MARKS] as const satisfies readonly ListMark[];
export const isNumberMark = (mark: ListMark): mark is NumberMark =>
  (NUMBER_MARKS as readonly string[]).includes(mark);
/** How far in a list's line can go: levels 0 (the first) to 4. */
export const MAX_LIST_LEVEL = 4;

export interface TextStyle {
  /** CSS font-family list; the renderer adds the bundled Noto fonts as fallbacks. */
  fontFamily: string | null;
  /** Size in slide pixels. */
  fontSize: number;
  fontWeight: number;
  color: string;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  shadow: TextShadow;
  /** A line around the letters; left out or null for none. */
  outline?: Outline | null;
  /** A glow round the letters (Session 55, Part 17a); left out or null for none. */
  glow?: Glow | null;
  /** Make the words smaller until they fit the box (never bigger than they are set). */
  shrinkToFit?: boolean;
}

/**
 * A stretch of text with its own style inside a text element (PLAN.md 4.3):
 * ProPresenter text boxes often mix, say, a large Gujarati line and a smaller
 * transliteration line. Anything left unset falls back to the element's style.
 */
export interface TextRun {
  /** May contain "\n" for line and paragraph breaks. */
  text: string;
  /** Font family as the source named it; the bundled fonts stay as fallbacks. */
  font?: string | null;
  /** Size in slide pixels. */
  size?: number;
  color?: string;
  weight?: number;
  italic?: boolean;
  /** Extra space between letters, in slide pixels (negative is tighter). */
  letterSpacing?: number;
  /** A drop shadow behind this run's letters; when unset, the element's style decides. */
  shadow?: TextShadow;
  /** A line around this run's letters (null: none); when unset, the element's style decides. */
  outline?: Outline | null;
  /** Underlined (Session 55, Part 17a). */
  underline?: boolean;
  /** Struck through (Session 55, Part 17a). */
  strike?: boolean;
  /** A glow round this run's letters (null: none); when unset, the element's style decides (Session 55, Part 17a). */
  glow?: Glow | null;
  /**
   * The line this run is on is one of a list, with this mark (Session 55, Part 17a: shared/text-lists.ts). Every run
   * of the line carries it, its line break too, so the line keeps it wherever it goes.
   */
  list?: ListMark;
  /** How far in that list's line is: 1 to MAX_LIST_LEVEL; left out for the first level. */
  level?: number;
  /** Language of this run; when a source gives none it is detected from the script. */
  lang?: Lang | null;
  /**
   * Typed in a legacy (non-Unicode) Gujarati or Hindi font: the characters are
   * Latin codes that only look right in that font. Shown in that font; not searchable.
   */
  legacy?: boolean;
}

/** What every element has: its place, and how far it is turned. */
interface ElementBase {
  id: string;
  frame: Rect;
  /** Degrees clockwise, about the frame's centre; left out for none. */
  rotation?: number;
}

export interface TextElement extends ElementBase {
  kind: 'text';
  /** The plain text (all runs joined): for search, thumbnails and tests. */
  text: string;
  /** Main language of the text; selects shaping rules and fallback fonts. */
  lang: Lang | null;
  style: TextStyle;
  /** Styled runs. When present they are drawn instead of `text`, in the element's style where unset. */
  runs?: TextRun[];
  /** 0 to 1; left out for fully there. */
  opacity?: number;
  /**
   * On a kirtan's slide, every screen shows it whatever languages the
   * screen shows (a title or a footer, not one of the tracks).
   */
  everyScreen?: boolean;
}

/**
 * A rectangle (rounded when it has a corner radius), an ellipse filling its
 * frame, or a line across the middle of its frame from the left edge to the
 * right (turned with rotation; its outline gives its colour and thickness).
 */
export type ShapeKind = 'rectangle' | 'ellipse' | 'line';
export const SHAPE_KINDS: readonly ShapeKind[] = ['rectangle', 'ellipse', 'line'];

export interface ShapeElement extends ElementBase {
  kind: 'shape';
  /** Left out: a rectangle (every shape before Session 7 was one). */
  shape?: ShapeKind;
  /** "#rrggbb" or "#rrggbbaa"; null for none (an outline only, or a line). */
  fill: string | null;
  /** Rectangles only: how round the corners are, in slide pixels. */
  cornerRadius: number;
  opacity: number;
  /** A line along the edge; left out or null for none. A line's own colour and thickness. */
  outline?: Outline | null;
}

/** An image or video on a slide, pointing at a media library item. */
export interface MediaElement extends ElementBase {
  kind: 'image' | 'video';
  mediaId: string;
  fit: 'fit' | 'fill' | 'stretch';
  /** Videos: start again at the end. */
  loop?: boolean;
  opacity?: number;
  /** Videos: how loud its sound plays (0 to 1, 0 for none); left out for full. */
  volume?: number;
  /**
   * Videos (Session 54): the screens draw a thin bar along its bottom with its time and a play or pause mark, from the
   * engine's time, as a deck's video shows in a slideshow. Left out (off) unless ticked in the slide editor.
   */
  playBar?: boolean;
}

/**
 * What a countdown on a slide does at zero (Session 50): holds at 0:00, or the next slide comes on; since Session 55
 * (Part 15) it can show a message in its place, or go.
 */
export type TimerAtZero = 'hold' | 'next' | 'message' | 'gone';
export const TIMER_AT_ZERO = ['hold', 'next', 'message', 'gone'] as const satisfies readonly TimerAtZero[];

/** How a timer writes a length (Session 55, as a stage layout's timer box does): as needed, m:ss, or h:mm:ss. */
export type TimerFormat = 'auto' | 'mss' | 'hmmss';
export const TIMER_FORMATS = ['auto', 'mss', 'hmmss'] as const satisfies readonly TimerFormat[];

/**
 * A timer on a slide (Session 50): one of the library's timers (shared/timers.ts), live, styled as words are
 * (font, size, weight, colour, outline and shadow, placed in its box as a text box's words are). Each screen
 * works out its time from the engine's timers, as a message's timer does; only the digits that change move,
 * once a second.
 */
export interface TimerElement extends ElementBase {
  kind: 'timer';
  /** The timer it shows; one no longer in the library shows --:--. */
  timerId: string;
  style: TextStyle;
  /** A countdown's last minute: the time turns this colour. Left out or null: it stays as it is. */
  lastMinute?: { color: string } | null;
  /** A countdown at zero: it holds at 0:00 (the default, left out), or the next slide comes on. */
  atZero?: TimerAtZero;
  /** 0 to 1; left out for fully there. */
  opacity?: number;
  /** How it writes a length (Session 55, Part 15); left out, as needed (a clock writes the time of day). */
  format?: TimerFormat;
  /**
   * A countdown's warning (Session 55): from this much left (ms) the time turns this colour, in place of the last
   * minute's (an older slide's `lastMinute` is its warning from a minute left). Left out or null: none.
   */
  warn?: { fromMs: number; color: string } | null;
  /** A countdown at 0:00 and past it turns this colour (Session 55). Left out: as it is. */
  overColor?: string;
  /** A countdown flashes slowly for ten seconds at zero (Session 55, as a stage timer box does). */
  flash?: boolean;
  /** The words a countdown shows at zero in its place, when it says so (`atZero` 'message'; Session 55). */
  zeroText?: string;
}

export type SlideElement = TextElement | ShapeElement | MediaElement | TimerElement;

/** A slide resolved for display: everything a renderer needs, nothing more. */
/**
 * Darkening behind the words (Sessions 31–36, SLD-3): a band behind each box of words, or the whole picture,
 * drawn over the background (a picture or video included) and under the words, this dark (0.4, 0.6 or 0.8).
 */
export type DarkenKind = 'band' | 'whole';
export const DARKEN_KINDS = ['band', 'whole'] as const satisfies readonly DarkenKind[];
export const DARKEN_STRENGTHS = [0.4, 0.6, 0.8] as const;
export interface Darken {
  kind: DarkenKind;
  /** How dark: the black's opacity, 0 to 1 (the choices are 0.4, 0.6 and 0.8). */
  strength: number;
}

export interface RenderSlide {
  id: string;
  /** Design size of the slide (the presentation's size). */
  width: number;
  height: number;
  /** Solid background behind the elements, or null for transparent. */
  background: string | null;
  /** Darkening behind the words; left out for none (every slide made before it, Sessions 31–36). */
  darken?: Darken;
  elements: SlideElement[];
  /**
   * From a kirtan: each screen shows the languages it is set to show
   * (see language-view.ts). Left out for any other slide, shown in full.
   */
  kirtan?: boolean;
  /**
   * What its transliteration is of, when a screen's languages left it without the lines it came from
   * (language-view.ts; Sessions 31–36, I18N-4). Never stored: a slide in full says by its own lines.
   */
  translitOf?: TranslitSource;
  /**
   * A slide made from a PowerPoint or Keynote deck with its animations (Session 54, C2): its steps, its own
   * transition and its real videos and sounds (shared/deck.ts). Left out for every other slide, and for a deck's
   * page made as a picture only.
   */
  deck?: DeckSlide;
}

/**
 * How a slide comes onto the screens: at once (a cut), or from the slide before by a fade (a dissolve:
 * the new slide added light for light over the old), a fade through black, a slide in from the right, or
 * a slow zoom (a fade, the slide then zooming in slowly while it is up). Those three came with Repeat
 * Slides (Session 26d); any slide or presentation can pick them. Session 27 added the design lab's: a
 * hard diagonal wipe, a push and a zoom (each moving only the words, and only on screens whose Look moves
 * Bold: elsewhere they fade), and the words line by line or word by word (never word by word on a
 * kirtan's slides). Pictures only ever dissolve.
 */
export type TransitionKind =
  | 'cut'
  | 'dissolve'
  | 'fade-black'
  | 'slide'
  | 'zoom'
  | 'wipe'
  | 'push'
  | 'zoom-dissolve'
  | 'lines'
  | 'words';
export const TRANSITION_KINDS = [
  'cut',
  'dissolve',
  'fade-black',
  'slide',
  'zoom',
  'wipe',
  'push',
  'zoom-dissolve',
  'lines',
  'words',
] as const satisfies readonly TransitionKind[];

/** Each transition's name, as the operator reads it. */
export const TRANSITION_NAMES: Record<TransitionKind, string> = {
  cut: 'Cut',
  dissolve: 'Fade',
  'fade-black': 'Fade through black',
  slide: 'Slide',
  zoom: 'Slow zoom',
  wipe: 'Wipe',
  push: 'Push',
  'zoom-dissolve': 'Zoom',
  lines: 'Line by line',
  words: 'Word by word',
};

/** The kinds only a Bold Look draws as themselves (Session 27); screens that move Calm fade instead. */
export const BOLD_ONLY_KINDS: readonly TransitionKind[] = ['wipe', 'push', 'zoom-dissolve'];

export interface Transition {
  kind: TransitionKind;
  /** How long it takes (0 for a cut). */
  durationMs: number;
  /**
   * A slow zoom: how long the slide zooms in for, from when it went up. The engine sets it for a slide that
   * moves on by itself (a Repeat Slides step: its seconds and the next one's transition); left out, SLOW_ZOOM_MS.
   */
  spanMs?: number;
}

/** How long a slow zoom zooms in for when the slide does not move on by itself. */
export const SLOW_ZOOM_MS = 20_000;
/** How big a slow zoom makes the slide by the end: 8 % bigger, about its middle. */
export const SLOW_ZOOM_SCALE = 1.08;

/** The transition every presentation starts with until the operator chooses another. */
export const CUT: Transition = { kind: 'cut', durationMs: 0 };

/** The longest transition and auto-advance Drashti keeps. */
export const MAX_TRANSITION_MS = 10_000;
export const MAX_AUTO_ADVANCE_MS = 24 * 60 * 60 * 1000;
