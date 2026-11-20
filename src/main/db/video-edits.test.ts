import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { VideoEditsRepo } from './video-edits';
import { PLAIN_VIDEO_EDIT } from '../../shared/video-edit';

function fixture() {
  const db = openDatabase(':memory:');
  db.prepare(
    "INSERT INTO media (id,kind,name,path,markers,playback) VALUES ('video','video','Placeholder.mp4','aa/source.mp4',?,?)",
  ).run(
    JSON.stringify({ startMs: 100, endMs: 5000, markers: [] }),
    JSON.stringify({ bassDb: 3, trebleDb: 0, voice: false, soundDelayMs: 0, captionDelayMs: 0 }),
  );
  return { db, repo: new VideoEditsRepo(db) };
}

describe('versioned video edits in the library', () => {
  it('an existing ready video starts plain and the original identity is never rewritten by Save', () => {
    const { db, repo } = fixture();
    expect(repo.read('video')).toMatchObject({
      revision: 0,
      state: 'ready',
      readyMediaId: 'video',
      recipe: PLAIN_VIDEO_EDIT,
    });
    const before = db.prepare("SELECT path,markers,playback FROM media WHERE id='video'").get();
    const recipe = { ...PLAIN_VIDEO_EDIT, picture: { ...PLAIN_VIDEO_EDIT.picture, zoom: 2 } };
    expect(repo.save({ mediaId: 'video', revision: 0, recipe })).toMatchObject({
      ok: true,
      edit: { revision: 1, state: 'preparing', readyMediaId: null, recipe },
    });
    expect(db.prepare("SELECT path,markers,playback FROM media WHERE id='video'").get()).toEqual(before);
    expect(repo.read('video')).toMatchObject({ revision: 1, recipe });
    db.close();
  });

  it('a stale editor and a stale preparation cannot replace newer work', () => {
    const { db, repo } = fixture();
    const recipe = { ...PLAIN_VIDEO_EDIT, speed: 0.5 };
    expect(repo.save({ mediaId: 'video', revision: 0, recipe }).ok).toBe(true);
    expect(repo.save({ mediaId: 'video', revision: 0, recipe: PLAIN_VIDEO_EDIT })).toMatchObject({
      ok: false,
    });
    expect(repo.save({ mediaId: 'video', revision: 1, recipe: { ...recipe, speed: 2 } }).ok).toBe(true);
    db.prepare(
      "INSERT INTO media (id,kind,name,path,listed) VALUES ('copy','video','Placeholder copy.mp4','bb/copy.mp4',0)",
    ).run();
    expect(repo.complete('video', 1, 'copy')).toBe(false);
    expect(repo.read('video')).toMatchObject({ revision: 2, state: 'preparing', readyMediaId: null });
    expect(repo.complete('video', 2, 'copy')).toBe(true);
    expect(repo.read('video')).toMatchObject({ revision: 2, state: 'ready', readyMediaId: 'copy' });
    expect(db.prepare("SELECT path FROM media WHERE id='video'").get()).toEqual({ path: 'aa/source.mp4' });
    db.close();
  });

  it('a thumbnail-only choice is ready, and missing/deleted/non-video targets cannot be edited', () => {
    const { db, repo } = fixture();
    expect(
      repo.save({
        mediaId: 'video',
        revision: 0,
        recipe: { ...PLAIN_VIDEO_EDIT, thumbnailMs: 2000 },
        thumbnailJpeg: new Uint8Array([255, 216, 255, 217]),
      }),
    ).toMatchObject({ ok: true, edit: { state: 'ready', readyMediaId: 'video' } });
    db.prepare("UPDATE media SET missing=1 WHERE id='video'").run();
    expect(repo.save({ mediaId: 'video', revision: 1, recipe: PLAIN_VIDEO_EDIT }).ok).toBe(false);
    db.close();
  });
});
