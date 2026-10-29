import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { MessageRepo } from './messages';
import { DEFAULT_MESSAGE_LOOK } from '../../shared/message-look';

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

  it('keeps a message’s own look and its time up (Session 55); an older library’s reads as the standard', () => {
    const db = openDatabase(':memory:');
    const repo = new MessageRepo(db);
    const look = {
      ...DEFAULT_MESSAGE_LOOK,
      place: { row: 'top', column: 'right' } as const,
      behind: 'box' as const,
    };
    const own = repo.create({ name: 'Own', template: 'Placeholder words', fields: {}, look, seconds: 30 });
    // The standard look is kept as none.
    const plain = repo.create({
      name: 'Plain',
      template: 'Placeholder',
      fields: {},
      look: DEFAULT_MESSAGE_LOOK,
    });
    // An older library's row: fields only, and one whose look cannot be read.
    db.prepare(
      "INSERT INTO messages (id, name, template, definition) VALUES ('old', 'Old', 'Placeholder', ?)",
    ).run(JSON.stringify({ fields: {} }));
    db.prepare(
      "INSERT INTO messages (id, name, template, definition) VALUES ('odd', 'Odd', 'Placeholder', ?)",
    ).run(JSON.stringify({ fields: {}, look: { place: 'nowhere' }, seconds: 'soon' }));
    expect(repo.list()).toEqual([
      { id: own, name: 'Own', template: 'Placeholder words', fields: {}, look, seconds: 30 },
      { id: plain, name: 'Plain', template: 'Placeholder', fields: {} },
      { id: 'old', name: 'Old', template: 'Placeholder', fields: {} },
      { id: 'odd', name: 'Odd', template: 'Placeholder', fields: {} },
    ]);
    // Undo: a change put back, and a removal brought back by its id.
    const was = repo.get(own);
    expect(was).not.toBeNull();
    repo.update(own, { name: 'Own', template: 'Changed', fields: {} });
    if (was) repo.put(was);
    expect(repo.get(own)).toEqual(was);
    repo.remove(own);
    if (was) repo.put(was);
    expect(repo.list().map((t) => t.id)).toContain(own);
  });
});
