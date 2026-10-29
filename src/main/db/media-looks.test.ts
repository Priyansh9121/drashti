import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAIN } from '../../shared/picture-look';
import { MIGRATIONS, schemaVersion } from './migrate';
import { openDatabase } from './database';
import { MediaRepo } from './media';

/* A picture's look kept with the media item (Session 26e, migration 39). */

describe('a picture’s look in the library', () => {
  it('is kept with a picture, read back, and none when it changes nothing; never for a video', () => {
    const db = openDatabase(':memory:');
    const media = new MediaRepo(db);
    const add = db.prepare('INSERT INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)');
    add.run('p', 'image', 'Placeholder darshan.png', 'aa/p.png');
    add.run('v', 'video', 'Placeholder clip.mp4', 'bb/v.mp4');
    expect(media.look('p')).toBeNull();
    const look = { ...PLAIN, zoom: 2, x: 0.25, contrast: 0.2, sharpness: 0.4 };
    expect(media.setLook('p', look)).toBe(true);
    expect(media.look('p')).toEqual(look);
    expect(media.looks()).toEqual({ p: look });
    expect(media.setLook('v', look)).toBe(false);
    expect(media.look('v')).toBeNull();
    // A look that changes nothing is no look.
    expect(media.setLook('p', PLAIN)).toBe(true);
    expect(media.look('p')).toBeNull();
    expect(media.looks()).toEqual({});
    // Bad JSON is refused by the library itself.
    expect(() => db.prepare("UPDATE media SET look = 'not json' WHERE id = 'p'").run()).toThrow();
  });

  it('a version 38 library is upgraded with no picture changed', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'drashti-db-')), 'drashti.sqlite');
    const v38 = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version <= 38),
    );
    v38
      .prepare(
        "INSERT INTO media (id, kind, name, path) VALUES ('p', 'image', 'Placeholder.png', 'aa/p.png')",
      )
      .run();
    v38.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBeGreaterThanOrEqual(39);
    expect(db.prepare('SELECT id, look FROM media').all()).toEqual([{ id: 'p', look: null }]);
    db.close();
  });
});

describe('a picture’s crop, turn, flips and blurred fill (Session 55, Part 5)', () => {
  it('are kept with the picture, as the sharpened copy wants them; a photo has its fill by default, a deck’s page not', () => {
    const db = openDatabase(':memory:');
    const media = new MediaRepo(db);
    const add = db.prepare(
      "INSERT INTO media (id, kind, name, path, sha256, source_kind) VALUES (?, 'image', ?, ?, ?, ?)",
    );
    add.run('photo', 'Placeholder photo.jpg', 'aa/photo.jpg', 'aa'.repeat(32), 'media');
    add.run('page', 'Placeholder deck_1', 'bb/page.png', 'bb'.repeat(32), 'drashti');
    add.run('old', 'Placeholder old.png', 'cc/old.png', 'cc'.repeat(32), null);
    const size = { width: 4000, height: 3000 };
    const look = {
      ...PLAIN,
      sharpness: 0.5,
      turn: 90 as const,
      flipX: true,
      crop: { x: 0, y: 0, w: 0.5, h: 1 },
      size,
    };
    expect(media.setLook('photo', look)).toBe(true);
    expect(media.look('photo')).toEqual(look);
    expect(media.sharpenWants()).toEqual([
      { mediaId: 'photo', sha256: 'aa'.repeat(32), path: 'aa/photo.jpg', sharpness: 0.5, zoom: 1, look },
    ]);
    // The blurred fill switched off on a photo is kept; As it was taken leaves none.
    expect(media.setLook('photo', { ...PLAIN, fill: false })).toBe(true);
    expect(media.look('photo')).toEqual({ ...PLAIN, fill: false });
    expect(media.setLook('photo', PLAIN)).toBe(true);
    expect(media.look('photo')).toBeNull();
    expect(media.photoByDefault('photo')).toBe(true);
    expect(media.photoByDefault('old')).toBe(true);
    expect(media.photoByDefault('page')).toBe(false);
    expect(media.photoByDefault('nothing')).toBe(false);
  });
});
