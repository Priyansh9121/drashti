import { describe, expect, it } from 'vitest';
import { inputNamed, type VideoInput } from '../../shared/video-inputs';
import { Revisions } from '../library/revisions';
import { type Db, openDatabase } from './database';
import { carryInputName } from './input-renames';
import { PlaylistRepo } from './playlists';
import type { NewSlide } from './presentations';
import { DbSlideSource, PresentationRepo } from './presentations';

/*
 * A video input renamed in Media (Session 52): the library names an input by its own name alone (Session 51), so
 * a rename carries the playlist items and slides' background cues that named it to its new name, in one write;
 * before, each said Not on this computer from then on. Placeholder names only.
 */

/** This computer's input, as Media had it and as it is once renamed. */
const was: VideoInput = { id: 'here-1', name: 'Placeholder input', device: 'Placeholder device', fit: 'fit' };
const now: VideoInput = { ...was, name: 'Placeholder camera' };
/** Another computer's input, named by the library too: never this computer's to carry. */
const theirs: VideoInput = {
  id: 'there-2',
  name: 'Another computer’s input',
  device: 'Placeholder',
  fit: 'fit',
};

/** A slide with a video input behind it, by name, and its other settings. */
const behind = (input: string, more: Record<string, unknown> = {}): NewSlide => ({
  elements: [],
  cues: [{ kind: 'background', label: '', mediaId: null, props: { input, ...more } }],
});

const stamp = (db: Db, table: 'playlists' | 'presentations', id: string) =>
  db
    .prepare(
      `SELECT updated_at${table === 'presentations' ? ', content_rev' : ''} FROM ${table} WHERE id = ?`,
    )
    .get(id);

/** A presentation's cues in the order of its slides: each one's file and settings. */
const cuesOf = (db: Db, presentationId: string) =>
  (
    db
      .prepare(
        `SELECT c.media_id, c.props FROM slide_cues c JOIN slides s ON s.id = c.slide_id
           JOIN slide_groups g ON g.id = s.group_id
          WHERE g.presentation_id = ? ORDER BY g.position, s.position, c.position`,
      )
      .all(presentationId) as { media_id: string | null; props: string }[]
  ).map((c) => [c.media_id, JSON.parse(c.props) as unknown]);

/** A library naming the input in playlists, a template and slides, with every time set back. */
function library() {
  const db = openDatabase(':memory:');
  db.prepare(
    "INSERT INTO media (id, kind, name, path) VALUES ('pic', 'image', 'Placeholder picture.png', 'ab/pic.png')",
  ).run();
  const presentations = new PresentationRepo(db);
  const lib = presentations.ensureLibrary('Default');
  const over = presentations.insert({
    libraryId: lib,
    name: 'Placeholder over the input',
    groups: [
      {
        name: 'Verse',
        slides: [
          behind('Placeholder input'),
          { elements: [] },
          // Named in other letters (a library from a computer that names it so), with settings of its own.
          behind(' placeholder INPUT ', { note: 'kept' }),
          // A picture's cue is the picture's, whatever its settings hold.
          {
            elements: [],
            cues: [{ kind: 'background', label: '', mediaId: 'pic', props: { input: 'Placeholder input' } }],
          },
        ],
      },
    ],
  });
  const another = presentations.insert({
    libraryId: lib,
    name: 'Placeholder over another',
    groups: [{ name: 'Verse', slides: [behind(theirs.name)] }],
  });
  // Items added as each computer names its inputs.
  const here = new PlaylistRepo(db, (name) => inputNamed([was, theirs], name));
  const elsewhere = new PlaylistRepo(db, (name) => inputNamed([{ ...was, name: 'PLACEHOLDER INPUT' }], name));
  const sunday = here.create('Placeholder Sunday', null, false) ?? '';
  const [header, input, other, removed] = here.addItems(sunday, null, [
    { kind: 'header', label: 'Placeholder input' },
    { kind: 'input', name: 'Placeholder input' },
    { kind: 'input', name: theirs.name },
    { kind: 'input', name: 'Placeholder input' },
  ]);
  const [shouting] = elsewhere.addItems(sunday, null, [{ kind: 'input', name: 'placeholder input' }]);
  here.removeItems([removed ?? '']);
  const template = here.saveAsTemplate(sunday, 'Placeholder template', []) ?? '';
  const quiet = here.create('Placeholder without it', null, false) ?? '';
  here.addItems(quiet, null, [{ kind: 'input', name: theirs.name }]);
  db.prepare("UPDATE playlists SET updated_at = '2026-01-02T03:04:05.000Z'").run();
  db.prepare("UPDATE presentations SET updated_at = '2026-01-02T03:04:05.000Z'").run();
  return {
    db,
    presentations,
    over,
    another,
    sunday,
    template,
    quiet,
    items: { header, input, other, removed, shouting },
    // The playlists as this computer reads them once the input is renamed.
    renamed: new PlaylistRepo(db, (name) => inputNamed([now, theirs], name)),
  };
}

describe('a video input renamed in Media (Session 52)', () => {
  it('its playlist items take the new name, removed ones and a template’s too: on this computer, never Not on it', () => {
    const { db, sunday, template, quiet, items, renamed } = library();
    const before = [sunday, template, quiet].map((id) => stamp(db, 'playlists', id));
    const carried = carryInputName(db, 'Placeholder input', 'Placeholder camera');
    // On this computer by its new name, whatever letters named it; a header of the same words is a header.
    const card = (name: string) => ({ kind: 'input', label: name, name, timers: [] });
    expect(renamed.itemsOf(sunday)).toEqual([
      { id: items.header, kind: 'header', label: 'Placeholder input', color: null },
      { id: items.input, ...card('Placeholder camera'), missing: false },
      { id: items.other, ...card(theirs.name), missing: false },
      { id: items.shouting, ...card('Placeholder camera'), missing: false },
    ]);
    expect(renamed.playItems(sunday)?.[1]).toEqual({
      id: items.input,
      kind: 'input',
      inputId: 'here-1',
      label: 'Placeholder camera',
      timers: [],
    });
    // Three in the playlist (one removed) and the template's two.
    expect(carried.items).toHaveLength(5);
    expect(carried.items).toEqual(expect.arrayContaining([items.input, items.removed, items.shouting]));
    // The playlists it changed say so to the nodes (their times move); one naming another input is left as it was.
    const after = [sunday, template, quiet].map((id) => stamp(db, 'playlists', id));
    expect(after[0]).not.toEqual(before[0]);
    expect(after[1]).not.toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    // Undo of its removal brings it back by the new name.
    renamed.restoreItems([items.removed ?? '']);
    expect(renamed.itemsOf(sunday).find((i) => i.id === items.removed)).toEqual({
      id: items.removed,
      ...card('Placeholder camera'),
      missing: false,
    });
    expect(
      renamed.itemsOf(template).map((i) => (i.kind === 'input' ? [i.name, i.missing] : [i.kind])),
    ).toEqual([
      ['header'],
      ['Placeholder camera', false],
      [theirs.name, false],
      ['Placeholder camera', false],
    ]);
    db.close();
  });

  it('its slides’ background cues take the new name, their other settings kept, and their stamps move on', () => {
    const { db, presentations, over, another } = library();
    const untouched = presentations.content(another);
    const before = stamp(db, 'presentations', another);
    const earlier = stamp(db, 'presentations', over) as { updated_at: string; content_rev: number };
    const carried = carryInputName(db, 'Placeholder input', 'Placeholder camera');
    expect(carried.presentations).toEqual([over]);
    expect(carried.cues).toHaveLength(2);
    expect(cuesOf(db, over)).toEqual([
      [null, { input: 'Placeholder camera' }],
      [null, { input: 'Placeholder camera', note: 'kept' }],
      ['pic', { input: 'Placeholder input' }],
    ]);
    const shown = new DbSlideSource(presentations).order(over)?.slides.map((s) => s.cues[0]?.name ?? null);
    expect(shown).toEqual(['Placeholder camera', null, 'Placeholder camera', 'Placeholder picture.png']);
    // Its content was written: the slide editor's stamp moves on, so an editor opened before saves over it
    // only when asked (migration 44).
    expect(stamp(db, 'presentations', over)).toMatchObject({ content_rev: earlier.content_rev + 1 });
    expect(stamp(db, 'presentations', over)).not.toMatchObject({ updated_at: earlier.updated_at });
    // Another computer's input is never this one's.
    expect(presentations.content(another)).toEqual(untouched);
    expect(stamp(db, 'presentations', another)).toEqual(before);
    db.close();
  });

  it('nothing names it: nothing is written, and no time moves', () => {
    const { db, sunday, over } = library();
    const times = [stamp(db, 'playlists', sunday), stamp(db, 'presentations', over)];
    expect(carryInputName(db, 'Placeholder mixer', 'Placeholder camera')).toEqual({
      items: [],
      cues: [],
      presentations: [],
    });
    expect([stamp(db, 'playlists', sunday), stamp(db, 'presentations', over)]).toEqual(times);
    db.close();
  });

  it('the slides’ copies kept for Undo take it too: undoing an edit made before never puts the old name back', () => {
    const { db, presentations, over } = library();
    const revisions = new Revisions();
    const rows = presentations.content(over);
    if (!rows) throw new Error('no content');
    const undo = revisions.keep([rows]);
    carryInputName(db, 'Placeholder input', 'Placeholder camera');
    revisions.carryInput('Placeholder input', 'Placeholder camera');
    for (const back of revisions.take(undo) ?? []) presentations.setContent(back);
    const source = new DbSlideSource(presentations);
    expect(source.order(over)?.slides.map((s) => s.cues[0]?.name ?? null)).toEqual([
      'Placeholder camera',
      null,
      'Placeholder camera',
      'Placeholder picture.png',
    ]);
    db.close();
  });
});
