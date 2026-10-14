import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { MediaRepo } from '../db/media';
import { PlaylistRepo } from '../db/playlists';
import { AudioPlaylistRepo } from '../db/audio-playlists';
import { MediaRemoval } from './media-removal';

/* Deleting media with Undo (Session 26a): a made-up library that uses one picture everywhere. */

function library(over: { idle?: string[]; live?: string[] } = {}) {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO media (id, kind, name, path, sha256) VALUES
      ('pic', 'image', 'Placeholder darshan.png', 'aa/pic.png', 'aa'),
      ('snd', 'audio', 'Placeholder dhun.mp3', 'bb/snd.mp3', 'bb'),
      ('other', 'image', 'Other.png', 'cc/other.png', 'cc');
    INSERT INTO libraries (id, name) VALUES ('lib', 'Default');
    INSERT INTO presentations (id, library_id, name) VALUES ('p1', 'lib', 'Placeholder Katha'),
      ('p2', 'lib', 'Placeholder Background'), ('p3', 'lib', 'Placeholder Removed');
    UPDATE presentations SET deleted_at = '2026-10-01T00:00:00.000Z' WHERE id = 'p3';
    INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g1', 'p1', 'G', 0), ('g2', 'p2', 'G', 0),
      ('g3', 'p3', 'G', 0);
    INSERT INTO slides (id, group_id, position) VALUES ('s1', 'g1', 0), ('s2', 'g2', 0), ('s3', 'g3', 0);
    INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES
      ('e1', 's1', 0, 'image', 0, 0, 10, 10, '{"mediaId":"pic","fit":"fill"}'),
      ('e3', 's3', 0, 'image', 0, 0, 10, 10, '{"mediaId":"pic","fit":"fill"}');
    INSERT INTO slide_cues (id, slide_id, position, kind, media_id) VALUES ('c2', 's2', 0, 'background', 'pic');
    INSERT INTO playlists (id, name) VALUES ('pl1', 'Sunday'), ('pl2', 'Youth');
    INSERT INTO playlist_items (id, playlist_id, position, kind, media_id) VALUES
      ('i1', 'pl1', 0, 'media', 'pic'), ('i2', 'pl2', 0, 'media', 'pic'), ('i3', 'pl2', 1, 'media', 'other');
    INSERT INTO audio_playlists (id, name) VALUES ('mu', 'Before sabha');
    INSERT INTO audio_playlist_tracks (id, playlist_id, media_id, position) VALUES ('t1', 'mu', 'snd', 0);
    INSERT INTO props (id, name, definition) VALUES ('pr', 'Placeholder prop',
      '{"elements":[{"id":"x","kind":"image","mediaId":"pic"}]}');
    INSERT INTO themes (id, name, definition) VALUES ('th', 'Placeholder theme',
      '{"background":{"kind":"media","mediaId":"pic","media":"image","fit":"fill","loop":false}}');
    INSERT INTO macros (id, name, actions) VALUES ('ma', 'Placeholder macro',
      '[{"kind":"background","mediaId":"pic"}]');
  `);
  const removal = new MediaRemoval(db, {
    idlePictures: () => over.idle ?? [],
    onScreens: () => new Set(over.live ?? []),
  });
  return {
    db,
    removal,
    media: new MediaRepo(db),
    playlists: new PlaylistRepo(db),
    music: new AudioPlaylistRepo(db),
  };
}

const itemIds = (playlists: PlaylistRepo, id: string) => playlists.itemsOf(id).map((i) => i.id);

describe('deleting media from the library', () => {
  it('says where it is used: slides, playlists, music, props, themes, macros, the idle rotation, and on the screens', () => {
    const { removal } = library({ idle: ['pic'], live: ['pic'] });
    const usage = removal.usage(['pic']);
    // A removed presentation does not count.
    expect(usage.presentations).toEqual({ names: ['Placeholder Background', 'Placeholder Katha'], count: 2 });
    expect(usage.playlists).toEqual({ names: ['Sunday', 'Youth'], count: 2 });
    expect(usage.music.count).toBe(0);
    expect(usage.props.names).toEqual(['Placeholder prop']);
    expect(usage.themes.names).toEqual(['Placeholder theme']);
    expect(usage.macros.names).toEqual(['Placeholder macro']);
    expect(usage.idle).toBe(true);
    expect(usage.live).toBe(true);
    expect(removal.usage(['snd']).music).toEqual({ names: ['Before sabha'], count: 1 });
    expect(removal.usage(['other']).presentations.count).toBe(0);
  });

  it('takes it out of the media list, playlists and music; Undo puts back just what it took', () => {
    const { db, removal, media, playlists, music } = library();
    // Taken out of a playlist by hand before: Undo of the deletion must not bring that back.
    db.prepare("UPDATE playlist_items SET deleted_at = '2026-10-02T00:00:00.000Z' WHERE id = 'i2'").run();
    expect(removal.remove(['pic', 'snd', 'nothing'])).toEqual(['pic', 'snd']);
    expect(removal.remove(['pic'])).toEqual([]);
    expect(media.list().map((m) => m.id)).toEqual(['other']);
    expect(itemIds(playlists, 'pl1')).toEqual([]);
    expect(itemIds(playlists, 'pl2')).toEqual(['i3']);
    expect(music.list()[0]?.tracks).toEqual([]);
    // Everything else treats it as a missing file.
    expect(media.kindAndName('pic')).toBeNull();
    expect(media.kindAndFile('pic')?.missing).toBe(true);
    expect(media.file('pic')).toMatchObject({ path: 'aa/pic.png', deleted: true });
    // It cannot be added anywhere while deleted.
    expect(playlists.addItems('pl1', null, [{ kind: 'media', mediaId: 'pic' }])).toEqual([]);
    expect(music.addTracks('mu', ['snd'], null)).toBe(0);

    expect(removal.restore(['pic', 'snd'])).toEqual(['pic', 'snd']);
    expect(
      media
        .list()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['other', 'pic', 'snd']);
    expect(itemIds(playlists, 'pl1')).toEqual(['i1']);
    expect(itemIds(playlists, 'pl2')).toEqual(['i3']);
    expect(music.list()[0]?.tracks.map((t) => t.id)).toEqual(['t1']);
    expect(media.file('pic')?.deleted).toBe(false);
  });

  it('removes the file only at the next start, never one on the screens; the row stays a missing file', async () => {
    const { db, removal, media } = library();
    const dir = mkdtempSync(join(tmpdir(), 'drashti-media-removal-'));
    for (const rel of [
      'aa/pic.png',
      'stills/aa.jpg',
      'sharpened/aa-50.jpg',
      'cc/other.png',
      'sharpened/cc-50.png',
    ]) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), 'placeholder');
    }
    removal.remove(['pic', 'other']);
    // 'other' is up on the screens again after a restart: it stays until the next start.
    expect(await removal.purge(dir, new Set(['other']))).toBe(1);
    expect(existsSync(join(dir, 'aa/pic.png'))).toBe(false);
    expect(existsSync(join(dir, 'stills/aa.jpg'))).toBe(false);
    // Its sharpened copy goes with it (Session 26f).
    expect(existsSync(join(dir, 'sharpened/aa-50.jpg'))).toBe(false);
    expect(existsSync(join(dir, 'cc/other.png'))).toBe(true);
    expect(existsSync(join(dir, 'sharpened/cc-50.png'))).toBe(true);
    expect(media.file('pic')).toMatchObject({ path: '', missing: true, deleted: true });
    // Slides still point at it, as at any missing file; it can no longer be undone.
    expect(db.prepare("SELECT count(*) AS n FROM elements WHERE id = 'e1'").get()).toEqual({ n: 1 });
    expect(removal.restore(['pic'])).toEqual([]);
    expect(removal.restore(['other'])).toEqual(['other']);
  });
});
