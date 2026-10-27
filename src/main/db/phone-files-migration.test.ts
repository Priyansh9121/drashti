import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './database';
import { MediaRepo } from './media';
import { LATEST_VERSION, MIGRATIONS, schemaVersion } from './migrate';
import { PlaylistRepo } from './playlists';
import { PresentationRepo } from './presentations';

/*
 * Files between Drashti and its phones (Session 54, migration 52): an alpha.12 library (schema 47, as its backups
 * hold it too) comes through whole, nothing shared and nothing from a phone, and can then share a playlist and
 * mark what a phone added. Placeholder content only.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-phone-files-migration-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** An alpha.12 library: a playlist with a presentation and a video, as that version wrote them. */
function alpha12Library(file: string): Db {
  const db = openDatabase(
    file,
    MIGRATIONS.filter((m) => m.version <= 47),
  );
  expect(schemaVersion(db)).toBe(47);
  const presentations = new PresentationRepo(db);
  const hymn = presentations.insert({
    libraryId: presentations.ensureLibrary('Default'),
    name: 'Placeholder hymn',
    groups: [{ name: 'Verse', slides: [{ elements: [] }] }],
  });
  db.prepare(
    "INSERT INTO media (id, kind, name, path) VALUES ('clip', 'video', 'Placeholder clip.mp4', 'ab/clip.mp4')",
  ).run();
  db.prepare(
    "INSERT INTO playlists (id, name, updated_at) VALUES ('sunday', 'Placeholder Sunday', '2026-01-02T03:04:05.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, label) VALUES ('i1', 'sunday', 0, 'presentation', ?, 'Placeholder hymn')",
  ).run(hymn);
  db.prepare(
    "INSERT INTO playlist_items (id, playlist_id, position, kind, media_id, label) VALUES ('i2', 'sunday', 1, 'media', 'clip', 'Placeholder clip.mp4')",
  ).run();
  return db;
}

describe('migration 52: files between Drashti and its phones', () => {
  it('an alpha.12 library comes through whole: nothing shared, nothing from a phone', () => {
    const file = join(dir, 'drashti.sqlite');
    const before = alpha12Library(file);
    const stamps = before.prepare('SELECT id, updated_at FROM playlists').all();
    before.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    const playlists = new PlaylistRepo(db);
    expect(playlists.tree().map((n) => [n.name, n.itemCount, n.shared])).toEqual([
      ['Placeholder Sunday', 2, undefined],
    ]);
    expect(playlists.itemsOf('sunday').map((i) => [i.label, 'fromDevice' in i])).toEqual([
      ['Placeholder hymn', false],
      ['Placeholder clip.mp4', false],
    ]);
    expect(new MediaRepo(db).list().map((m) => [m.name, m.fromDevice])).toEqual([
      ['Placeholder clip.mp4', undefined],
    ]);
    expect(db.prepare('SELECT id, updated_at FROM playlists').all()).toEqual(stamps);
    // Then it shares a playlist, and marks what a phone added.
    expect(playlists.setShared('sunday', true)).toBe(true);
    db.prepare("UPDATE media SET from_device = 'Placeholder phone' WHERE id = 'clip'").run();
    expect(playlists.sharedPlaylists().map((p) => p.name)).toEqual(['Placeholder Sunday']);
    expect(playlists.itemsOf('sunday').at(1)).toMatchObject({ fromDevice: 'Placeholder phone' });
    db.close();
  });
});
