import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOWER_THIRD_LOOK, type LowerThirdInput } from '../../shared/lower-thirds';
import { applyPendingRestore, backupLibrary, LIBRARY_FILE, requestRestore } from '../library/backup';
import { type Db, LATEST_VERSION, openDatabase } from './database';
import { LowerThirdRepo } from './lower-thirds';
import { alpha17LookColumn, alpha17LookOf } from './testing/alpha17-lower-third-look';

// v1.0.0-alpha.17: the last migration in src/main/db/migrate.ts.
const ALPHA17_SCHEMA = 82;
const modern = {
  lines: ['Placeholder name', 'Placeholder role'],
  look: {
    ...DEFAULT_LOWER_THIRD_LOOK,
    text: '#f7f7f7',
    band: '#252637',
    bandOpacity: 0.4,
    font: 'Hind',
    weight: 500,
    size: 6,
    align: 'right',
    bottom: 12,
    style: 'ribbon',
    accent: '#ff9900',
    motion: 'stars',
  },
  where: 'stream',
  animation: 'reveal-up-steady',
  outAnimation: 'blinds-quick',
  seconds: 15,
} satisfies LowerThirdInput;
const fallback = { ...modern, look: { ...modern.look, motion: 'sparkles' } } satisfies LowerThirdInput;

function alpha17Read(db: Db, id: string) {
  const json = db.prepare<[string], string>('SELECT look FROM lower_thirds WHERE id = ?').pluck().get(id);
  if (json === undefined) throw new Error('Expected a saved lower third');
  return alpha17LookOf(json);
}

function alpha17Update(db: Db, id: string, input: LowerThirdInput): void {
  db.prepare('UPDATE lower_thirds SET lines = ?, look = ?, target = ?, animation = ? WHERE id = ?').run(
    JSON.stringify(input.lines),
    alpha17LookColumn(input),
    input.where,
    input.animation,
    id,
  );
}

describe('lower-third backgrounds across alpha.17 and alpha.18', () => {
  let db: Db;
  let repo: LowerThirdRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new LowerThirdRepo(db);
  });
  afterEach(() => db.close());

  it.each(['create', 'update'] as const)('%s keeps the new background and the alpha.17 look', (operation) => {
    const id = repo.create(operation === 'create' ? modern : fallback);
    if (operation === 'update') expect(repo.update(id, modern)).toBe(true);

    expect(alpha17Read(db, id)).toEqual({
      look: fallback.look,
      outAnimation: fallback.outAnimation,
      seconds: fallback.seconds,
    });
    expect(repo.get(id)).toEqual({ id, ...modern });
    expect(repo.list()).toEqual([{ id, ...modern }]);
  });

  it('brings back the new background with the other changes made in alpha.17', () => {
    const id = repo.create(modern);
    const older = alpha17Read(db, id);
    const edit: LowerThirdInput = {
      ...fallback,
      ...older,
      lines: ['Placeholder edited'],
      look: { ...older.look, bottom: 3, accent: '#306080' },
      seconds: 20,
    };
    alpha17Update(db, id, edit);
    expect(repo.get(id)).toEqual({ id, ...edit, look: { ...edit.look, motion: 'stars' } });
  });

  it.each(['stripes', 'none'] as const)('keeps the background changed to %s in alpha.17', (motion) => {
    const id = repo.create(modern);
    const edit = { ...fallback, look: { ...fallback.look, motion } };
    alpha17Update(db, id, edit);

    expect(repo.get(id)).toEqual({ id, ...edit });
    // The next alpha.18 start forgets the old pairing. Selecting the fallback on a later trip stays selected.
    repo.purge();
    alpha17Update(db, id, fallback);
    expect(repo.get(id)).toEqual({ id, ...fallback });
  });

  it('keeps an explicit change to the fallback made in alpha.18', () => {
    const id = repo.create(modern);
    expect(repo.update(id, fallback)).toBe(true);
    expect(repo.get(id)).toEqual({ id, ...fallback });
  });

  it('keeps both backgrounds through a library backup and restore at alpha.17’s schema version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-lower-thirds-backup-'));
    const library = openDatabase(join(dir, LIBRARY_FILE));
    try {
      const id = new LowerThirdRepo(library).create(modern);
      const now = new Date(2026, 10, 14, 12);
      expect(LATEST_VERSION).toBe(ALPHA17_SCHEMA);
      const { folder } = await backupLibrary(library, dir, {
        mediaDir: null,
        schema: LATEST_VERSION,
        app: '1.0.0-alpha.18',
        now,
      });
      const restored = join(dir, 'restored');
      mkdirSync(restored);
      requestRestore(restored, folder);
      expect(
        applyPendingRestore(restored, { schema: ALPHA17_SCHEMA, app: '1.0.0-alpha.17', now }),
      ).toMatchObject({ restored: true });

      const reopened = openDatabase(join(restored, LIBRARY_FILE));
      try {
        expect(alpha17Read(reopened, id)).toEqual({
          look: fallback.look,
          outAnimation: fallback.outAnimation,
          seconds: fallback.seconds,
        });
        expect(new LowerThirdRepo(reopened).get(id)).toEqual({ id, ...modern });
      } finally {
        reopened.close();
      }
    } finally {
      library.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
