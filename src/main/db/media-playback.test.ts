import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_PLAYBACK_SETTINGS } from '../../shared/playback-settings';
import { openDatabase } from './database';
import { MediaRepo } from './media';
import { MIGRATIONS, schemaVersion } from './migrate';

/* Sound and picture… (alpha.20, migration 89): a video's or a sound's own playback settings in the library. */

describe('a file’s playback settings in the library', () => {
  it('are kept with a video or a sound, read back, and none when they change nothing; never for a picture', () => {
    const db = openDatabase(':memory:');
    const media = new MediaRepo(db);
    const add = db.prepare('INSERT INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)');
    add.run('v', 'video', 'Placeholder clip.mp4', 'aa/v.mp4');
    add.run('s', 'audio', 'Placeholder tone.m4a', 'bb/s.m4a');
    add.run('p', 'image', 'Placeholder picture.png', 'cc/p.png');
    expect(media.playbackOf('v')).toEqual(NO_PLAYBACK_SETTINGS);
    const settings = { bassDb: 6, trebleDb: -3, voice: true, soundDelayMs: 200, captionDelayMs: -500 };
    expect(media.setPlayback('v', settings)).toBe(true);
    expect(media.playbackOf('v')).toEqual(settings);
    expect(media.setPlayback('s', { ...NO_PLAYBACK_SETTINGS, trebleDb: 12 })).toBe(true);
    expect(media.playbackOf('s').trebleDb).toBe(12);
    expect(media.setPlayback('p', settings)).toBe(false);
    expect(media.playbackOf('p')).toEqual(NO_PLAYBACK_SETTINGS);
    // Settings that change nothing are none.
    expect(media.setPlayback('v', NO_PLAYBACK_SETTINGS)).toBe(true);
    expect(db.prepare("SELECT playback FROM media WHERE id = 'v'").get()).toEqual({ playback: null });
    // Bad JSON is refused by the library itself; an unknown id has none.
    expect(() => db.prepare("UPDATE media SET playback = 'not json' WHERE id = 'v'").run()).toThrow();
    expect(media.playbackOf('nothing')).toEqual(NO_PLAYBACK_SETTINGS);
  });

  it('an older library gains the column, every file with no tone and no delays', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'drashti-db-')), 'drashti.sqlite');
    const older = openDatabase(
      file,
      MIGRATIONS.filter((m) => m.version < 89),
    );
    older
      .prepare(
        "INSERT INTO media (id, kind, name, path) VALUES ('v', 'video', 'Placeholder.mp4', 'aa/v.mp4')",
      )
      .run();
    older.close();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBeGreaterThanOrEqual(89);
    expect(db.prepare('SELECT id, playback FROM media').all()).toEqual([{ id: 'v', playback: null }]);
    expect(new MediaRepo(db).playbackOf('v')).toEqual(NO_PLAYBACK_SETTINGS);
    db.close();
  });
});
