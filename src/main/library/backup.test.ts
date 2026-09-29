import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LATEST_VERSION, openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { applyPendingRestore, backupLibrary, checkBackup, LIBRARY_FILE, requestRestore } from './backup';

/* Placeholder names only. */

/** A data folder with a library holding one presentation of this name, and a media file. */
function dataFolder(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-backup-'));
  const db = openDatabase(join(dir, LIBRARY_FILE));
  const repo = new PresentationRepo(db);
  repo.insert({
    libraryId: repo.ensureLibrary('Default'),
    name,
    groups: [{ name: 'G', slides: [{ elements: [] }] }],
  });
  mkdirSync(join(dir, 'Media'));
  writeFileSync(join(dir, 'Media', `${name}.txt`), name);
  return { dir, db };
}

const names = (file: string) => {
  const db = openDatabase(file);
  const list = new PresentationRepo(db).list().map((p) => p.name);
  db.close();
  return list;
};

describe('backing up and restoring the library', () => {
  it('backs up a consistent copy of the library, with the media when asked', async () => {
    const { dir, db } = dataFolder('Placeholder One');
    const into = mkdtempSync(join(tmpdir(), 'drashti-backups-'));
    const now = new Date('2026-09-29T18:30:00.000Z');
    const withMedia = await backupLibrary(db, into, {
      mediaDir: join(dir, 'Media'),
      app: '1.0.0',
      schema: LATEST_VERSION,
      now,
    });
    expect(withMedia).toBe(join(into, 'Drashti backup 2026-09-29 18-30'));
    expect(names(join(withMedia, LIBRARY_FILE))).toEqual(['Placeholder One']);
    expect(readdirSync(join(withMedia, 'Media'))).toEqual(['Placeholder One.txt']);
    expect(JSON.parse(readFileSync(join(withMedia, 'backup.json'), 'utf8'))).toMatchObject({ media: true });
    const only = await backupLibrary(db, into, { mediaDir: null, app: '1.0.0', schema: LATEST_VERSION, now });
    expect(only).toBe(join(into, 'Drashti backup 2026-09-29 18-30 (2)'));
    expect(existsSync(join(only, 'Media'))).toBe(false);
    expect(checkBackup(only, LATEST_VERSION)).toEqual({ ok: true, media: false, schema: LATEST_VERSION });
    const newer = checkBackup(only, LATEST_VERSION - 1);
    expect(newer.ok ? '' : newer.message).toContain('newer Drashti');
    expect(checkBackup(into, LATEST_VERSION)).toMatchObject({ ok: false });
  });

  it('restores at the next start, keeping the current library as a backup of its own', async () => {
    const backup = dataFolder('Placeholder From Backup');
    const saved = await backupLibrary(backup.db, mkdtempSync(join(tmpdir(), 'drashti-backups-')), {
      mediaDir: join(backup.dir, 'Media'),
      app: '1.0.0',
      schema: LATEST_VERSION,
      now: new Date(),
    });
    const current = dataFolder('Placeholder Current');
    current.db.close();
    requestRestore(current.dir, saved);
    const outcome = applyPendingRestore(current.dir, LATEST_VERSION, new Date('2026-09-30T08:00:00.000Z'));
    expect(outcome).toMatchObject({ restored: true, media: true });
    expect(names(join(current.dir, LIBRARY_FILE))).toEqual(['Placeholder From Backup']);
    expect(readdirSync(join(current.dir, 'Media'))).toEqual(['Placeholder From Backup.txt']);
    const kept = join(current.dir, 'Backups', 'Before restore 2026-09-30 08-00');
    expect(names(join(kept, LIBRARY_FILE))).toEqual(['Placeholder Current']);
    expect(readdirSync(join(kept, 'Media'))).toEqual(['Placeholder Current.txt']);
    // Done once: the next start has nothing to do.
    expect(applyPendingRestore(current.dir, LATEST_VERSION, new Date())).toEqual({
      restored: false,
      message: null,
    });
  });

  it('leaves the library alone when the backup cannot be restored', () => {
    const current = dataFolder('Placeholder Current');
    current.db.close();
    requestRestore(current.dir, mkdtempSync(join(tmpdir(), 'drashti-not-a-backup-')));
    const outcome = applyPendingRestore(current.dir, LATEST_VERSION, new Date());
    expect(outcome.restored ? '' : outcome.message).toContain('not restored');
    expect(names(join(current.dir, LIBRARY_FILE))).toEqual(['Placeholder Current']);
  });
});
