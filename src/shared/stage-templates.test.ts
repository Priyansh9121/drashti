import { describe, expect, it } from 'vitest';
import { STAGE_HEIGHT, STAGE_WIDTH, stageBoxSchema } from './stage-layouts';
import {
  freshName,
  STAGE_TEMPLATE_NAMES,
  STAGE_TEMPLATES,
  templateBoxes,
  templateTimer,
  templateTimerKinds,
  TEMPLATE_TIMER_NAMES,
} from './stage-templates';
import { timerFieldsSchema } from './timers';

/* New from a Template… (Session 54): five ready-made stage layouts, each with the timer it needs. */

const ids = () => {
  let n = 0;
  return () => `box-${String(++n)}`;
};

describe('the stage layout templates', () => {
  it('are five, by their names', () => {
    expect(STAGE_TEMPLATES.map((t) => STAGE_TEMPLATE_NAMES[t])).toEqual([
      'Timer only',
      'Countdown to a time',
      'Countdown',
      'Count up from 0:00',
      'Timer and clock over the audience',
    ]);
  });

  it('each makes boxes a layout keeps, on the stage canvas, its timer box showing the timer given', () => {
    for (const t of STAGE_TEMPLATES) {
      const boxes = templateBoxes(t, 'placeholder-timer', ids());
      expect(boxes.length, t).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(stageBoxSchema.safeParse(box).success, `${t} ${box.kind}`).toBe(true);
        expect(box.frame.x, `${t} ${box.kind}`).toBeGreaterThanOrEqual(0);
        expect(box.frame.y, `${t} ${box.kind}`).toBeGreaterThanOrEqual(0);
        expect(box.frame.x + box.frame.width, `${t} ${box.kind}`).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(box.frame.y + box.frame.height, `${t} ${box.kind}`).toBeLessThanOrEqual(STAGE_HEIGHT);
      }
      const timers = boxes.filter((b) => b.kind === 'timer');
      expect(
        timers.map((b) => b.timerId),
        t,
      ).toEqual(['placeholder-timer']);
      expect(new Set(boxes.map((b) => b.id)).size, t).toBe(boxes.length);
    }
  });

  it('fill the screen with the timer alone, or put words above a countdown to a time', () => {
    for (const t of ['timer', 'countdown', 'countUp'] as const) {
      const [box, ...rest] = templateBoxes(t, 'placeholder-timer', ids());
      expect(rest, t).toEqual([]);
      expect(box, t).toMatchObject({ kind: 'timer', size: 'fit', align: 'center', label: '' });
      // Nearly the whole stage: 48 px in from each edge.
      expect(box?.frame, t).toEqual({ x: 48, y: 48, width: 1824, height: 984 });
    }
    const [words, timer] = templateBoxes('countdownTo', 'placeholder-timer', ids(), 'Placeholder words');
    expect(words).toMatchObject({ kind: 'text', text: 'Placeholder words', align: 'center' });
    expect(timer).toMatchObject({ kind: 'timer', size: 'fit', align: 'center' });
    // The words above the time, the time large.
    expect((words?.frame.y ?? 0) + (words?.frame.height ?? 0)).toBeLessThanOrEqual(timer?.frame.y ?? 0);
    expect(timer?.frame.height).toBeGreaterThan(STAGE_HEIGHT / 2);
    // Words left empty: "Starting in", placeholder words.
    expect(templateBoxes('countdownTo', 'placeholder-timer', ids(), '  ')[0]?.text).toBe('Starting in');
  });

  it('put the audience picture under a timer at the top left and the clock at the top right', () => {
    const boxes = templateBoxes('overAudience', 'placeholder-timer', ids());
    expect(boxes.map((b) => b.kind)).toEqual(['audience', 'timer', 'clock']);
    const [hall, timer, clock] = boxes;
    expect(hall?.frame).toEqual({ x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT });
    expect(timer?.frame.x).toBeLessThan(STAGE_WIDTH / 2);
    expect(timer?.frame.y).toBeLessThan(STAGE_HEIGHT / 4);
    expect(timer?.align).toBe('left');
    expect(clock?.frame.x).toBeGreaterThan(STAGE_WIDTH / 2);
    expect((clock?.frame.x ?? 0) + (clock?.frame.width ?? 0)).toBe(STAGE_WIDTH - 48);
    expect(clock?.frame.y).toBe(timer?.frame.y);
    expect(clock?.align).toBe('right');
  });

  it('count with their own kind of timer, or one the operator chooses (never a clock)', () => {
    expect(templateTimerKinds('countdownTo')).toEqual(['countdown_to_time']);
    expect(templateTimerKinds('countdown')).toEqual(['countdown']);
    expect(templateTimerKinds('countUp')).toEqual(['countup']);
    for (const t of ['timer', 'overAudience'] as const)
      expect(templateTimerKinds(t)).toEqual(['countdown', 'countup', 'countdown_to_time']);
  });

  it('make a timer of placeholder name, with the length or the time asked; the Countdown runs on past 0:00', () => {
    expect(TEMPLATE_TIMER_NAMES).toEqual({
      countdown: 'Stage countdown',
      countdown_to_time: 'Stage countdown to a time',
      countup: 'Stage count up',
    });
    const asked = { name: 'Stage countdown', durationMs: 5 * 60_000, targetTime: '19:30' };
    expect(templateTimer('countdown', 'countdown', asked)).toEqual({
      name: 'Stage countdown',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: true,
    });
    expect(templateTimer('countdownTo', 'countdown_to_time', { ...asked, name: 'Placeholder' })).toEqual({
      name: 'Placeholder',
      kind: 'countdown_to_time',
      durationMs: 0,
      targetTime: '19:30',
      allowsOverrun: false,
    });
    expect(templateTimer('countUp', 'countup', asked)).toMatchObject({
      kind: 'countup',
      durationMs: 0,
      targetTime: null,
      allowsOverrun: false,
    });
    expect(templateTimer('timer', 'countdown', asked)).toMatchObject({
      durationMs: 300_000,
      allowsOverrun: false,
    });
    // What the main process takes from the window.
    for (const t of STAGE_TEMPLATES)
      for (const kind of templateTimerKinds(t))
        expect(timerFieldsSchema.safeParse(templateTimer(t, kind, asked)).success, `${t} ${kind}`).toBe(true);
  });

  it('name what they make so that no other has the name', () => {
    expect(freshName([], 'Countdown')).toBe('Countdown');
    expect(freshName(['Countdown'], 'Countdown')).toBe('Countdown 2');
    expect(freshName(['Countdown', 'Countdown 2', 'Countdown 3'], 'Countdown')).toBe('Countdown 4');
    expect(freshName(['Countdown 2'], 'Countdown')).toBe('Countdown');
  });
});
