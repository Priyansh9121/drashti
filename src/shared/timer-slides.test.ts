import { describe, expect, it } from 'vitest';
import type { TextElement, TimerElement } from './model';
import { slideElementSchema } from './model-schema';
import {
  DRASHTI_TIMER_LOOK,
  isTimerShowId,
  TIMER_WORDS,
  timerAloneSlide,
  timerElement,
  timerLayoutElements,
  timerShowId,
  timerShownBy,
} from './timer-slides';

/*
 * A timer alone on the screens (Session 50): the Timer element as the library keeps it, Drashti's two ready
 * layouts in a theme's look, and the slide Show on the screens puts up, no presentation's.
 */

const look = {
  fontFamily: 'Placeholder Sans',
  fontSize: 80,
  fontWeight: 500,
  color: '#fde68a',
  shadow: true,
  outline: { color: '#000000', width: 2 },
} as const;

const ids = () => {
  let n = 0;
  return () => `id-${String(++n)}`;
};

describe('the Timer element', () => {
  it('is kept as a slide element: its timer, its look as words, the last minute and what happens at zero', () => {
    const el: TimerElement = {
      ...timerElement('e1', 't1', { x: 0, y: 0, width: 800, height: 300 }, look, 200, 'middle'),
      lastMinute: { color: '#f5a524' },
      atZero: 'next',
    };
    const parsed = slideElementSchema.safeParse(el);
    expect(parsed.success && parsed.data).toEqual(el);
    // The defaults: no colour of its own in the last minute, and it holds at 0:00.
    const plain = timerElement('e2', 't1', { x: 0, y: 0, width: 800, height: 300 }, look, 200, 'middle');
    expect(plain.lastMinute).toBeUndefined();
    expect(plain.atZero).toBeUndefined();
    expect(slideElementSchema.safeParse(plain).success).toBe(true);
    expect(slideElementSchema.safeParse({ ...plain, lastMinute: null }).success).toBe(true);
    // Nothing else.
    expect(slideElementSchema.safeParse({ ...el, atZero: 'loop' }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...el, lastMinute: { color: 'red' } }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...el, timerId: '' }).success).toBe(false);
  });

  it('takes the theme’s words: font, weight, colour, shadow and outline, at its own size', () => {
    const el = timerElement('e', 't1', { x: 1, y: 2, width: 3, height: 4 }, look, 281, 'top');
    expect(el).toEqual({
      id: 'e',
      kind: 'timer',
      frame: { x: 1, y: 2, width: 3, height: 4 },
      timerId: 't1',
      style: {
        fontFamily: 'Placeholder Sans',
        fontSize: 281,
        fontWeight: 500,
        color: '#fde68a',
        align: 'center',
        verticalAlign: 'top',
        lineHeight: 1,
        shadow: true,
        outline: { color: '#000000', width: 2 },
      },
    });
    // No outline in the theme: none on the timer.
    const { outline: _o, ...noOutline } = look;
    expect(timerElement('e', 't1', el.frame, noOutline, 200, 'middle').style.outline).toBeUndefined();
  });
});

describe('the two ready layouts', () => {
  it('Timer only: the time alone, large, in the middle of the slide', () => {
    const [time, ...rest] = timerLayoutElements('alone', 't1', look, { width: 1920, height: 1080 }, ids());
    expect(rest).toEqual([]);
    expect(time).toMatchObject({
      id: 'id-1',
      kind: 'timer',
      timerId: 't1',
      frame: { x: 96, y: 324, width: 1728, height: 432 },
      style: { fontSize: 281, align: 'center', verticalAlign: 'middle', color: '#fde68a' },
    });
  });

  it('Timer with words: a line of words above it, “Starting in” until the operator writes their own', () => {
    const made = timerLayoutElements('words', 't1', look, { width: 1920, height: 1080 }, ids());
    expect(made.map((e) => e.kind)).toEqual(['text', 'timer']);
    const words = made[0] as TextElement;
    expect(words.text).toBe(TIMER_WORDS);
    expect(TIMER_WORDS).toBe('Starting in');
    expect(words).toMatchObject({
      frame: { x: 96, y: 216, width: 1728, height: 216 },
      style: { fontSize: 80, fontFamily: 'Placeholder Sans', color: '#fde68a', verticalAlign: 'bottom' },
    });
    expect(made[1]).toMatchObject({ frame: { y: 454 }, style: { fontSize: 281, verticalAlign: 'top' } });
    // Their own words, and a slide of another size: in proportion.
    const small = timerLayoutElements(
      'words',
      't1',
      look,
      { width: 1280, height: 720 },
      ids(),
      'Placeholder',
    );
    expect((small[0] as TextElement).text).toBe('Placeholder');
    expect(small[1]?.frame).toEqual({ x: 64, y: 302, width: 1152, height: 259 });
    expect((small[1] as TimerElement).style.fontSize).toBe(187);
    // Empty words: the placeholder.
    const blank = timerLayoutElements('words', 't1', look, { width: 1920, height: 1080 }, ids(), '  ');
    expect((blank[0] as TextElement).text).toBe(TIMER_WORDS);
  });
});

describe('the slide Show on the screens puts up', () => {
  it('is the Timer only layout made for that timer, over whatever background is up, no presentation’s', () => {
    const slide = timerAloneSlide('t1', look);
    expect(slide).toMatchObject({ id: 'timer:t1', width: 1920, height: 1080, background: null });
    expect(slide.elements).toHaveLength(1);
    expect(slide.elements[0]).toMatchObject({ kind: 'timer', timerId: 't1', style: { fontSize: 281 } });
    // The same timer makes the same slide, so showing it again changes nothing.
    expect(timerAloneSlide('t1', look)).toEqual(slide);
    // Drashti's own look when there is no theme: white, its soft shadow.
    expect(timerAloneSlide('t1', DRASHTI_TIMER_LOOK).elements[0]).toMatchObject({
      style: { color: '#ffffff', shadow: true, fontFamily: null },
    });
  });

  it('names its timer in its presentation id, which no library presentation has', () => {
    expect(timerShowId('t1')).toBe('timer:t1');
    expect(timerShownBy('timer:t1')).toBe('t1');
    expect(timerShownBy('p1')).toBeNull();
    expect(timerShownBy('timer:')).toBeNull();
    expect(isTimerShowId('timer:t1')).toBe(true);
    expect(isTimerShowId('repeat:t1')).toBe(false);
  });
});
