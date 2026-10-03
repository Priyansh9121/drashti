import type { EngineState } from './engine/state';
import { languageView } from './language-view';
import type { Lang, RenderSlide, TextRun } from './model';
import type { StreamLayout } from './stream';
import { boxLines, lineText, readingOrder } from './tracks';

/*
 * What the stream shows (PLAN.md 4.2), worked out from the show engine's
 * state and the stream's layout. The hall's own controls mean this for the
 * stream:
 *
 * Slides layout: the stream follows the hall. It shows what an audience
 * screen in the stream group's languages shows: black-out goes black, the
 * logo shows the logo, clears clear, and masks mask.
 *
 * Camera layout: the camera, full frame, always underneath.
 * - A slide with words: its words as a lower third, in the stream group's
 *   languages (picked and ordered as a hall screen would).
 * - A picture or video going live (a media item, or a slide with a picture
 *   or video and no words): that picture, full frame, instead of the camera.
 * - Clear slide, or a slide with nothing on it: the camera alone.
 * - Black-out and the logo are for the hall: the stream keeps the camera and
 *   drops the words and pictures. Props and messages stay.
 * - Masks are for the hall's screens and are left out.
 *
 * In both layouts props and messages show as the hall has them, and the
 * stage message (for the performers) never does.
 */

/** One line of the lower third: its runs, as the slide has them. */
export interface LowerThirdLine {
  lang: Lang | null;
  runs: TextRun[];
  /** Its text box's font, for words typed in a legacy font (which need it to read). */
  boxFont: string | null;
}

export type ProgramPicture =
  | { kind: 'scene' }
  | {
      kind: 'camera';
      /** The lower third's lines; empty when there are no words to show. */
      lowerThird: LowerThirdLine[];
      /**
       * Full frame instead of the camera: the background layer's picture or
       * video (a media item is live), or the live slide (a picture slide).
       */
      full: 'background' | 'slide' | null;
      /** Props and messages over the camera. */
      props: boolean;
      messages: boolean;
    };

/** At most this many lines in a lower third; a slide with more shows its first ones. */
export const LOWER_THIRD_MAX_LINES = 6;

/** A slide's words for a lower third, in these languages (null: all of them), top to bottom. */
export function lowerThird(slide: RenderSlide, languages: readonly Lang[] | null): LowerThirdLine[] {
  const shown = languageView(slide, languages);
  const lines: LowerThirdLine[] = [];
  for (const el of readingOrder(shown.elements))
    for (const line of boxLines(el)) {
      if (!line.legacy && lineText(line).trim() === '') continue;
      lines.push({ lang: line.lang, runs: line.runs, boxFont: el.style.fontFamily });
    }
  return lines.slice(0, LOWER_THIRD_MAX_LINES);
}

/** The slide has something to look at besides words: a picture or a video. */
export const hasPicture = (slide: RenderSlide): boolean =>
  slide.elements.some((e) => e.kind === 'image' || e.kind === 'video');

/** What the stream draws now, in this layout. */
export function programPicture(
  state: EngineState,
  layout: StreamLayout,
  languages: readonly Lang[] | null,
): ProgramPicture {
  if (layout === 'slides') return { kind: 'scene' };
  const covered = state.blackout || state.logo !== null;
  const base = { props: state.layers.props.length > 0, messages: state.layers.messages.length > 0 };
  if (covered) return { kind: 'camera', lowerThird: [], full: null, ...base };
  const slide = state.layers.slide?.slide ?? null;
  if (slide) {
    const words = lowerThird(slide, languages);
    if (words.length > 0) return { kind: 'camera', lowerThird: words, full: null, ...base };
    if (hasPicture(slide)) return { kind: 'camera', lowerThird: [], full: 'slide', ...base };
    return { kind: 'camera', lowerThird: [], full: null, ...base };
  }
  const bg = state.layers.background;
  if (bg?.kind === 'media') return { kind: 'camera', lowerThird: [], full: 'background', ...base };
  return { kind: 'camera', lowerThird: [], full: null, ...base };
}
