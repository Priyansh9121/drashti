import { describe, expect, it } from 'vitest';
import type { ArtiFields, ArtiView } from '../../shared/arti';
import { openDatabase } from '../db/database';
import { ArtiRepo } from '../db/arti';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import { ArtiService } from './arti-service';

/* The arti at its time, on a fake clock (placeholder presentations only). */

/** A Wednesday in June, at this computer's local time: no clock change near it anywhere. */
const at = (day: number, hours: number, minutes = 0, seconds = 0) =>
  new Date(2026, 5, 17 + day, hours, minutes, seconds).getTime();

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const fields = (over: Partial<ArtiFields> = {}): ArtiFields => ({
  name: 'Placeholder evening arti',
  presentationId: 'arti',
  days: EVERY_DAY,
  date: null,
  time: '19:00',
  promptMinutes: 5,
  byItself: false,
  enabled: true,
  ...over,
});

function setup(start = at(0, 18, 50)) {
  const db = openDatabase(':memory:');
  db.exec(`INSERT OR IGNORE INTO libraries (id, name) VALUES ('l', 'Placeholder');
           INSERT INTO presentations (id, library_id, name) VALUES
             ('arti', 'l', 'Placeholder arti'), ('p1', 'l', 'Placeholder kirtan');`);
  const repo = new ArtiRepo(db);
  const source = makeSource();
  source.set('arti', [textSlide('a1', 'Placeholder arti one'), textSlide('a2', 'Placeholder arti two')]);
  let clock = start;
  const engine = new ShowEngine(source, new RecordingTransport(), () => clock);
  let pending: { due: number; run: () => void } | null = null;
  const views: ArtiView[] = [];
  const make = () =>
    new ArtiService({
      repo,
      engine: {
        state: () => engine.current,
        dispatch: (c) => engine.dispatch(c),
        onChange: (l) => engine.onChange(l),
      },
      now: () => clock,
      engineNow: () => clock,
      schedule: (ms, run) => {
        const timer = { due: clock + ms, run };
        pending = timer;
        return () => {
          if (pending === timer) pending = null;
        };
      },
      changed: (view) => views.push(view),
      log: () => undefined,
    });
  /** Move the clock on to `to`, running what was scheduled on the way. */
  const runTo = (to: number) => {
    for (let guard = 0; guard < 10_000; guard++) {
      const timer: { due: number; run: () => void } | null = pending;
      if (!timer || timer.due > to) break;
      pending = null;
      clock = Math.max(clock, timer.due);
      timer.run();
    }
    clock = to;
  };
  /** The clock jumps (the computer slept): nothing scheduled runs on the way. */
  const jump = (to: number) => {
    clock = to;
  };
  const service = make();
  return {
    db,
    engine,
    service,
    make,
    runTo,
    jump,
    views,
    prompt: () => views.at(-1)?.prompt ?? null,
  };
}

describe('ArtiService', () => {
  it('prompts its minutes before, cues the arti at its time, and puts it up when asked', () => {
    const t = setup();
    expect(t.service.save(null, fields())).toMatchObject({ ok: true });
    t.engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    t.runTo(at(0, 18, 54, 59));
    expect(t.prompt()).toBeNull();
    t.runTo(at(0, 18, 55));
    expect(t.prompt()).toMatchObject({
      name: 'Placeholder evening arti',
      presentationId: 'arti',
      at: at(0, 19),
      byItselfAt: null,
    });
    // Before its time it is not yet what Next shows.
    expect(t.engine.current.cue).toBeNull();
    t.runTo(at(0, 19));
    expect(t.engine.current.cue).toMatchObject({ presentationId: 'arti', label: 'Placeholder evening arti' });
    expect(t.engine.current.next).toMatchObject({ presentationId: 'arti', slideIndex: 0 });
    // It never went up by itself.
    expect(t.engine.current.live.presentationId).toBe('p1');
    const key = t.prompt()?.key ?? '';
    expect(t.service.putUp(key)).toEqual({ ok: true });
    expect(t.engine.current.live).toMatchObject({ presentationId: 'arti', slideIndex: 0 });
    expect(t.engine.current.cue).toBeNull();
    expect(t.prompt()).toBeNull();
    expect(t.service.putUp(key)).toEqual({ ok: false, message: 'That arti prompt has gone.' });
  });

  it('puts it up early when asked before its time', () => {
    const t = setup();
    t.service.save(null, fields());
    t.runTo(at(0, 18, 57));
    expect(t.service.putUp(t.prompt()?.key ?? '')).toEqual({ ok: true });
    expect(t.engine.current.live.presentationId).toBe('arti');
    t.runTo(at(0, 19, 1));
    expect(t.prompt()).toBeNull();
    expect(t.engine.current.cue).toBeNull();
  });

  it('Not now takes the prompt and the cue away until the next time', () => {
    const t = setup();
    t.service.save(null, fields());
    t.runTo(at(0, 19, 0, 30));
    expect(t.service.notNow(t.prompt()?.key ?? '')).toEqual({ ok: true });
    expect(t.prompt()).toBeNull();
    expect(t.engine.current.cue).toBeNull();
    expect(t.engine.current.next).toBeNull();
    t.runTo(at(1, 18, 54));
    expect(t.prompt()).toBeNull();
    t.runTo(at(1, 18, 55));
    expect(t.prompt()?.at).toBe(at(1, 19));
  });

  it('goes unanswered ten minutes after its time, and never goes up by itself unless the schedule says', () => {
    const t = setup();
    t.service.save(null, fields());
    t.runTo(at(0, 19, 9, 59));
    expect(t.prompt()).not.toBeNull();
    expect(t.engine.current.cue).not.toBeNull();
    t.runTo(at(0, 19, 10));
    expect(t.prompt()).toBeNull();
    expect(t.engine.current.cue).toBeNull();
    expect(t.engine.current.live.presentationId).toBeNull();
  });

  it('goes up by itself when the schedule says, after a ten-second countdown that Cancel stops', () => {
    const t = setup();
    t.service.save(null, fields({ byItself: true }));
    t.runTo(at(0, 19));
    expect(t.prompt()?.byItselfAt).toBe(at(0, 19, 0, 10));
    t.runTo(at(0, 19, 0, 9));
    expect(t.engine.current.live.presentationId).toBeNull();
    t.runTo(at(0, 19, 0, 10));
    expect(t.engine.current.live).toMatchObject({ presentationId: 'arti', slideIndex: 0 });
    expect(t.prompt()).toBeNull();
    // The next day (with something else up by then): cancelled, it waits for the operator.
    t.engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 0 });
    t.runTo(at(1, 19, 0, 4));
    const key = t.prompt()?.key ?? '';
    expect(t.service.cancel(key)).toEqual({ ok: true });
    expect(t.prompt()).toMatchObject({ key, byItselfAt: null });
    t.runTo(at(1, 19, 0, 30));
    expect(t.engine.current.live.presentationId).toBe('p1');
    expect(t.prompt()?.key).toBe(key);
  });

  it('does not go up by itself after the computer slept through its time; it asks', () => {
    const t = setup();
    t.service.save(null, fields({ byItself: true, promptMinutes: 0 }));
    // Asleep from 18:50 to 19:03: nothing ran on the way.
    t.jump(at(0, 19, 3));
    t.service.check();
    expect(t.prompt()).toMatchObject({ at: at(0, 19), byItselfAt: null });
    t.runTo(at(0, 19, 4));
    expect(t.engine.current.live.presentationId).toBeNull();
    expect(t.engine.current.cue).toMatchObject({ presentationId: 'arti' });
  });

  it('does not run a time late that passed while Drashti was closed', () => {
    const t = setup();
    t.service.save(null, fields({ byItself: true }));
    t.service.dispose();
    // Started again two minutes after its time.
    t.runTo(at(0, 19, 2));
    const again = t.make();
    again.check();
    expect(t.prompt()).toBeNull();
    expect(t.engine.current.cue).toBeNull();
    t.runTo(at(0, 19, 30));
    expect(t.engine.current.live.presentationId).toBeNull();
    // Its next time runs as usual.
    t.runTo(at(1, 18, 55));
    expect(t.prompt()?.at).toBe(at(1, 19));
    again.dispose();
  });

  it('ends the prompt when the arti goes up another way, and does not prompt while it is up', () => {
    const t = setup();
    t.service.save(null, fields());
    t.runTo(at(0, 19));
    // Next plays what is cued.
    t.engine.dispatch({ type: 'next' });
    expect(t.engine.current.live.presentationId).toBe('arti');
    expect(t.prompt()).toBeNull();
    // Up already when the next one's time comes: no prompt.
    t.service.save(null, fields({ time: '19:20', name: 'Placeholder second arti' }));
    t.runTo(at(0, 19, 21));
    expect(t.prompt()).toBeNull();
  });

  it('keeps to its days of the week, or its one date', () => {
    const t = setup();
    // 2026-06-17 is a Wednesday (3): only Thursdays, and one Saturday.
    t.service.save(null, fields({ days: [4], name: 'Placeholder Thursday arti' }));
    t.service.save(
      null,
      fields({ days: [], date: '2026-06-20', time: '07:00', name: 'Placeholder date arti' }),
    );
    t.runTo(at(0, 23));
    expect(t.views.some((v) => v.prompt !== null)).toBe(false);
    t.runTo(at(1, 18, 55));
    expect(t.prompt()?.name).toBe('Placeholder Thursday arti');
    t.service.notNow(t.prompt()?.key ?? '');
    t.runTo(at(3, 6, 55));
    expect(t.prompt()?.name).toBe('Placeholder date arti');
    const listed = t.service.view().schedules;
    expect(listed.map((s) => s.nextAt)).toEqual([at(8, 19), at(3, 7)]);
  });

  it('switched off or with its presentation removed, never prompts; the list says so', () => {
    const t = setup();
    const made = t.service.save(null, fields());
    if (!made.ok) throw new Error(made.message);
    t.service.setEnabled(made.id, false);
    t.runTo(at(0, 19, 1));
    expect(t.prompt()).toBeNull();
    expect(t.service.view().schedules[0]).toMatchObject({ enabled: false, nextAt: null });
    t.service.setEnabled(made.id, true);
    t.db.prepare("UPDATE presentations SET deleted_at = '2026-06-17T00:00:00Z' WHERE id = 'arti'").run();
    t.service.refresh();
    t.runTo(at(1, 19, 1));
    expect(t.prompt()).toBeNull();
    expect(t.service.view().schedules[0]).toMatchObject({ presentationName: null, nextAt: null });
  });

  it('a schedule changed while it prompts: the prompt follows it', () => {
    const t = setup();
    const made = t.service.save(null, fields());
    if (!made.ok) throw new Error(made.message);
    t.runTo(at(0, 19));
    expect(t.engine.current.cue).not.toBeNull();
    t.service.save(made.id, fields({ time: '20:00' }));
    t.runTo(at(0, 19, 0, 1));
    expect(t.prompt()).toBeNull();
    expect(t.engine.current.cue).toBeNull();
    t.runTo(at(0, 19, 55));
    expect(t.prompt()?.at).toBe(at(0, 20));
  });

  it('refuses a schedule that cannot run, saying why', () => {
    const t = setup();
    expect(t.service.save(null, fields({ days: [] }))).toEqual({
      ok: false,
      message: 'Choose the days of the week, or one date.',
    });
    expect(t.service.save(null, fields({ date: '2026-06-20' }))).toMatchObject({ ok: false });
    expect(t.service.save(null, fields({ time: '7pm' }))).toEqual({
      ok: false,
      message: 'Write the time as HH:MM, for example 19:00.',
    });
    expect(t.service.save(null, fields({ name: ' ' }))).toEqual({
      ok: false,
      message: 'Give it a name, for example “Evening arti”.',
    });
    expect(t.service.save(null, fields({ presentationId: 'nope' }))).toEqual({
      ok: false,
      message: 'That presentation is no longer in the library.',
    });
    expect(t.service.view().schedules).toEqual([]);
  });
});
