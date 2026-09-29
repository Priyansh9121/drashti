import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { MessageRepo } from './messages';

describe('message templates in the library', () => {
  it('keeps templates with how their fields are filled, and edits and removes them', () => {
    const repo = new MessageRepo(openDatabase(':memory:'));
    const car = repo.create({ name: 'Car', template: 'Car {plate} please move', fields: {} });
    const start = repo.create({
      name: 'Start',
      template: 'Sabha starts in {time}',
      fields: { time: { kind: 'timer', timerId: 't1' } },
    });
    expect(repo.list()).toEqual([
      { id: car, name: 'Car', template: 'Car {plate} please move', fields: {} },
      {
        id: start,
        name: 'Start',
        template: 'Sabha starts in {time}',
        fields: { time: { kind: 'timer', timerId: 't1' } },
      },
    ]);
    expect(repo.update(car, { name: 'Parking', template: 'Car {plate} please move now', fields: {} })).toBe(
      true,
    );
    expect(repo.list()[0]).toMatchObject({ name: 'Parking', template: 'Car {plate} please move now' });
    expect(repo.remove(start)).toBe(true);
    expect(repo.list()).toHaveLength(1);
  });
});
