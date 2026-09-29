/**
 * Content types shared by the database, the show engine and every renderer.
 * Everything here is plain, JSON-serializable data.
 */

/** Language tracks: English, Gujarati, Hindi (Devanagari) and Roman transliteration. */
export type Lang = 'en' | 'gu' | 'hi' | 'translit';
export const LANGS: readonly Lang[] = ['en', 'gu', 'hi', 'translit'];

/** A rectangle in slide coordinates (pixels of the slide's design size). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

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
  shadow: boolean;
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
  shadow?: boolean;
  /** Language of this run; when a source gives none it is detected from the script. */
  lang?: Lang | null;
  /**
   * Typed in a legacy (non-Unicode) Gujarati or Hindi font: the characters are
   * Latin codes that only look right in that font. Shown in that font; not searchable.
   */
  legacy?: boolean;
}

export interface TextElement {
  id: string;
  kind: 'text';
  frame: Rect;
  /** The plain text (all runs joined): for search, thumbnails and tests. */
  text: string;
  /** Main language of the text; selects shaping rules and fallback fonts. */
  lang: Lang | null;
  style: TextStyle;
  /** Styled runs. When present they are drawn instead of `text`, in the element's style where unset. */
  runs?: TextRun[];
}

export interface ShapeElement {
  id: string;
  kind: 'shape';
  frame: Rect;
  fill: string;
  cornerRadius: number;
  opacity: number;
}

/**
 * An image or video on a slide: a background (the whole slide) or a smaller
 * element. It points at a media library item. Imported now; drawn once media
 * playback lands (until then renderers leave it out).
 */
export interface MediaElement {
  id: string;
  kind: 'image' | 'video';
  frame: Rect;
  mediaId: string;
  fit: 'fit' | 'fill' | 'stretch';
  /** Videos: start again at the end. */
  loop?: boolean;
  opacity?: number;
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
}
