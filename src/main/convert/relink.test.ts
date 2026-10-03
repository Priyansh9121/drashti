import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { moveBack, moveMedia, presentationsMoved } from './relink';

/** A library that uses one file everywhere it can be used. */
function library() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO media (id, kind, name, path) VALUES ('old', 'video', 'Placeholder.mov', 'aa/old.mov'),
      ('new', 'video', 'Placeholder.mp4', 'bb/new.mp4'), ('other', 'image', 'Other.png', 'cc/other.png');
    INSERT INTO libraries (id, name) VALUES ('lib', 'Default');
    INSERT INTO presentations (id, library_id, name) VALUES ('p1', 'lib', 'Placeholder');
    INSERT INTO slide_groups (id, presentation_id, name, position) VALUES ('g1', 'p1', 'G', 0);
    INSERT INTO slides (id, group_id, position) VALUES ('s1', 'g1', 0);
    INSERT INTO slide_cues (id, slide_id, position, kind, media_id) VALUES ('c1', 's1', 0, 'background', 'old'),
      ('c2', 's1', 1, 'audio', 'other');
    INSERT INTO elements (id, slide_id, position, kind, x, y, width, height, props) VALUES
      ('e1', 's1', 0, 'video', 0, 0, 10, 10, '{"mediaId":"old","fit":"fill"}'),
      ('e2', 's1', 1, 'image', 0, 0, 10, 10, '{"mediaId":"other","fit":"fill"}');
    INSERT INTO playlists (id, name) VALUES ('pl', 'Placeholder list');
    INSERT INTO playlist_items (id, playlist_id, position, kind, media_id) VALUES ('i1', 'pl', 0, 'media', 'old');
    INSERT INTO props (id, name, definition) VALUES ('pr', 'Bug',
      '{"elements":[{"id":"x","kind":"video","mediaId":"old"},{"id":"y","kind":"image","mediaId":"other"}]}');
    INSERT INTO themes (id, name, definition) VALUES ('th', 'Theme',
      '{"background":{"kind":"media","mediaId":"old","media":"video","fit":"fill","loop":true}}');
    INSERT INTO kirtans (presentation_id, audio_media_id) VALUES ('p1', 'old');
  `);
  return db;
}

const uses = (db: ReturnType<typeof library>, id: string) =>
  [
    db.prepare('SELECT count(*) AS n FROM slide_cues WHERE media_id = ?').get(id),
    db.prepare('SELECT count(*) AS n FROM playlist_items WHERE media_id = ?').get(id),
    db.prepare('SELECT count(*) AS n FROM kirtans WHERE audio_media_id = ?').get(id),
    db.prepare("SELECT count(*) AS n FROM elements WHERE json_extract(props, '$.mediaId') = ?").get(id),
    db.prepare('SELECT count(*) AS n FROM props WHERE instr(definition, ?) > 0').get(`"${id}"`),
    db.prepare('SELECT count(*) AS n FROM themes WHERE instr(definition, ?) > 0').get(`"${id}"`),
  ].map((r) => (r as { n: number }).n);

describe('moving everything to the converted file', () => {
  it('moves every use of the original, and nothing else', () => {
    const db = library();
    const moved = moveMedia(db, 'old', 'new');
    expect(moved).toEqual({
      cues: ['c1'],
      items: ['i1'],
      kirtans: ['p1'],
      elements: ['e1'],
      props: ['pr'],
      themes: ['th'],
    });
    expect(uses(db, 'old')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(uses(db, 'new')).toEqual([1, 1, 1, 1, 1, 1]);
    // Other files, and everything else in the JSON, stay as they were.
    expect(uses(db, 'other')).toEqual([1, 0, 0, 1, 1, 0]);
    expect(
      JSON.parse((db.prepare("SELECT props FROM elements WHERE id = 'e1'").get() as { props: string }).props),
    ).toEqual({
      mediaId: 'new',
      fit: 'fill',
    });
    expect(presentationsMoved(db, moved)).toEqual(['p1']);
    // The originals themselves are not touched.
    expect(db.prepare("SELECT path FROM media WHERE id = 'old'").get()).toEqual({ path: 'aa/old.mov' });
  });

  it('Undo puts back what moved, unless it was changed again since', () => {
    const db = library();
    const moved = moveMedia(db, 'old', 'new');
    // Meanwhile the playlist item is pointed at another file by hand.
    db.prepare("UPDATE playlist_items SET media_id = 'other' WHERE id = 'i1'").run();
    moveBack(db, moved, 'old', 'new');
    expect(uses(db, 'old')).toEqual([1, 0, 1, 1, 1, 1]);
    expect(uses(db, 'new')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(
      (db.prepare("SELECT media_id FROM playlist_items WHERE id = 'i1'").get() as { media_id: string })
        .media_id,
    ).toBe('other');
  });
});
