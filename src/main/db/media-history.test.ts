import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { MediaRepo } from './media';

/* A file's plays in the library (alpha.20, migration 87): counted, the day, where to resume. Placeholder names. */

describe('a file’s plays in the library', () => {
  it('counts each play with its day, keeps and forgets where to resume, and says them in Media and its notes', () => {
    const db = openDatabase(':memory:');
    const media = new MediaRepo(db);
    db.prepare(
      "INSERT INTO media (id, kind, name, path, sha256) VALUES ('v', 'video', 'Placeholder katha.mp4', 'ab/v.mp4', 'ab')",
    ).run();
    expect(media.list()[0]).not.toHaveProperty('playCount');
    expect(media.list()[0]).not.toHaveProperty('lastPlayedAt');
    expect(media.about('v')).toMatchObject({ playCount: 0, lastPlayedAt: null });
    media.countPlay('v', '2026-11-20T12:00:00.000Z');
    media.countPlay('v', '2026-11-20T13:00:00.000Z');
    expect(media.list()[0]).toMatchObject({ playCount: 2, lastPlayedAt: '2026-11-20T13:00:00.000Z' });
    expect(media.about('v')).toMatchObject({ playCount: 2, lastPlayedAt: '2026-11-20T13:00:00.000Z' });
    expect(media.resumeOf('v')).toBeNull();
    media.keepResume('v', 360_000.4, '2026-11-20T13:06:00.000Z');
    expect(media.resumeOf('v')).toEqual({ atMs: 360_000, at: '2026-11-20T13:06:00.000Z' });
    media.forgetResume('v');
    expect(media.resumeOf('v')).toBeNull();
    expect(media.resumeOf('nothing')).toBeNull();
  });
});
