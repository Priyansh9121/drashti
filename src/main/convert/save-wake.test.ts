import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../shared/engine/state';
import { conversionsLookAt, SaveWake } from './save-wake';

/*
 * alpha.23 (the save-trim review's SHOULD-2): a video or a sound that does not go round stops holding a save once it
 * has played to its end (shared/save-waits.ts), with nothing changing on LIVE when its last picture stays up. The
 * waiting saves (a row's Trim checks and carries on its cut only when told something changed) are woken then.
 */

/** A clock and timers the test moves on by hand. */
function setUp(ends: (number | null)[] = []) {
  let now = 0;
  let endsAt: number | null = ends[0] ?? null;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  let woken = 0;
  const wake = new SaveWake({
    endsAt: () => endsAt,
    now: () => now,
    wake: () => {
      woken++;
    },
    schedule: (ms, run) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  return {
    wake,
    pending: () => timers.filter((t) => t.live).map((t) => t.at),
    woken: () => woken,
    setEnds: (at: number | null) => {
      endsAt = at;
    },
    /** The clock moved to `to`; every timer due by then runs, in order. */
    advance: (to: number) => {
      now = to;
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) return;
        due.live = false;
        due.run();
      }
    },
    /** One timer runs early, at `at` (its clock and this one a moment apart). */
    early: (at: number) => {
      now = at;
      const first = timers.filter((t) => t.live).sort((a, b) => a.at - b.at)[0];
      if (!first) throw new Error('No timer is waiting.');
      first.live = false;
      first.run();
    },
  };
}

describe('waking the waiting saves when what plays has played to its end', () => {
  it('waits for that moment, wakes them then, and waits for the next end', () => {
    const t = setUp([5000]);
    t.wake.changed();
    expect(t.pending()).toEqual([5000]);
    t.advance(4999);
    expect(t.woken()).toBe(0);
    // At its end, the next thing playing that ends by itself ends at 9000.
    t.setEnds(9000);
    t.advance(5000);
    expect(t.woken()).toBe(1);
    expect(t.pending()).toEqual([9000]);
    t.setEnds(null);
    t.advance(9000);
    expect(t.woken()).toBe(2);
    expect(t.pending()).toEqual([]);
  });

  it('keeps its one timer while the moment stays, and follows it as it changes', () => {
    const t = setUp([5000]);
    t.wake.changed();
    t.wake.changed();
    expect(t.pending()).toEqual([5000]);
    // Moved on the time bar: it ends sooner.
    t.setEnds(3000);
    t.wake.changed();
    expect(t.pending()).toEqual([3000]);
    // Taken off, paused or going round: nothing ends by itself.
    t.setEnds(null);
    t.wake.changed();
    expect(t.pending()).toEqual([]);
    t.advance(10_000);
    expect(t.woken()).toBe(0);
  });

  it('a timer that comes a moment early waits again for what is left, waking nothing yet', () => {
    const t = setUp([5000]);
    t.wake.changed();
    t.early(4998);
    expect(t.woken()).toBe(0);
    expect(t.pending()).toEqual([5000]);
    t.setEnds(null);
    t.advance(5000);
    expect(t.woken()).toBe(1);
  });

  it('stops once closed', () => {
    const t = setUp([5000]);
    t.wake.changed();
    t.wake.close();
    expect(t.pending()).toEqual([]);
    t.wake.changed();
    t.advance(10_000);
    expect(t.pending()).toEqual([]);
    expect(t.woken()).toBe(0);
  });
});

describe('the engine changes after which ConvertService looks at once whether its running work must stop', () => {
  // The save-trim review's SHOULD-6: a video cued for Go with nothing up holds a save (shared/save-waits.ts), yet a
  // save already being made heard of it only at ConvertService's next one-second look.
  it('is something up, or a video cued, starting at Go or going out in a crossfade with nothing up', () => {
    const nothing = initialEngineState();
    expect(conversionsLookAt(nothing)).toBe(false);
    expect(conversionsLookAt({ ...nothing, videoCue: null, videoStart: null, videoCrossfade: null })).toBe(
      false,
    );
    expect(
      conversionsLookAt({
        ...nothing,
        layers: { ...nothing.layers, messages: [{ id: 'm', text: 'Placeholder' }] },
      }),
    ).toBe(true);
    expect(conversionsLookAt({ ...nothing, videoCue: {} as never })).toBe(true);
    expect(conversionsLookAt({ ...nothing, videoStart: {} as never })).toBe(true);
    expect(conversionsLookAt({ ...nothing, videoCrossfade: {} as never })).toBe(true);
  });
});
