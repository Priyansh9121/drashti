import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WALLPAPER_FADE_DEFAULT_MS, WALLPAPER_SECONDS_DEFAULT } from '../../shared/wallpapers';
import type { Db } from './database';
import { openDatabase } from './database';
import { MIGRATIONS, schemaVersion } from './migrate';
import { WallpaperRepo } from './wallpapers';

/*
 * Wallpapers in the library (migration 50, Session 55, Part 6): each its name, its pictures in order and how they go
 * round, in the list's order; renamed; deleted with Undo until the next start; pictures deleted from the library left
 * out. And a row's When it ends (playlist_items.when_ends). An older library gains both empty. Placeholder names.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-wallpapers-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function picture(db: Db, id: string, name: string, kind = 'image'): void {
  db.prepare('INSERT INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)').run(id, kind, name, `ab/${id}`);
}

describe('wallpapers in the library', () => {
  it('keeps each with its pictures in order, in the list’s order; renames; deletes with Undo until the next start', () => {
    const db = openDatabase(':memory:');
    picture(db, 'blue', 'Placeholder blue.png');
    picture(db, 'green', 'Placeholder green.png');
    const repo = new WallpaperRepo(db);
    const a = repo.create('Placeholder blue', ['blue']);
    const b = repo.create('Placeholder green', ['green', 'blue']);
    expect(repo.list().map((w) => [w.name, w.pictures.map((p) => p.mediaId)])).toEqual([
      ['Placeholder blue', ['blue']],
      ['Placeholder green', ['green', 'blue']],
    ]);
    // Made with Drashti's own timing.
    expect(repo.get(a)).toMatchObject({
      secondsEach: WALLPAPER_SECONDS_DEFAULT,
      fadeMs: WALLPAPER_FADE_DEFAULT_MS,
      pictures: [{ mediaId: 'blue', name: 'Placeholder blue.png', missing: false }],
    });
    expect(repo.rename(b, 'Placeholder evening')).toBe(true);
    expect(repo.get(b)?.name).toBe('Placeholder evening');
    expect(repo.setTiming(b, { secondsEach: 4, fadeMs: 500 })).toBe(true);
    expect(repo.setPictures(b, ['blue', 'green', 'blue'])).toBe(true);
    expect(repo.get(b)).toMatchObject({ secondsEach: 4, fadeMs: 500 });
    expect(repo.get(b)?.pictures.map((p) => p.mediaId)).toEqual(['blue', 'green', 'blue']);
    // Deleted: out of the list; Undo brings it back in its place.
    expect(repo.remove(a)).toBe(true);
    expect(repo.list().map((w) => w.id)).toEqual([b]);
    expect(repo.get(a)).toBeNull();
    expect(repo.rename(a, 'Placeholder')).toBe(false);
    expect(repo.restore(a)).toBe(true);
    expect(repo.list().map((w) => w.id)).toEqual([a, b]);
    // Deleted before a start: gone for good.
    repo.remove(a);
    repo.purge();
    expect(repo.restore(a)).toBe(false);
    expect(repo.list().map((w) => w.id)).toEqual([b]);
  });

  it('says a picture deleted from the library is missing, and its files for the nodes are the pictures still there', () => {
    const db = openDatabase(':memory:');
    picture(db, 'blue', 'Placeholder blue.png');
    picture(db, 'green', 'Placeholder green.png');
    const repo = new WallpaperRepo(db);
    const id = repo.create('Placeholder pair', ['blue', 'green']);
    db.prepare("UPDATE media SET deleted_at = '2026-10-30T07:00:00.000Z' WHERE id = 'green'").run();
    expect(repo.get(id)?.pictures).toEqual([
      { mediaId: 'blue', name: 'Placeholder blue.png', missing: false },
      { mediaId: 'green', name: 'Placeholder green.png', missing: true },
    ]);
    expect(repo.pictureIds()).toEqual(['blue']);
    // Used by a wallpaper: the media's uses say which.
    expect(repo.usedBy('blue')).toEqual(['Placeholder pair']);
    expect(repo.usedBy('none')).toEqual([]);
  });

  it('an alpha.13 library (49) gains the wallpapers empty, and its playlist rows When it ends left to the default', () => {
    const file = join(dir, 'library.sqlite');
    const db = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 49),
    );
    expect(schemaVersion(db)).toBe(49);
    picture(db, 'clip', 'Placeholder clip.mp4', 'video');
    db.prepare("INSERT INTO playlists (id, name) VALUES ('sunday', 'Placeholder Sunday')").run();
    db.prepare(
      "INSERT INTO playlist_items (id, playlist_id, position, kind, media_id, label) VALUES ('i1', 'sunday', 0, 'media', 'clip', 'Placeholder clip.mp4')",
    ).run();
    db.close();
    const again = openDatabase(file);
    expect(schemaVersion(again)).toBeGreaterThanOrEqual(50);
    expect(new WallpaperRepo(again).list()).toEqual([]);
    expect(
      again.prepare("SELECT name FROM pragma_table_info('playlist_items') WHERE name = 'when_ends'").get(),
    ).toEqual({ name: 'when_ends' });
    expect(again.prepare("SELECT when_ends FROM playlist_items WHERE id = 'i1'").get()).toEqual({
      when_ends: null,
    });
    again.close();
  });
});
