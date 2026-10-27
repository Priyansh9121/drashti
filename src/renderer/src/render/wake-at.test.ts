import { describe, expect, it } from 'vitest';
import { wakeAt } from './wake-at';

/*
 * A drawing asked for when the engine's time reaches a moment (Session 54, C2): a phone's deck step turning to its last
 * frame as its clip ends. A timer that wakes a moment early (a phone's clock offset set meanwhile) is armed again, so
 * the moment is never missed.
 */

/** A clock the test moves, and timers run when it gets to them. */
function stand() {
  let clock = 1000;
  const timers: { due: number; run: () => void }[] = [];
  return {
    now: () => clock,
    schedule: (run: () => void, ms: number) => {
      timers.push({ due: clock + ms, run });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    /** Move the clock to each timer's moment in turn, the engine's time `lag` ms behind it, and run it. */
    runAll(lag = 0) {
      for (let t = timers.shift(); t; t = timers.shift()) {
        clock = t.due - lag;
        t.run();
        lag = 0;
      }
    },
  };
}

describe('a drawing asked for at a moment of the engine’s time (Session 54, C2)', () => {
  it('wakes once it is there', () => {
    const s = stand();
    let woken = 0;
    wakeAt(2500, s.now, () => (woken += 1), s.schedule);
    s.runAll();
    expect(woken).toBe(1);
    expect(s.now()).toBeGreaterThanOrEqual(2500);
  });

  it('woken a moment early, waits again for the rest rather than missing the moment', () => {
    const s = stand();
    let woken = 0;
    wakeAt(2500, s.now, () => (woken += 1), s.schedule);
    // The engine's time 3 ms short of where the timer thought it would be (a clock offset set meanwhile).
    s.runAll(4);
    expect(woken).toBe(1);
    expect(s.now()).toBeGreaterThanOrEqual(2500);
  });

  it('a moment already past wakes at once', () => {
    const s = stand();
    let woken = 0;
    wakeAt(500, s.now, () => (woken += 1), s.schedule);
    s.runAll();
    expect(woken).toBe(1);
  });
});
