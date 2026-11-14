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
  const NAME_RULE = { ok: false, message: 'A name needs 1 to 200 characters.' };

  it('renames a presentation; an empty name or a deleted one is refused, each in its own words', () => {
    const { actions, db } = library();
    expect(actions.renamePresentation('p2', '  Placeholder New Name  ')).toEqual({ ok: true });
    expect(db.prepare("SELECT name FROM presentations WHERE id = 'p2'").get()).toEqual({
      name: 'Placeholder New Name',
    });
    expect(actions.renamePresentation('p2', '   ')).toEqual(NAME_RULE);
    // One no longer in the library says so, not the name rule (the name was fine).
    expect(actions.renamePresentation('missing', 'Placeholder')).toEqual({
      ok: false,
      message: 'That presentation is no longer in the library.',
    });
    db.prepare("UPDATE presentations SET deleted_at = '2026-10-01T00:00:00.000Z' WHERE id = 'p3'").run();
    expect(actions.renamePresentation('p3', 'Placeholder')).toEqual({
      ok: false,
      message: 'That presentation is no longer in the library.',
    });
  });

  it('cleans control and direction characters from a newly saved name', () => {
    const { actions, db } = library();
    const oldName = 'Placeholder\u202E old name';
    db.prepare("UPDATE presentations SET name = ? WHERE id = 'p3'").run(oldName);
    const name = ' \u0000 Placeholder\tname\u2028line\u007F\u0085\u061C\u200E\u200F\u202E\u2069 ';
    expect(actions.renamePresentation('p2', name)).toEqual({ ok: true });
    const p2 = () => db.prepare("SELECT name FROM presentations WHERE id = 'p2'").get();
    expect(p2()).toEqual({ name: 'Placeholder name line' });
    expect(actions.renamePresentation('p2', '\t\u202E\u2069')).toEqual(NAME_RULE);
    // Refused: p2 keeps the name it had, and a name kept before is never cleaned again.
    expect(p2()).toEqual({ name: 'Placeholder name line' });
    expect(db.prepare("SELECT name FROM presentations WHERE id = 'p3'").get()).toEqual({ name: oldName });
  });

  it('refuses a name that only looks empty (joiners, a zero-width space, a word joiner, a soft hyphen)', () => {
    const { actions, db } = library();
    for (const name of ['\u200D', '\u200C', '\u200B', '\u2060', '\u00AD', ' \u200B\u2060 \u00AD\u200D ']) {
      expect(cleanName(name), JSON.stringify(name)).toBeNull();
      expect(actions.renamePresentation('p2', name)).toEqual(NAME_RULE);
      expect(actions.renameMedia('pic', name)).toEqual(NAME_RULE);
    }
    expect(db.prepare("SELECT name FROM presentations WHERE id = 'p2'").get()).toEqual({
      name: 'Placeholder Words',
    });
    expect(db.prepare("SELECT name FROM media WHERE id = 'pic'").get()).toEqual({
      name: 'Placeholder darshan.png',
    });
  });

  it('preserves letters, marks and joiners in a name, and a no-break space inside it', () => {
    for (const name of [
      'ક્\u200Dષ क्\u200Cष',
      // Virama and vowel signs ("placeholder" in Gujarati and in Hindi), and a nukta, decomposed.
      'પ્લેસહોલ્ડર प्लेसहोल्डर',
      'જ\u0ABC ज\u093C',
      // An emoji ZWJ sequence, and a no-break space inside a name.
      '👨\u200D👩\u200D👧\u200D👦 Placeholder',
      'Placeholder\u00A0name',
    ])
      expect(cleanName(name), JSON.stringify(name)).toBe(name);
  });

  it('renames a media file, and its playlist rows that had its name follow (one given its own label keeps it)', () => {
    const { actions, db } = library();
    expect(actions.renameMedia('pic', 'Placeholder backdrop.png')).toEqual({ ok: true });
    expect(db.prepare("SELECT name FROM media WHERE id = 'pic'").get()).toEqual({
      name: 'Placeholder backdrop.png',
    });
    expect(db.prepare("SELECT label FROM playlist_items WHERE id IN ('i5', 'i6') ORDER BY id").all()).toEqual(
      [{ label: 'Placeholder backdrop.png' }, { label: 'Placeholder own label' }],
    );
    expect(actions.renameMedia('pic', '')).toEqual(NAME_RULE);
  });

  it('says a media file is no longer in the library by its kind, not with the name rule', () => {
    const { actions, db } = library();
    db.prepare(
      "UPDATE media SET deleted_at = '2026-10-01T00:00:00.000Z' WHERE id IN ('pic', 'snd', 'own')",
    ).run();
    expect(actions.renameMedia('pic', 'Placeholder')).toEqual({
      ok: false,
      message: 'That picture is no longer in the library.',
    });
    expect(actions.renameMedia('snd', 'Placeholder')).toEqual({
      ok: false,
      message: 'That sound is no longer in the library.',
    });
    expect(actions.renameMedia('own', 'Placeholder')).toEqual({
      ok: false,
      message: 'That video is no longer in the library.',
    });
    // One Drashti has no row for, or an id no media file could have: a file.
    for (const id of ['missing', '../pic'])
      expect(actions.renameMedia(id, 'Placeholder')).toEqual({
        ok: false,
        message: 'That file is no longer in the library.',
      });
    // Its name is refused first, as a phone's own check refuses it before asking.
    expect(actions.renameMedia('pic', '\u200B')).toEqual(NAME_RULE);
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
