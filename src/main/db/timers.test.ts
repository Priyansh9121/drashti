import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { TimerRepo } from './timers';

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
});
