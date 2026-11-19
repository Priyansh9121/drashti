import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './database';
import { openDatabase } from './database';
import { VideoCaptionsRepo } from './video-captions';
import { moveMedia } from '../convert/relink';
import { TrimmedVideos } from './trimmed';
import { MediaRepo } from './media';
import { PlaylistRepo } from './playlists';
import { NO_MARKERS } from '../../shared/markers';
import type { VideoCaptionTrack } from '../../shared/video-captions';

let db: Db;
const TRACK: VideoCaptionTrack = {
  id: 'en-file',
  language: 'en',
  name: 'Sample.en.srt',
  automatic: false,
  cues: [
    { startMs: 1000, endMs: 6000, text: 'First placeholder' },
    { startMs: 6500, endMs: 9000, text: 'Second placeholder' },
  ],
};
beforeEach(() => {
  db = openDatabase(':memory:');
  db.exec(
    "INSERT INTO media (id, kind, name, path) VALUES ('original', 'video', 'Sample.mov', 'aa/original.mov'), ('converted', 'video', 'Sample.mp4', 'bb/converted.mp4'); INSERT INTO playlists (id, name) VALUES ('list', 'Placeholder'); INSERT INTO playlist_items (id, playlist_id, position, kind, media_id) VALUES ('row', 'list', 0, 'media', 'original');",
  );
  const captions = new VideoCaptionsRepo(db);
  captions.put('original', [TRACK]);
  captions.select('original', TRACK.id);
});
afterEach(() => db.close());

describe('a video’s captions travel with its playable copies', () => {
  it('keeps the tracks and chosen language when an import converts the video, leaving source times intact', () => {
    moveMedia(db, 'original', 'converted');
    expect(new VideoCaptionsRepo(db).chosen('converted')).toEqual(TRACK);
    expect(new VideoCaptionsRepo(db).chosen('original')).toEqual(TRACK);
  });
  it('keeps a destination video’s own caption choice when it already has one', () => {
    const captions = new VideoCaptionsRepo(db);
    const local = { ...TRACK, id: 'gu-file', language: 'gu' };
    captions.put('converted', [local]);
    captions.select('converted', local.id);
    moveMedia(db, 'original', 'converted');
    expect(captions.chosen('converted')).toEqual(local);
  });
  it('moves a playlist row’s captions into the cut file’s own clock without changing its original', () => {
    const trimmed = new TrimmedVideos(db, new MediaRepo(db), new PlaylistRepo(db));
    const row = trimmed.row('row');
    if (!row) throw new Error('Missing placeholder row');
    const copy = trimmed.adopt(
      row,
      {
        name: 'Placeholder cut.mp4',
        path: 'cc/cut.mp4',
        sha256: 'a'.repeat(64),
        bytes: 1000,
        durationMs: 6000,
        width: 320,
        height: 180,
        format: 'H.264',
      },
      2000,
      8000,
      NO_MARKERS,
    );
    if (!copy) throw new Error('Cut not adopted');
    const captions = new VideoCaptionsRepo(db);
    expect(captions.chosen(copy)?.cues).toEqual([
      { startMs: 0, endMs: 4000, text: 'First placeholder' },
      { startMs: 4500, endMs: 6000, text: 'Second placeholder' },
    ]);
    expect(captions.chosen('original')).toEqual(TRACK);
  });
});
