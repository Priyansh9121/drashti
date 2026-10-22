import type {
  Rect,
  RenderSlide,
  SlideElement,
  TextElement,
  TextStyle,
  TimerElement,
  VerticalAlign,
} from './model';
import { NEW_TEXT_LINE_HEIGHT } from './model';

/*
 * A timer alone on the screens (Session 50): Drashti's two ready layouts for a slide with a Timer on it, in a
 * presentation's theme (New Timer Slide… in a presentation's slide menu), and the slide the Timers panel's Show
 * on the screens puts up in the slide's place: the Timer only layout made for that timer, no presentation's
 * (`timer:<timerId>`, as Repeat Slides' slides are `repeat:<playlistId>`'s). Placeholder words only.
 */

export type TimerLayout = 'alone' | 'words';
export const TIMER_LAYOUTS = ['alone', 'words'] as const satisfies readonly TimerLayout[];
export const TIMER_LAYOUT_NAMES: Record<TimerLayout, string> = {
  alone: 'Timer only',
  words: 'Timer with words',
};

/** The line of words above the timer until the operator writes their own. */
export const TIMER_WORDS = 'Starting in';

/** How big the time is in both layouts: a little over a quarter of the slide's height (281 px at 1080). */
export const TIMER_SIZE = 0.26;

/** The presentation id of a timer shown alone: no presentation in the library has it. */
export const timerShowId = (timerId: string): string => `timer:${timerId}`;

/** The timer a presentation id shows alone, or null when it is not one. */
export function timerShownBy(presentationId: string): string | null {
  return presentationId.startsWith('timer:') ? presentationId.slice('timer:'.length) || null : null;
}

export const isTimerShowId = (presentationId: string): boolean => timerShownBy(presentationId) !== null;

/** What a timer slide takes from a theme's words: font, size (of the words), weight, colour, shadow, outline. */
export type TimerLook = Pick<
  TextStyle,
  'fontFamily' | 'fontSize' | 'fontWeight' | 'color' | 'shadow' | 'outline'
>;

/** Drashti's own, where there is no theme to follow: white, with its soft shadow. */
export const BUILT_IN_TIMER_LOOK: TimerLook = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  shadow: true,
};

/** Words, or a timer's digits, in the look, at a size, centred in their box. */
function lookStyle(
  look: TimerLook,
  size: number,
  verticalAlign: VerticalAlign,
  lineHeight: number,
): TextStyle {
  return {
    fontFamily: look.fontFamily,
    fontSize: size,
    fontWeight: look.fontWeight,
    color: look.color,
    align: 'center',
    verticalAlign,
    lineHeight,
    shadow: look.shadow,
    ...(look.outline ? { outline: { ...look.outline } } : {}),
  };
}

/** A Timer element showing a timer in a box, in the look's font, weight, colour, shadow and outline, at `size` px. */
export function timerElement(
  id: string,
  timerId: string,
  frame: Rect,
  look: TimerLook,
  size: number,
  verticalAlign: VerticalAlign,
): TimerElement {
  return { id, kind: 'timer', frame: { ...frame }, timerId, style: lookStyle(look, size, verticalAlign, 1) };
}

/** Across the slide, inside its title-safe edges. */
const across = (width: number) => ({ x: Math.round(width * 0.05), width: Math.round(width * 0.9) });

/**
 * A layout's elements on a slide of `size`, in `look` (the theme's words), their ids from `newId`: Timer only,
 * the time alone, large, in the middle; Timer with words, a line of words above it (their own, else "Starting
 * in"), the two together about the middle.
 */
export function timerLayoutElements(
  layout: TimerLayout,
  timerId: string,
  look: TimerLook,
  size: { width: number; height: number },
  newId: () => string,
  words: string = TIMER_WORDS,
): SlideElement[] {
  const { width, height } = size;
  const big = Math.round(height * TIMER_SIZE);
  if (layout === 'alone')
    return [
      timerElement(
        newId(),
        timerId,
        { ...across(width), y: Math.round(height * 0.3), height: Math.round(height * 0.4) },
        look,
        big,
        'middle',
      ),
    ];
  const line = words.trim() === '' ? TIMER_WORDS : words.trim();
  const text: TextElement = {
    id: newId(),
    kind: 'text',
    frame: { ...across(width), y: Math.round(height * 0.2), height: Math.round(height * 0.2) },
    text: line,
    lang: null,
    style: lookStyle(look, look.fontSize, 'bottom', NEW_TEXT_LINE_HEIGHT),
  };
  return [
    text,
    timerElement(
      newId(),
      timerId,
      { ...across(width), y: Math.round(height * 0.42), height: Math.round(height * 0.36) },
      look,
      big,
      'top',
    ),
  ];
}

/**
 * The slide Show on the screens puts up for a timer: the Timer only layout at 1920 x 1080 (each screen scales
 * it as it does any slide), with no colour of its own, so it is over whatever background is up. The same timer
 * makes the same slide, ids and all.
 */
export function timerAloneSlide(timerId: string, look: TimerLook): RenderSlide {
  const id = timerShowId(timerId);
  return {
    id,
    width: 1920,
    height: 1080,
    background: null,
    elements: timerLayoutElements('alone', timerId, look, { width: 1920, height: 1080 }, () => `${id}/time`),
  };
}
