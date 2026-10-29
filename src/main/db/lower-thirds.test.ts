import { describe, expect, it } from 'vitest';
import type { LowerThirdInput } from '../../shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../shared/lower-thirds';
import { openDatabase } from './database';
import { LowerThirdRepo } from './lower-thirds';

/* Lower Thirds in the library (migration 45, Session 44): kept in order, changed, deleted with Undo, gone for good at the next start. */

const input = (name: string): LowerThirdInput => ({
  lines: [name, 'Placeholder title', ''],
  look: { ...DEFAULT_LOWER_THIRD_LOOK, align: 'centre' },
  where: 'hall',
  animation: 'wipe-up-quick',
});

describe('lower thirds in the library', () => {
  it('keeps them in order, changes one, and deletes several with Undo until the next start', () => {
    const db = openDatabase(':memory:');
    const repo = new LowerThirdRepo(db);
    const a = repo.create(input('Placeholder one'));
    const b = repo.create(input('Placeholder two'));
    const c = repo.create(input('Placeholder three'));
    expect(repo.list().map((l) => l.lines[0])).toEqual([
      'Placeholder one',
      'Placeholder two',
      'Placeholder three',
    ]);
    expect(repo.get(a)).toEqual({ id: a, ...input('Placeholder one') });
    expect(repo.update(b, { ...input('Placeholder two, changed'), where: 'stream' })).toBe(true);
    expect(repo.get(b)).toMatchObject({
      lines: ['Placeholder two, changed', 'Placeholder title', ''],
      where: 'stream',
    });
    // Two at once; Undo brings both back, in their places.
    expect(repo.remove([a, c, 'no-such'])).toEqual([a, c]);
    expect(repo.list().map((l) => l.id)).toEqual([b]);
    expect(repo.get(a)).toBeNull();
    expect(repo.update(a, input('Placeholder'))).toBe(false);
    expect(repo.restore([a, c]).sort()).toEqual([a, c].sort());
    expect(repo.list().map((l) => l.id)).toEqual([a, b, c]);
    // Deleted before a start: gone for good.
    repo.remove([c]);
    repo.purge();
    expect(repo.restore([c])).toEqual([]);
    expect(repo.list().map((l) => l.id)).toEqual([a, b]);
  });

  it('reads a look or lines it cannot understand as the defaults, so one bad row never hides the rest', () => {
    const db = openDatabase(':memory:');
    const repo = new LowerThirdRepo(db);
    const id = repo.create(input('Placeholder'));
    db.prepare("UPDATE lower_thirds SET look = '{\"text\":1}', lines = '[]' WHERE id = ?").run(id);
    expect(repo.get(id)).toMatchObject({ lines: [''], look: DEFAULT_LOWER_THIRD_LOOK });
  });

  it('keeps the studio’s choices (Session 55, Part 16): a style, an accent, a moving background, a font, an out of its own and the seconds it stays up', () => {
    const db = openDatabase(':memory:');
    const repo = new LowerThirdRepo(db);
    const made: LowerThirdInput = {
      ...input('Placeholder studio'),
      look: {
        ...DEFAULT_LOWER_THIRD_LOOK,
        style: 'ribbon',
        accent: '#ff9900',
        motion: 'sweep',
        font: 'Hind',
      },
      animation: 'reveal-up-steady',
      outAnimation: 'blinds-quick',
      seconds: 15,
    };
    const id = repo.create(made);
    expect(repo.get(id)).toEqual({ id, ...made });
    // Changed back to one that stays until hidden, going out as it came in.
    const plain: LowerThirdInput = { ...input('Placeholder studio'), look: made.look };
    expect(repo.update(id, plain)).toBe(true);
    expect(repo.get(id)).toEqual({ id, ...plain });
    expect(repo.get(id)).not.toHaveProperty('seconds');
    expect(repo.get(id)).not.toHaveProperty('outAnimation');
  });

  it('reads a lower third kept before the studio as it was: no style, no seconds, its out its in played backwards', () => {
    const db = openDatabase(':memory:');
    const repo = new LowerThirdRepo(db);
    const id = repo.create(input('Placeholder'));
    // As an older Drashti kept it: the look's own fields only.
    db.prepare('UPDATE lower_thirds SET look = ? WHERE id = ?').run(
      JSON.stringify({ ...DEFAULT_LOWER_THIRD_LOOK, align: 'centre' }),
      id,
    );
    const read = repo.get(id);
    expect(read).toEqual({ id, ...input('Placeholder') });
    expect(read?.look.style).toBeUndefined();
    // Seconds or an out it cannot use are left out, the rest kept.
    db.prepare('UPDATE lower_thirds SET look = ? WHERE id = ?').run(
      JSON.stringify({ ...DEFAULT_LOWER_THIRD_LOOK, style: 'pill', seconds: 400, outAnimation: 'no-such' }),
      id,
    );
    expect(repo.get(id)).toEqual({
      id,
      ...input('Placeholder'),
      look: { ...DEFAULT_LOWER_THIRD_LOOK, style: 'pill' },
    });
  });
});

