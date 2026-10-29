import { describe, expect, it } from 'vitest';
import {
  atOrPastZero,
  audienceTimerShows,
  audienceTimerText,
  goesAt,
  lookOf,
  startCountdownFields,
  startTimeGone,
  timeColor,
  timeLeftShare,
  timerDimmed,
  timeSize,
} from './audience-timer';
import {
  type AudienceTimerLook,
  audienceTimerLookSchema,
  DEFAULT_TIMER_LOOK,
  readTimerLook,
  START_COUNTDOWN_LOOK,
} from './timer-look';
import { type TimerState, timerFieldsSchema } from './timers';

/*
 * A timer for the audience (Session 55, Part 15), as every screen draws it from the engine's time: its size, the
 * share of the time left for its ring or bar, its warning colour, its slow flash near the end, what it shows at zero,
 * and when the engine takes it off by itself; Countdown to the start (Q) as one of them.
 */

const T0 = 1_000_000;

const countdown = (extra: Partial<TimerState> = {}): TimerState => ({
  id: 't1',
  name: 'Placeholder activity',
  kind: 'countdown',
  durationMs: 120_000,
  targetTime: null,
  allowsOverrun: false,
  startedAt: T0,
  elapsedMs: 0,
  ...extra,
});

const look = (extra: Partial<AudienceTimerLook> = {}): AudienceTimerLook => ({
  ...DEFAULT_TIMER_LOOK,
  ...extra,
});

describe('a timer for the audience', () => {
  it('a timer with no look of its own has the default: full screen over what is up, staying at zero', () => {
    expect(lookOf({})).toBe(DEFAULT_TIMER_LOOK);
    expect(DEFAULT_TIMER_LOOK).toMatchObject({
      place: 'full',
      over: 'content',
      atZero: 'stay',
      stage: false,
    });
    expect(readTimerLook(undefined)).toBeUndefined();
    expect(readTimerLook({ place: 'nowhere' })).toBeUndefined();
    expect(audienceTimerLookSchema.safeParse(START_COUNTDOWN_LOOK).success).toBe(true);
  });

  it('is a quarter of the picture full screen, a tenth in a corner, a fifth bigger a step', () => {
    expect(timeSize({ place: 'full', size: 0 }, 1080)).toBe(259);
    expect(timeSize({ place: 'top-right', size: 0 }, 1080)).toBe(108);
    expect(timeSize({ place: 'top-right', size: 1 }, 1080)).toBe(130);
    expect(timeSize({ place: 'full', size: 99 }, 1080)).toBe(timeSize({ place: 'full', size: 4 }, 1080));
  });

  it('its ring or bar: the share left of a countdown’s length, or of a countdown to a time from when it was shown', () => {
    const t = countdown();
    expect(timeLeftShare(t, T0, T0)).toBe(1);
    expect(timeLeftShare(t, T0 + 30_000, T0)).toBe(0.75);
    expect(timeLeftShare(t, T0 + 200_000, T0)).toBe(0);
    expect(timeLeftShare({ ...t, kind: 'countup' }, T0, T0)).toBeNull();
    expect(timeLeftShare({ ...t, kind: 'clock' }, T0, T0)).toBeNull();
    const d = new Date(T0 + 40 * 60_000);
    d.setSeconds(0, 0);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const to = { ...t, kind: 'countdown_to_time' as const, targetTime: time, startedAt: null };
    const shownAt = d.getTime() - 20 * 60_000;
    expect(timeLeftShare(to, d.getTime() - 5 * 60_000, shownAt)).toBe(0.25);
  });

  it('turns its warning colour from its time left, and flashes slowly near the end only when asked', () => {
    const t = countdown();
    const warned = look({ warn: { fromMs: 60_000, color: '#f5a524' } });
    expect(timeColor(warned, t, T0 + 59_000)).toBe('#ffffff');
    expect(timeColor(warned, t, T0 + 60_000)).toBe('#f5a524');
    expect(timeColor(look({ warn: null }), t, T0 + 119_000)).toBe('#ffffff');
    expect(timeColor(warned, { ...t, kind: 'countup' }, T0 + 119_000)).toBe('#ffffff');
    // No flash unless asked.
    expect(timerDimmed(warned, t, T0 + 61_000)).toBe(false);
    const flashing = look({ warn: { fromMs: 60_000, color: '#f5a524' }, flash: true });
    // Before the warning: never; from it to 10 s past zero, on the engine clock's even seconds, a second each.
    expect(timerDimmed(flashing, t, T0 + 58_000)).toBe(false);
    const dims: boolean[] = [];
    for (let at = T0 + 60_000; at < T0 + 130_000; at += 1000) dims.push(timerDimmed(flashing, t, at + 500));
    expect(dims.filter(Boolean)).toHaveLength(35);
    expect(dims.some((d, i) => i > 0 && d === dims[i - 1])).toBe(false);
    expect(timerDimmed(flashing, t, T0 + 140_500)).toBe(false);
    // Paused: at no moment of its own, so no flash.
    expect(timerDimmed(flashing, { ...t, startedAt: null, elapsedMs: 100_000 }, T0 + 200_500)).toBe(false);
  });

  it('at zero: stays, shows its message, shows the wallpaper, or goes (the engine takes it off then)', () => {
    const t = countdown();
    expect(atOrPastZero(t, T0 + 119_999)).toBe(false);
    expect(atOrPastZero(t, T0 + 120_000)).toBe(true);
    expect(atOrPastZero({ ...t, startedAt: null, elapsedMs: 120_000 }, T0)).toBe(true);
    expect(atOrPastZero({ ...t, kind: 'countup' }, T0 + 999_999)).toBe(false);
    for (const atZero of ['stay', 'message', 'wallpaper', 'gone'] as const) {
      expect(audienceTimerShows(look({ atZero }), t, T0 + 1000)).toBe('time');
      expect(audienceTimerShows(look({ atZero }), t, T0 + 120_000)).toBe(atZero === 'stay' ? 'time' : atZero);
    }
    expect(goesAt(look({ atZero: 'gone' }), t, T0)).toBe(T0 + 120_000);
    expect(goesAt(look({ atZero: 'stay' }), t, T0)).toBeNull();
    expect(goesAt(look({ atZero: 'gone' }), { ...t, startedAt: null }, T0)).toBeNull();
  });

  it('writes the time in its format', () => {
    const t = countdown({ durationMs: 65 * 60_000 });
    expect(audienceTimerText(look(), t, T0, null)).toBe('1:05:00');
    expect(audienceTimerText(look({ format: 'mss' }), t, T0, null)).toBe('65:00');
  });

  it('Countdown to the start refuses a time already come today (it would go at once)', () => {
    const now = new Date(2026, 9, 30, 19, 0, 0).getTime();
    expect(startTimeGone('18:59', now)).toBe(true);
    expect(startTimeGone('19:00', now)).toBe(true);
    expect(startTimeGone('19:01', now)).toBe(false);
    expect(startTimeGone('soon', now)).toBe(true);
  });

  it('Countdown to the start: a countdown to the sabha’s time over the wallpaper, on the stage too, gone at zero', () => {
    const fields = startCountdownFields('19:30');
    expect(fields).toMatchObject({
      name: 'Countdown to the start',
      kind: 'countdown_to_time',
      targetTime: '19:30',
    });
    expect(fields.look).toMatchObject({ over: 'wallpaper', atZero: 'gone', stage: true });
    expect(timerFieldsSchema.safeParse(fields).success).toBe(true);
  });
});
