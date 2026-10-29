import { describe, expect, it } from 'vitest';
import { STAGE_HEIGHT, STAGE_WIDTH, stageBoxSchema } from './stage-layouts';
import {
  freshName,
  STAGE_TEMPLATE_NAMES,
  STAGE_TEMPLATES,
  stopsAtZeroFor,
  templateBoxes,
  templateTimer,
  templateTimerKinds,
  TEMPLATE_TIMER_NAMES,
} from './stage-templates';
import { timerFieldsSchema } from './timers';

/*
 * New from a Template… (Session 54): ready-made stage layouts, each with the timer it needs; since Session 55 six, the
 * sixth for pravachan and anchoring: the video input large, with the clock and a countdown.
 */

const ids = () => {
  let n = 0;
  return () => `box-${String(++n)}`;
};

describe('the stage layout templates', () => {
  it('are six, by their names', () => {
    expect(STAGE_TEMPLATES.map((t) => STAGE_TEMPLATE_NAMES[t])).toEqual([
      'Timer only',
      'Countdown to a time',
      'Countdown',
      'Count up from 0:00',
      'Timer and clock over the audience',
      'Pravachan and anchoring',
    ]);
  });

  // Session 55: the video mixer's programme output large for the speaker and the anchor, the time beside it.
  it('put the video input large, with the clock and a countdown beside it and the stage message under them', () => {
    const boxes = templateBoxes('pravachan', 'placeholder-timer', ids());
    expect(boxes.map((b) => b.kind)).toEqual(['videoInput', 'clock', 'timer', 'stageMessage']);
    const [input, clock, timer, message] = boxes;
    // The largest box by far, 16:9, at the top left.
    expect(input?.frame).toEqual({ x: 48, y: 48, width: 1312, height: 738 });
    expect((input?.frame.width ?? 0) / (input?.frame.height ?? 1)).toBeCloseTo(16 / 9, 2);
    for (const other of [clock, timer, message])
      expect((other?.frame.width ?? 0) * (other?.frame.height ?? 0), other?.kind).toBeLessThan(
        ((input?.frame.width ?? 0) * (input?.frame.height ?? 0)) / 2,
      );
    // The clock above the countdown, beside the picture, never over it.
    for (const side of [clock, timer]) {
      expect(side?.frame.x, side?.kind).toBeGreaterThan((input?.frame.x ?? 0) + (input?.frame.width ?? 0));
      expect((side?.frame.x ?? 0) + (side?.frame.width ?? 0), side?.kind).toBe(STAGE_WIDTH - 48);
    }
    expect((clock?.frame.y ?? 0) + (clock?.frame.height ?? 0)).toBeLessThan(timer?.frame.y ?? 0);
    expect(clock).toMatchObject({ size: 'fit', bold: true, align: 'center', valign: 'middle' });
    // The countdown in the Countdown's colours: amber from 1:00 left, red past 0:00.
    expect(timer).toMatchObject({
      timerId: 'placeholder-timer',
      warn: { color: '#f5a524', fromMs: 60_000 },
      overColor: '#ef4444',
    });
    // The stage message along the bottom, under the picture.
    expect(message?.frame.y).toBeGreaterThan((input?.frame.y ?? 0) + (input?.frame.height ?? 0));
    expect(message?.frame.width).toBe(STAGE_WIDTH - 96);
    expect(templateTimerKinds('pravachan')).toEqual(['countdown']);
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

  it('draw the time bold, in the middle, as large as its box holds; the Countdown in its warning and over colours', () => {
    for (const t of STAGE_TEMPLATES) {
      const timer = templateBoxes(t, 'placeholder-timer', ids()).find((b) => b.kind === 'timer');
      expect(timer, t).toMatchObject({ bold: true, valign: 'middle', fitWhole: true });
      if (t !== 'countdown' && t !== 'pravachan') expect(timer, t).not.toHaveProperty('overColor');
    }
    expect(templateBoxes('countdown', 'placeholder-timer', ids())[0]).toMatchObject({
      warn: { color: '#f5a524', fromMs: 60_000 },
      overColor: '#ef4444',
    });
    // The words above a countdown to a time sit just above it.
    expect(templateBoxes('countdownTo', 'placeholder-timer', ids())[0]).toMatchObject({ valign: 'bottom' });
  });

  it('fill the timer and the clock over the audience picture, see-through, so they stay readable', () => {
    const [hall, timer, clock] = templateBoxes('overAudience', 'placeholder-timer', ids());
    expect(hall).not.toHaveProperty('fill');
    for (const box of [timer, clock])
      expect(box, box?.kind).toMatchObject({
        fill: { color: '#000000', seeThrough: 0.4 },
        bold: true,
        valign: 'middle',
      });
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
    // Pravachan and anchoring's countdown runs on past 0:00 too, in red (Session 55): the speaker sees the time over.
    expect(templateTimer('pravachan', 'countdown', asked)).toMatchObject({
      kind: 'countdown',
      durationMs: 300_000,
      allowsOverrun: true,
    });
    // What the main process takes from the window.
    for (const t of STAGE_TEMPLATES)
      for (const kind of templateTimerKinds(t))
        expect(timerFieldsSchema.safeParse(templateTimer(t, kind, asked)).success, `${t} ${kind}`).toBe(true);
  });

  // Part A's review: the Countdown goes on past 0:00 in the overtime colour, which one that holds there never shows.
  it('know when a countdown chosen in Timers stops short of what the Countdown shows', () => {
    const held = { kind: 'countdown' as const, allowsOverrun: false };
    expect(stopsAtZeroFor('countdown', held)).toBe(true);
    expect(stopsAtZeroFor('countdown', { ...held, allowsOverrun: true })).toBe(false);
    // Pravachan and anchoring's countdown goes past 0:00 in red too (Session 55).
    expect(stopsAtZeroFor('pravachan', held)).toBe(true);
    expect(stopsAtZeroFor('pravachan', { ...held, allowsOverrun: true })).toBe(false);
    for (const t of STAGE_TEMPLATES.filter((x) => x !== 'countdown' && x !== 'pravachan'))
      expect(stopsAtZeroFor(t, held), t).toBe(false);
    expect(stopsAtZeroFor('countdown', { kind: 'countup', allowsOverrun: false })).toBe(false);
  });

  it('name what they make so that no other has the name', () => {
    expect(freshName([], 'Countdown')).toBe('Countdown');
    expect(freshName(['Countdown'], 'Countdown')).toBe('Countdown 2');
    expect(freshName(['Countdown', 'Countdown 2', 'Countdown 3'], 'Countdown')).toBe('Countdown 4');
    expect(freshName(['Countdown 2'], 'Countdown')).toBe('Countdown');
  });
});
