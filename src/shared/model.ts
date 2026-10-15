/**
 * Content types shared by the database, the show engine and every renderer.
 * Everything here is plain, JSON-serializable data.
 */

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
}

export type SlideElement = TextElement | ShapeElement | MediaElement;

/** A slide resolved for display: everything a renderer needs, nothing more. */
export interface RenderSlide {
  id: string;
  /** Design size of the slide (the presentation's size). */
  width: number;
  height: number;
  /** Solid background behind the elements, or null for transparent. */
  background: string | null;
  elements: SlideElement[];
  /**
   * From a kirtan: each screen shows the languages it is set to show
   * (see language-view.ts). Left out for any other slide, shown in full.
   */
  kirtan?: boolean;
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
