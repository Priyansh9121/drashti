import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { TimerRepo } from './timers';
import { DEFAULT_TIMER_LOOK } from '../../shared/timer-look';

describe('timers in the library', () => {
  it('keeps the timers the operator makes, in order, and edits and removes them', () => {
    const repo = new TimerRepo(openDatabase(':memory:'));
    const a = repo.create({
      name: 'Placeholder countdown',
      kind: 'countdown',
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    });
    const b = repo.create({
      name: 'Placeholder start time',
      kind: 'countdown_to_time',
      durationMs: 0,
      targetTime: '19:30',
      allowsOverrun: true,
    });
    expect(repo.list().map((t) => [t.id, t.kind, t.durationMs, t.targetTime, t.allowsOverrun])).toEqual([
      [a, 'countdown', 300_000, null, false],
      [b, 'countdown_to_time', 0, '19:30', true],
    ]);
    expect(
      repo.update(a, {
        name: 'Renamed',
        kind: 'countup',
        durationMs: 0,
        targetTime: null,
        allowsOverrun: false,
      }),
    ).toBe(true);
    expect(repo.list()[0]).toMatchObject({ name: 'Renamed', kind: 'countup' });
    expect(repo.remove(b)).toBe(true);
    expect(repo.remove(b)).toBe(false);
    expect(repo.list()).toHaveLength(1);
  });

  it('keeps each timer’s look for the audience (Session 55), through an edit that leaves it out, and not after', () => {
    const repo = new TimerRepo(openDatabase(':memory:'));
    const look = { ...DEFAULT_TIMER_LOOK, place: 'top-right' as const, label: 'Placeholder ends in' };
    const fields = {
      name: 'Placeholder activity',
      kind: 'countdown' as const,
      durationMs: 300_000,
      targetTime: null,
      allowsOverrun: false,
    };
    const a = repo.create({ ...fields, look });
    const b = repo.create(fields);
    expect(repo.list().map((t) => t.look)).toEqual([look, undefined]);
    repo.update(a, { ...fields, name: 'Renamed' });
    expect(repo.list()[0]).toMatchObject({ name: 'Renamed', look });
    repo.update(a, { ...fields, look: { ...look, place: 'full' } });
    expect(repo.list()[0]?.look?.place).toBe('full');
    repo.remove(a);
    expect(repo.list().map((t) => t.id)).toEqual([b]);
    // A timer made again later with nothing of the removed one's look.
    const c = repo.create(fields);
    expect(repo.list().find((t) => t.id === c)?.look).toBeUndefined();
  });
});
