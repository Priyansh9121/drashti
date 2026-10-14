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
