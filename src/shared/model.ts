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

export interface TextElement {
  id: string;
  kind: 'text';
  frame: Rect;
  text: string;
  /** Language of the text; selects shaping rules and fallback fonts. */
  lang: Lang | null;
  style: TextStyle;
}

export interface ShapeElement {
  id: string;
  kind: 'shape';
  frame: Rect;
  fill: string;
  cornerRadius: number;
  opacity: number;
}

export type SlideElement = TextElement | ShapeElement;

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
