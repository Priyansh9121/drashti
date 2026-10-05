import { describe, expect, it } from 'vitest';
import type { MacroCountdownView, MacroSchedule } from '../../shared/macros';
import { MACRO_COUNTDOWN_MS } from '../../shared/macros';
import { MacroScheduler } from './macro-scheduler';

/* Macros that run by themselves at their times (a clock the test moves; made-up names). */

function setup(start = new Date(2026, 9, 6, 18, 0).getTime(), schedules: MacroSchedule[] = []) {
  const clock = { now: start };
  const timers: { at: number; run: () => void }[] = [];
  const ran: string[] = [];
  const views: MacroCountdownView[] = [];
  const macros = [{ id: 'm1', name: 'Placeholder idle start', schedules }];
  const scheduler = new MacroScheduler({
    macros: () => macros,
    run: (id) => {
      ran.push(id);
      return { ok: true, rev: 1, changed: true };
    },
    now: () => clock.now,
    engineNow: () => clock.now,
    changed: (v) => views.push(v),
    log: () => undefined,
    schedule: (ms, run) => {
      const t = { at: clock.now + ms, run };
      timers.push(t);
      return () => {
        timers.splice(timers.indexOf(t), 1);
      };
    },
  });
  const tick = (ms: number) => {
    const end = clock.now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock.now = Math.max(clock.now, next.at);
      timers.splice(timers.indexOf(next), 1);
      next.run();
    }
    clock.now = end;
  };
  return { clock, ran, views, macros, scheduler, tick };
}

const at1830: MacroSchedule = {
  id: 's1',
  days: [0, 1, 2, 3, 4, 5, 6],
  date: null,
  time: '18:30',
  enabled: true,
};

describe('scheduled macros', () => {
  it('count down ten seconds at their time, then run', () => {
    const t = setup(undefined, [at1830]);
    t.tick(30 * 60_000 - 1000);
    expect(t.scheduler.view().countdowns).toHaveLength(0);
    t.tick(2000);
    const [c] = t.scheduler.view().countdowns;
    expect(c).toMatchObject({ macroId: 'm1', name: 'Placeholder idle start' });
    expect(t.ran).toEqual([]);
    t.tick(MACRO_COUNTDOWN_MS);
    expect(t.ran).toEqual(['m1']);
    expect(t.scheduler.view().countdowns).toHaveLength(0);
    // The next day too.
    t.tick(24 * 3600_000);
    expect(t.ran).toEqual(['m1', 'm1']);
  });

  it('do not run when cancelled, or when off', () => {
    const t = setup(undefined, [at1830]);
    t.tick(30 * 60_000 + 1000);
    const key = t.scheduler.view().countdowns[0]?.key ?? '';
    t.scheduler.cancel(key);
    t.tick(MACRO_COUNTDOWN_MS * 2);
    expect(t.ran).toEqual([]);
    t.macros[0] = {
      ...t.macros[0],
      id: 'm1',
      name: 'Placeholder idle start',
      schedules: [{ ...at1830, enabled: false }],
    };
    t.scheduler.refresh();
    t.tick(24 * 3600_000);
    expect(t.ran).toEqual([]);
  });

  it('never run a time late: before Drashti started, or missed by more than a minute', () => {
    const t = setup(new Date(2026, 9, 6, 18, 31).getTime(), [at1830]);
    t.tick(60_000);
    expect(t.scheduler.view().countdowns).toHaveLength(0);
    // A computer asleep through the next day's time wakes two minutes after it: not run.
    t.clock.now = new Date(2026, 9, 7, 18, 32).getTime();
    t.scheduler.check();
    t.tick(MACRO_COUNTDOWN_MS * 2);
    expect(t.ran).toEqual([]);
  });

  it('run on one date only, once', () => {
    const t = setup(undefined, [{ id: 's2', days: [], date: '2026-10-06', time: '18:45', enabled: true }]);
    t.tick(3 * 24 * 3600_000);
    expect(t.ran).toEqual(['m1']);
  });
});
