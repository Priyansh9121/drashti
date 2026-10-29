import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';
import { SoundRepo } from './sound';
import type { Db } from './database';

/*
 * Even loudness in the library (Session 55, Part 7; migration 51): what the sound pass measured of each video's and
 * sound's bytes, and each file's own switch. An alpha.13 library (schema 49) gains both, nothing measured and every
 * file on. Made-up names and hashes only.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-sound-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function addMedia(
  db: Db,
  id: string,
  kind: 'image' | 'video' | 'audio',
  more: Record<string, unknown> = {},
): void {
  const row = { path: `${id}.bin`, sha256: `sha-${id}`, missing: 0, duration_ms: null, ...more };
  db.prepare(
    `INSERT INTO media (id, kind, name, path, sha256, missing, duration_ms, source_kind, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'media', ?)`,
  ).run(id, kind, `Placeholder ${id}`, row.path, row.sha256, row.missing, row.duration_ms, `/import/${id}`);
}

describe('even loudness in the library (migration 51)', () => {
  it('upgrades an alpha.13 library: nothing measured, every file on, everything else as it was', () => {
    const file = join(dir, 'library.sqlite');
    const v49 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 49),
    );
    addMedia(v49, 'talk', 'video', { duration_ms: 61_000 });
    v49.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(
      db.prepare('SELECT duration_ms, loudness, even_loudness FROM media WHERE id = ?').get('talk'),
    ).toEqual({
      duration_ms: 61_000,
      loudness: null,
      even_loudness: 1,
    });
    const repo = new SoundRepo(db);
    expect(repo.toMeasure().map((f) => f.id)).toEqual(['talk']);
    expect(repo.soundOf('talk')).toEqual({ loudness: null, even: true, gain: 1, silent: false });
    db.close();
  });

  it('measures each video’s and sound’s bytes once, again when the bytes change, never a picture or a missing file', () => {
    const db = openDatabase(':memory:');
    addMedia(db, 'music', 'audio');
    addMedia(db, 'talk', 'video', { duration_ms: 5000 });
    addMedia(db, 'photo', 'image');
    addMedia(db, 'gone', 'video', { missing: 1, path: '' });
    const repo = new SoundRepo(db);
    expect(repo.toMeasure().map((f) => f.id)).toEqual(['music', 'talk']);
    expect(repo.toMeasure(['talk', 'photo'])).toEqual([
      { id: 'talk', kind: 'video', path: 'talk.bin', sha256: 'sha-talk', durationMs: 5000 },
    ]);
    // Loud music: it comes down to the even level; a talk with no sound track: none.
    expect(repo.saveMeasured('music', 'sha-music', { lufs: -9.04, peak: -0.13 })).toBe(true);
    expect(repo.saveMeasured('talk', 'sha-talk', { lufs: null, peak: null })).toBe(true);
    expect(repo.toMeasure()).toEqual([]);
    expect(repo.soundOf('music')).toEqual({
      loudness: { lufs: -9, peak: -0.1 },
      even: true,
      gain: 0.447,
      silent: false,
    });
    expect(repo.soundOf('talk')).toMatchObject({ gain: 1, silent: true });
    expect(repo.soundOf('photo')).toBeNull();
    // Other bytes since (a file found again): measured again, and played as it is meanwhile.
    db.prepare("UPDATE media SET sha256 = 'sha-new' WHERE id = 'music'").run();
    expect(repo.toMeasure().map((f) => f.id)).toEqual(['music']);
    expect(repo.soundOf('music')).toMatchObject({ loudness: null, gain: 1 });
    // A result for bytes no longer there is not kept.
    expect(repo.saveMeasured('music', 'sha-music', { lufs: -20, peak: -3 })).toBe(false);
    // One that could not be read is not read again, and plays as it is.
    expect(repo.saveMeasured('music', 'sha-new', 'failed')).toBe(true);
    expect(repo.toMeasure()).toEqual([]);
    expect(repo.soundOf('music')).toMatchObject({ loudness: null, gain: 1, silent: false });
    db.close();
  });

  it('a file’s own switch plays it as it is; a length read is kept only where none was', () => {
    const db = openDatabase(':memory:');
    addMedia(db, 'music', 'audio');
    addMedia(db, 'photo', 'image');
    const repo = new SoundRepo(db);
    repo.saveMeasured('music', 'sha-music', { lufs: -26, peak: -12 });
    expect(repo.soundOf('music')?.gain).toBe(3.162);
    expect(repo.setEven('music', false)).toBe(true);
    expect(repo.soundOf('music')).toMatchObject({ even: false, gain: 1 });
    expect(repo.evenOff()).toEqual(['music']);
    expect(repo.setEven('photo', false)).toBe(false);
    repo.setEven('music', true);
    expect(repo.evenOff()).toEqual([]);
    expect(repo.keepLength('music', 4000)).toBe(true);
    expect(repo.keepLength('music', 4100)).toBe(false);
    expect(repo.keepLength('photo', 4000)).toBe(false);
    expect(db.prepare("SELECT duration_ms FROM media WHERE id = 'music'").get()).toEqual({
      duration_ms: 4000,
    });
    db.close();
  });
});
