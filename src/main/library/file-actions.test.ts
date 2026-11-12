import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { cleanName, FileActions } from './file-actions';

/*
 * Session 55, Part 14: the one right-click menu's Delete, Rename and Show in Finder (Show in Explorer on Windows), as
 * the main process answers them. Delete asks first only when what it deletes is on the screens or in a playlist, and
 * says which (presentations' usage here; media's is MediaRemoval's). Deleting from the library removes Drashti's own
 * copy, and never a file of the owner's outside Drashti's data folder. A made-up library; placeholder names only.
 */

function library() {
  const db = openDatabase(':memory:');
  const outside = mkdtempSync(join(tmpdir(), 'drashti-file-actions-owner-'));
  const mediaDir = mkdtempSync(join(tmpdir(), 'drashti-file-actions-media-'));
  // The owner's own files, outside Drashti's data folder: one a media row points at, one by a path that climbs out.
  const ownerFile = join(outside, 'Placeholder owner clip.mp4');
  const climbing = join(outside, 'Placeholder climbing.png');
  writeFileSync(ownerFile, 'placeholder');
  writeFileSync(climbing, 'placeholder');
  for (const rel of ['aa/pic.png', 'bb/snd.mp3']) {
    mkdirSync(join(mediaDir, rel, '..'), { recursive: true });
    writeFileSync(join(mediaDir, rel), 'placeholder');
  }
  const original = join(outside, 'Placeholder darshan original.png');
  writeFileSync(original, 'placeholder');
  const deckFile = join(outside, 'Placeholder katha.pdf');
  writeFileSync(deckFile, 'placeholder');
  // A path that leads out of the media folder, as a damaged row could have it.
  const out = join('..', outside.split(/[\\/]/u).at(-1) ?? '', 'Placeholder climbing.png');
  db.prepare(
    `INSERT INTO media (id, kind, name, path, sha256, source_path) VALUES
       ('pic', 'image', 'Placeholder darshan.png', 'aa/pic.png', 'aa', ?),
       ('snd', 'audio', 'Placeholder dhun.mp3', 'bb/snd.mp3', 'bb', NULL),
       ('own', 'video', 'Placeholder owner clip.mp4', ?, 'cc', ?),
       ('climb', 'image', 'Placeholder climbing.png', ?, 'dd', NULL)`,
  ).run(original, ownerFile, ownerFile, out);
  db.exec(`
    INSERT INTO libraries (id, name) VALUES ('lib', 'Default');
    INSERT INTO presentations (id, library_id, name) VALUES ('p1', 'lib', 'Placeholder Katha'),
      ('p2', 'lib', 'Placeholder Words'), ('p3', 'lib', 'Placeholder Unused');
    INSERT INTO playlists (id, name) VALUES ('pl1', 'Placeholder Sunday'), ('pl2', 'Placeholder Youth'),
      ('pl3', 'Placeholder Gone');
    UPDATE playlists SET deleted_at = '2026-10-01T00:00:00.000Z' WHERE id = 'pl3';
    INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, media_id, label) VALUES
      ('i1', 'pl1', 0, 'presentation', 'p1', NULL, 'Placeholder Katha'),
      ('i2', 'pl2', 0, 'presentation', 'p1', NULL, 'Placeholder Katha'),
      ('i3', 'pl2', 1, 'presentation', 'p2', NULL, 'Placeholder Words'),
      ('i4', 'pl3', 0, 'presentation', 'p3', NULL, 'Placeholder Unused'),
      ('i5', 'pl1', 1, 'media', NULL, 'pic', 'Placeholder darshan.png'),
      ('i6', 'pl2', 2, 'media', NULL, 'pic', 'Placeholder own label');
  `);
  db.prepare('UPDATE presentations SET source_kind = ?, source_path = ? WHERE id = ?').run(
    'pictures',
    deckFile,
    'p1',
  );
  let live: string | null = null;
  const actions = new FileActions(db, { mediaDir, livePresentation: () => live });
  return {
    db,
    actions,
    mediaDir,
    ownerFile,
    climbing,
    original,
    deckFile,
    setLive: (id: string | null) => {
      live = id;
    },
  };
}

describe('Delete, from the library: what it asks first', () => {
  it('says which playlists hold a presentation, and whether it is on the screens; one in none asks nothing', () => {
    const { actions, setLive } = library();
    expect(actions.presentationUsage(['p1'])).toEqual({
      playlists: { names: ['Placeholder Sunday', 'Placeholder Youth'], count: 2 },
      live: false,
    });
    // Only in a deleted playlist: in none.
    expect(actions.presentationUsage(['p3'])).toEqual({ playlists: { names: [], count: 0 }, live: false });
    setLive('p3');
    expect(actions.presentationUsage(['p3']).live).toBe(true);
  });
});

describe('Rename', () => {
  it('renames a presentation; an empty name or a deleted one is refused', () => {
    const { actions, db } = library();
    expect(actions.renamePresentation('p2', '  Placeholder New Name  ')).toBe(true);
    expect(db.prepare("SELECT name FROM presentations WHERE id = 'p2'").get()).toEqual({
      name: 'Placeholder New Name',
    });
    expect(actions.renamePresentation('p2', '   ')).toBe(false);
    expect(actions.renamePresentation('missing', 'Placeholder')).toBe(false);
  });

  it('cleans control and direction characters from a newly saved name', () => {
    const { actions, db } = library();
    const oldName = 'Placeholder\u202E old name';
    db.prepare("UPDATE presentations SET name = ? WHERE id = 'p3'").run(oldName);
    const name = ' \u0000 Placeholder\t name\u007F\u0085\u200E\u200F\u202E\u2069 ';
    expect(actions.renamePresentation('p2', name)).toBe(true);
    expect(db.prepare("SELECT name FROM presentations WHERE id = 'p2'").get()).toEqual({
      name: 'Placeholder name',
    });
    expect(actions.renamePresentation('p2', '\t\u202E\u2069')).toBe(false);
    expect(db.prepare("SELECT name FROM presentations WHERE id = 'p3'").get()).toEqual({ name: oldName });
  });

  it('preserves letters, marks and joiners in a name', () => {
    const name = 'ક્\u200Dષ क्\u200Cष';
    expect(cleanName(name)).toBe(name);
  });

  it('renames a media file, and its playlist rows that had its name follow (one given its own label keeps it)', () => {
    const { actions, db } = library();
    expect(actions.renameMedia('pic', 'Placeholder backdrop.png')).toBe(true);
    expect(db.prepare("SELECT name FROM media WHERE id = 'pic'").get()).toEqual({
      name: 'Placeholder backdrop.png',
    });
    expect(db.prepare("SELECT label FROM playlist_items WHERE id IN ('i5', 'i6') ORDER BY id").all()).toEqual(
      [{ label: 'Placeholder backdrop.png' }, { label: 'Placeholder own label' }],
    );
    expect(actions.renameMedia('pic', '')).toBe(false);
  });
});

describe('Show in Finder (Show in Explorer)', () => {
  it('shows the file it was imported from while it is there, else Drashti’s own copy; never a path out of its folder', () => {
    const { actions, mediaDir, original, deckFile, ownerFile, db } = library();
    expect(actions.mediaFile('pic')).toBe(original);
    // Its original gone: Drashti's own copy.
    db.prepare("UPDATE media SET source_path = '/nowhere/Placeholder.png' WHERE id = 'pic'").run();
    expect(actions.mediaFile('pic')).toBe(join(mediaDir, 'aa/pic.png'));
    expect(actions.mediaFile('snd')).toBe(join(mediaDir, 'bb/snd.mp3'));
    // A path that climbs out of the media folder is never shown.
    expect(actions.mediaFile('climb')).toBeNull();
    expect(actions.mediaFile('missing')).toBeNull();
    // A row pointing at the owner's own file (outside Drashti's folder): that file.
    expect(actions.mediaFile('own')).toBe(ownerFile);
    // A presentation: the file it was imported from, while it is there; one made in Drashti has none.
    expect(actions.presentationFile('p1')).toBe(deckFile);
    expect(actions.presentationFile('p2')).toBeNull();
  });
});
