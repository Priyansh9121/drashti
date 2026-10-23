import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { MediaRepo } from './media';

/*
 * A media item as a slide's background cue reads it (Session 52): what a Shastra passage's theme background is made
 * from, as db/presentations.ts reads a slide's own cue. Placeholder names only.
 */

describe('a media item as a background cue reads it', () => {
  it('names a missing or deleted file and says it is missing, says what one Drashti cannot play is, and none for no item', () => {
    const db = openDatabase(':memory:');
    const media = new MediaRepo(db);
    const add = db.prepare(
      'INSERT INTO media (id, kind, name, path, missing, playable, format, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    add.run('here', 'image', 'Placeholder here.png', 'aa/here.png', 0, 1, null, null);
    // Not found at import (its path empty), deleted from the library (until Undo), one Drashti cannot play.
    add.run('gone', 'image', 'Placeholder gone.png', '', 1, null, null, null);
    add.run(
      'deleted',
      'video',
      'Placeholder deleted.mp4',
      'bb/deleted.mp4',
      0,
      1,
      null,
      '2026-10-23T08:00:00.000Z',
    );
    add.run('prores', 'video', 'Placeholder ProRes.mov', 'cc/prores.mov', 0, 0, 'ProRes video', null);
    expect(media.asCue('here')).toEqual({ name: 'Placeholder here.png', missing: false, unplayable: null });
    expect(media.asCue('gone')).toEqual({ name: 'Placeholder gone.png', missing: true, unplayable: null });
    expect(media.asCue('deleted')).toEqual({
      name: 'Placeholder deleted.mp4',
      missing: true,
      unplayable: null,
    });
    expect(media.asCue('prores')).toEqual({
      name: 'Placeholder ProRes.mov',
      missing: false,
      unplayable: 'ProRes video',
    });
    expect(media.asCue('none')).toBeNull();
  });
});
